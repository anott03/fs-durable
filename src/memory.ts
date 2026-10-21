import { Effect, Layer } from "effect";
import { VirtualFileSystem, type FileSystemOptions } from "./filesystem.js";
import { FsError } from "./errors.js";
import { fileLimit, layerFileSystem } from "./internal/engine.js";
import type { NodeRecord, Storage } from "./internal/storage.js";

class MemoryStorage implements Storage {
  private nodes = new Map<number, NodeRecord>();
  private contents = new Map<number, Uint8Array>();
  private nextId = 2;

  constructor() {
    const now = Date.now();
    this.nodes.set(1, { id: 1, parentId: null, name: "", type: "directory", size: 0, createdAt: now, modifiedAt: now });
  }

  transaction<A>(body: () => A): A {
    // Records and content are replaced, never mutated, so a shallow snapshot suffices.
    const nodes = new Map(this.nodes);
    const contents = new Map(this.contents);
    const nextId = this.nextId;
    try { return body(); } catch (error) {
      this.nodes = nodes;
      this.contents = contents;
      this.nextId = nextId;
      throw error;
    }
  }
  get(id: number) { return this.nodes.get(id); }
  child(parentId: number, name: string) {
    return this.children(parentId).find((node) => node.name === name);
  }
  children(parentId: number) {
    return [...this.nodes.values()].filter((node) => node.parentId === parentId);
  }
  insert(node: Omit<NodeRecord, "id">) {
    const record = { ...node, id: this.nextId++ };
    this.nodes.set(record.id, record);
    return record;
  }
  update(node: NodeRecord) { this.nodes.set(node.id, node); }
  readContent(id: number) {
    const content = this.contents.get(id);
    if (!content) throw new Error("Missing file content");
    return content;
  }
  writeContent(id: number, data: Uint8Array) { this.contents.set(id, data.slice()); }
  delete(id: number) { this.nodes.delete(id); this.contents.delete(id); }
}

export const layerMemory = (options: FileSystemOptions = {}) =>
  Layer.unwrap(Effect.try({
    try: () => {
      const limit = fileLimit(options);
      return layerFileSystem(new MemoryStorage(), limit);
    },
    catch: (cause) => cause instanceof FsError ? cause : new FsError({
      code: "EIO", operation: "initialize", path: "/", message: "Filesystem storage operation failed", cause,
    }),
  }));

/** Convenience for composition roots and tests; every execution creates an independent filesystem. */
export const makeMemory = (options: FileSystemOptions = {}): Effect.Effect<VirtualFileSystem, FsError> =>
  Effect.provide(VirtualFileSystem, layerMemory(options));
