import { Effect, Layer } from "effect";
import { VirtualFileSystem, type FileSystemOptions } from "./filesystem.js";
import { fileLimit, layerFileSystem } from "./internal/engine.js";
import type { NodeRecord, Storage } from "./internal/storage.js";
import { FsError } from "./errors.js";

type SqlValue = string | number | null | ArrayBuffer;

/** Structural subset of DurableObjectStorage; no Cloudflare type dependency leaks into consumers. */
export interface DurableObjectStorageLike {
  readonly sql: {
    exec<T extends Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]): {
      toArray(): T[];
      one(): T;
    };
  };
  transactionSync<A>(body: () => A): A;
}

type NodeRow = { [K in keyof NodeRecord]: NodeRecord[K] };
const columns = "id, parent_id AS parentId, name, type, size, created_at AS createdAt, modified_at AS modifiedAt";

class SqliteStorage implements Storage {
  constructor(private readonly storage: DurableObjectStorageLike) {}

  initialize(): void {
    this.transaction(() => {
      const sql = this.storage.sql;
      sql.exec(`CREATE TABLE IF NOT EXISTS fs_durable_schema (
        id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL
      )`);
      const version = sql.exec<{ version: number }>("SELECT version FROM fs_durable_schema WHERE id = 1").toArray()[0]?.version;
      if (version !== undefined) {
        if (version !== 1) throw new Error(`Unsupported fs-durable schema version ${version}`);
        return;
      }
      sql.exec(`CREATE TABLE fs_durable_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id INTEGER REFERENCES fs_durable_nodes(id),
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('file', 'directory')),
        size INTEGER NOT NULL CHECK (size >= 0),
        created_at INTEGER NOT NULL,
        modified_at INTEGER NOT NULL,
        UNIQUE (parent_id, name),
        CHECK ((id = 1 AND parent_id IS NULL AND name = '' AND type = 'directory')
          OR (id <> 1 AND parent_id IS NOT NULL AND name <> ''))
      )`);
      sql.exec(`CREATE TABLE fs_durable_contents (
        node_id INTEGER PRIMARY KEY REFERENCES fs_durable_nodes(id),
        data BLOB NOT NULL
      )`);
      const now = Date.now();
      sql.exec("INSERT INTO fs_durable_nodes (id, parent_id, name, type, size, created_at, modified_at) VALUES (1, NULL, '', 'directory', 0, ?, ?)", now, now);
      sql.exec("INSERT INTO fs_durable_schema (id, version) VALUES (1, 1)");
    });
  }

  transaction<A>(body: () => A): A { return this.storage.transactionSync(body); }
  get(id: number) {
    return this.storage.sql.exec<NodeRow>(`SELECT ${columns} FROM fs_durable_nodes WHERE id = ?`, id).toArray()[0];
  }
  child(parentId: number, name: string) {
    return this.storage.sql.exec<NodeRow>(`SELECT ${columns} FROM fs_durable_nodes WHERE parent_id = ? AND name = ?`, parentId, name).toArray()[0];
  }
  children(parentId: number) {
    return this.storage.sql.exec<NodeRow>(`SELECT ${columns} FROM fs_durable_nodes WHERE parent_id = ?`, parentId).toArray();
  }
  insert(node: Omit<NodeRecord, "id">): NodeRecord {
    return this.storage.sql.exec<NodeRow>(
      `INSERT INTO fs_durable_nodes (parent_id, name, type, size, created_at, modified_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING ${columns}`,
      node.parentId, node.name, node.type, node.size, node.createdAt, node.modifiedAt,
    ).one();
  }
  update(node: NodeRecord): void {
    this.storage.sql.exec(
      "UPDATE fs_durable_nodes SET parent_id = ?, name = ?, size = ?, modified_at = ? WHERE id = ?",
      node.parentId, node.name, node.size, node.modifiedAt, node.id,
    );
  }
  readContent(id: number): Uint8Array {
    return new Uint8Array(this.storage.sql.exec<{ data: ArrayBuffer }>("SELECT data FROM fs_durable_contents WHERE node_id = ?", id).one().data);
  }
  writeContent(id: number, data: Uint8Array): void {
    this.storage.sql.exec(
      "INSERT INTO fs_durable_contents (node_id, data) VALUES (?, ?) ON CONFLICT (node_id) DO UPDATE SET data = excluded.data",
      id, data.slice().buffer,
    );
  }
  delete(id: number): void {
    this.storage.sql.exec("DELETE FROM fs_durable_contents WHERE node_id = ?", id);
    this.storage.sql.exec("DELETE FROM fs_durable_nodes WHERE id = ?", id);
  }
}

export const layerDurableObject = (
  storage: DurableObjectStorageLike,
  options: FileSystemOptions = {},
) => Layer.unwrap(Effect.try({
  try: () => {
    const limit = fileLimit(options);
    const backend = new SqliteStorage(storage);
    backend.initialize();
    return layerFileSystem(backend, limit);
  },
  catch: (cause) => cause instanceof FsError ? cause : new FsError({
    code: "EIO", operation: "initialize", path: "/", message: "Filesystem storage operation failed", cause,
  }),
}));

/** Initialize once per DO instance. Reopening preserves files and checks the schema version. */
export const makeDurableObject = (
  storage: DurableObjectStorageLike,
  options: FileSystemOptions = {},
): Effect.Effect<VirtualFileSystem, FsError> =>
  Effect.provide(VirtualFileSystem, layerDurableObject(storage, options));
