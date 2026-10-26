import { Effect, Layer } from "effect";
import { VirtualFileSystem, type FileSystemOptions } from "./filesystem.js";
import { fileLimit, layerFileSystem } from "./internal/engine.js";
import type { NodeRecord, Resolved, Storage } from "./internal/storage.js";
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
type ResolvedRow = NodeRow & { readonly depth: number };

const columns = "id, parent_id AS parentId, name, type, size, created_at AS createdAt, modified_at AS modifiedAt";

const RESOLVE = `WITH RECURSIVE walk(id, depth, rest) AS (
    SELECT 1, 0, ?1
    UNION ALL
    SELECT node.id, walk.depth + 1, substr(walk.rest, instr(walk.rest || '/', '/') + 1) FROM walk
    JOIN fs_durable_nodes AS node
      ON node.parent_id = walk.id AND node.name = substr(walk.rest, 1, instr(walk.rest || '/', '/') - 1)
    WHERE walk.rest <> ''
  )
  SELECT ${columns}, depth FROM fs_durable_nodes JOIN (SELECT id AS walked, depth FROM walk) ON id = walked
  ORDER BY depth DESC LIMIT 1`;

const CONTAINS = `WITH RECURSIVE up(id) AS (
    SELECT ?1
    UNION ALL
    SELECT node.parent_id FROM up JOIN fs_durable_nodes AS node ON node.id = up.id WHERE node.parent_id IS NOT NULL
  )
  SELECT 1 FROM up WHERE id = ?2 LIMIT 1`;

const TREE = `WITH RECURSIVE tree(id) AS (
    SELECT ?1
    UNION ALL
    SELECT node.id FROM fs_durable_nodes AS node JOIN tree ON node.parent_id = tree.id
  )`;

const NUMBERED_TREE = `${TREE}, numbered AS (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM tree)`;

const buffer = (data: Uint8Array): ArrayBuffer =>
  data.byteOffset === 0 && data.byteLength === data.buffer.byteLength && data.buffer instanceof ArrayBuffer
    ? data.buffer
    : data.slice().buffer;

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
        if (version !== 1) {
          throw new FsError({ code: "EIO", operation: "initialize", path: "/", message: `Unsupported fs-durable schema version ${version}` });
        }
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
  resolve(parts: ReadonlyArray<string>): Resolved {
    const row = this.storage.sql.exec<ResolvedRow>(RESOLVE, parts.join("/")).toArray()[0];
    if (!row) throw new Error("Missing filesystem root");
    const { depth, ...node } = row;
    return { node, depth };
  }
  contains(ancestorId: number, id: number): boolean {
    return this.storage.sql.exec(CONTAINS, id, ancestorId).toArray().length > 0;
  }
  children(parentId: number) {
    return this.storage.sql.exec<NodeRow>(`SELECT ${columns} FROM fs_durable_nodes WHERE parent_id = ?`, parentId).toArray();
  }
  hasChildren(parentId: number): boolean {
    return this.storage.sql.exec("SELECT 1 FROM fs_durable_nodes WHERE parent_id = ? LIMIT 1", parentId).toArray().length > 0;
  }
  insert(node: Omit<NodeRecord, "id">): NodeRecord {
    const { id } = this.storage.sql.exec<{ id: number }>(
      `INSERT INTO fs_durable_nodes (parent_id, name, type, size, created_at, modified_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      node.parentId, node.name, node.type, node.size, node.createdAt, node.modifiedAt,
    ).one();
    return { ...node, id };
  }
  move(id: number, parentId: number, name: string): void {
    this.storage.sql.exec("UPDATE fs_durable_nodes SET parent_id = ?, name = ? WHERE id = ?", parentId, name, id);
  }
  resize(id: number, size: number, modifiedAt: number): void {
    this.storage.sql.exec("UPDATE fs_durable_nodes SET size = ?, modified_at = ? WHERE id = ?", size, modifiedAt, id);
  }
  touch(id: number, modifiedAt: number): void {
    this.storage.sql.exec("UPDATE fs_durable_nodes SET modified_at = ? WHERE id = ?", modifiedAt, id);
  }
  readContent(id: number): Uint8Array {
    return new Uint8Array(this.storage.sql.exec<{ data: ArrayBuffer }>("SELECT data FROM fs_durable_contents WHERE node_id = ?", id).one().data);
  }
  writeContent(id: number, data: Uint8Array): void {
    this.storage.sql.exec(
      "INSERT INTO fs_durable_contents (node_id, data) VALUES (?, ?) ON CONFLICT (node_id) DO UPDATE SET data = excluded.data",
      id, buffer(data),
    );
  }
  appendContent(id: number, data: Uint8Array): void {
    this.storage.sql.exec("UPDATE fs_durable_contents SET data = CAST(data || ? AS BLOB) WHERE node_id = ?", buffer(data), id);
  }
  copyContent(sourceId: number, targetId: number): void {
    this.storage.sql.exec(
      `INSERT INTO fs_durable_contents (node_id, data) SELECT ?, data FROM fs_durable_contents WHERE node_id = ?
       ON CONFLICT (node_id) DO UPDATE SET data = excluded.data`,
      targetId, sourceId,
    );
  }
  largestFile(id: number): number {
    return this.storage.sql.exec<{ size: number }>(
      `${TREE} SELECT coalesce(max(size), 0) AS size FROM fs_durable_nodes WHERE id IN (SELECT id FROM tree)`, id,
    ).one().size;
  }
  copyTree(sourceId: number, parentId: number, name: string, now: number): void {
    const sql = this.storage.sql;
    const { base } = sql.exec<{ base: string }>(
      `SELECT CAST(max(coalesce((SELECT seq FROM sqlite_sequence WHERE name = 'fs_durable_nodes'), 0),
        (SELECT coalesce(max(id), 0) FROM fs_durable_nodes)) AS TEXT) AS base`,
    ).one();
    sql.exec(`${NUMBERED_TREE}
      INSERT INTO fs_durable_nodes (id, parent_id, name, type, size, created_at, modified_at)
      SELECT CAST(?2 AS INTEGER) + copy.rn, CASE WHEN copy.id = ?1 THEN ?3 ELSE CAST(?2 AS INTEGER) + parent.rn END,
        CASE WHEN copy.id = ?1 THEN ?4 ELSE node.name END, node.type, node.size, ?5, ?5
      FROM numbered AS copy JOIN fs_durable_nodes AS node ON node.id = copy.id
      LEFT JOIN numbered AS parent ON parent.id = node.parent_id
      ORDER BY copy.rn`, sourceId, base, parentId, name, now);
    sql.exec(`${NUMBERED_TREE}
      INSERT INTO fs_durable_contents (node_id, data)
      SELECT CAST(?2 AS INTEGER) + numbered.rn, content.data FROM numbered JOIN fs_durable_contents AS content ON content.node_id = numbered.id`,
    sourceId, base);
  }
  delete(id: number): void {
    this.storage.sql.exec("DELETE FROM fs_durable_contents WHERE node_id = ?", id);
    this.storage.sql.exec("DELETE FROM fs_durable_nodes WHERE id = ?", id);
  }
  deleteTree(id: number): void {
    this.storage.sql.exec(`${TREE} DELETE FROM fs_durable_contents WHERE node_id IN (SELECT id FROM tree)`, id);
    this.storage.sql.exec(`${TREE} DELETE FROM fs_durable_nodes WHERE id IN (SELECT id FROM tree)`, id);
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
