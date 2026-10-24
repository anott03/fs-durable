import { Effect, Layer } from "effect";
import { VirtualFileSystem, type FileSystemOptions } from "./filesystem.js";
import { FsError } from "./errors.js";
import { fileLimit, layerFileSystem } from "./internal/engine.js";
import type { NodeRecord, Storage } from "./internal/storage.js";

class MemoryStorage implements Storage {
  private readonly nodes = new Map<number, NodeRecord>();
  private readonly index = new Map<number, Map<string, NodeRecord>>();
  private readonly contents = new Map<number, Uint8Array>();
  private nextId = 2;
  private undo: Array<() => void> | undefined;

  constructor() {
    const now = Date.now();
    this.setNode(1, { id: 1, parentId: null, name: "", type: "directory", size: 0, createdAt: now, modifiedAt: now });
  }

  transaction<A>(body: () => A): A {
    if (this.undo) return body();
    const undo: Array<() => void> = [];
    this.undo = undo;
    try { return body(); } catch (error) {
      this.undo = undefined;
      for (const revert of undo.reverse()) revert();
      throw error;
    } finally {
      this.undo = undefined;
    }
  }
  get(id: number) { return this.nodes.get(id); }
  child(parentId: number, name: string) { return this.index.get(parentId)?.get(name); }
  children(parentId: number) { return [...(this.index.get(parentId)?.values() ?? [])]; }
  insert(node: Omit<NodeRecord, "id">) {
    const id = this.nextId++;
    this.undo?.push(() => { this.nextId = id; });
    const record = { ...node, id };
    this.setNode(id, record);
    return record;
  }
  update(node: NodeRecord) { this.setNode(node.id, node); }
  touch(id: number, modifiedAt: number) {
    const node = this.nodes.get(id);
    if (node) this.setNode(id, { ...node, modifiedAt });
  }
  readContent(id: number) {
    const content = this.contents.get(id);
    if (!content) throw new Error("Missing file content");
    return content;
  }
  writeContent(id: number, data: Uint8Array) { this.setContent(id, data.slice()); }
  delete(id: number) {
    this.setNode(id, undefined);
    this.setContent(id, undefined);
  }

  private siblings(parentId: number): Map<string, NodeRecord> {
    const existing = this.index.get(parentId);
    if (existing) return existing;
    const created = new Map<string, NodeRecord>();
    this.index.set(parentId, created);
    return created;
  }
  private setNode(id: number, next: NodeRecord | undefined): void {
    const previous = this.nodes.get(id);
    if (previous && previous.parentId !== null) this.siblings(previous.parentId).delete(previous.name);
    if (next) {
      this.nodes.set(id, next);
      if (next.parentId !== null) this.siblings(next.parentId).set(next.name, next);
    } else {
      this.nodes.delete(id);
      if (this.index.get(id)?.size === 0) this.index.delete(id);
    }
    this.undo?.push(() => this.setNode(id, previous));
  }
  private setContent(id: number, next: Uint8Array | undefined): void {
    const previous = this.contents.get(id);
    if (next) this.contents.set(id, next);
    else this.contents.delete(id);
    this.undo?.push(() => this.setContent(id, previous));
  }
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
