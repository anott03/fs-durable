import type { DirectoryEntry } from "../filesystem.js";
import type { NodeRecord, Resolved, Storage } from "./storage.js";

export class MemoryStorage implements Storage {
  private readonly nodes = new Map<number, NodeRecord>();
  private readonly index = new Map<number, Map<string, NodeRecord>>();
  private readonly contents = new Map<number, Uint8Array>();
  private readonly sharedBuffers = new WeakSet<ArrayBufferLike>();
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
  contains(ancestorId: number, id: number) {
    for (let node = this.nodes.get(id); node; node = node.parentId === null ? undefined : this.nodes.get(node.parentId)) {
      if (node.id === ancestorId) return true;
    }
    return false;
  }
  resolve(parts: ReadonlyArray<string>): Resolved {
    const root = this.nodes.get(1);
    if (!root) throw new Error("Missing filesystem root");
    let node = root;
    let depth = 0;
    for (const name of parts) {
      const child = this.index.get(node.id)?.get(name);
      if (!child) break;
      node = child;
      depth++;
    }
    return { node, depth };
  }
  children(parentId: number) { return [...(this.index.get(parentId)?.values() ?? [])]; }
  entries(parentId: number): DirectoryEntry[] {
    const entries: DirectoryEntry[] = [];
    for (const node of this.index.get(parentId)?.values() ?? []) {
      entries.push({ name: node.name, type: node.type, size: node.size, createdAt: node.createdAt, modifiedAt: node.modifiedAt });
    }
    return entries;
  }
  hasChildren(parentId: number) { return (this.index.get(parentId)?.size ?? 0) > 0; }
  insert(node: Omit<NodeRecord, "id">) {
    const id = this.nextId++;
    this.undo?.push(() => { this.nextId = id; });
    const record = { ...node, id };
    this.setNode(id, record);
    return record;
  }
  insertFile(parentId: number, name: string, data: Uint8Array, now: number) {
    const node = this.insert({ parentId, name, type: "file", size: data.byteLength, createdAt: now, modifiedAt: now });
    this.writeContent(node.id, data);
  }
  update(node: NodeRecord) { this.setNode(node.id, node); }
  move(id: number, parentId: number, name: string) {
    const node = this.nodes.get(id);
    if (node) this.setNode(id, { ...node, parentId, name });
  }
  resize(id: number, size: number, modifiedAt: number) {
    const node = this.nodes.get(id);
    if (node) this.setNode(id, { ...node, size, modifiedAt });
  }
  touch(id: number, modifiedAt: number) {
    const node = this.nodes.get(id);
    if (node) this.setNode(id, { ...node, modifiedAt });
  }
  readContent(id: number) { return this.content(id).slice(); }
  writeContent(id: number, data: Uint8Array) { this.setContent(id, data.slice()); }
  appendContent(id: number, data: Uint8Array) {
    const previous = this.content(id);
    const size = previous.byteLength + data.byteLength;
    let next: Uint8Array;
    if (!this.sharedBuffers.has(previous.buffer) && previous.buffer.byteLength >= size) {
      next = new Uint8Array(previous.buffer, 0, size);
    } else {
      const capacity = Math.max(1024, size, previous.byteLength * 2);
      next = new Uint8Array(new ArrayBuffer(capacity), 0, size);
      next.set(previous);
    }
    next.set(data, previous.byteLength);
    this.setContent(id, next);
  }
  copyContent(sourceId: number, targetId: number) {
    const source = this.content(sourceId);
    this.sharedBuffers.add(source.buffer);
    this.setContent(targetId, source);
  }
  largestFile(id: number) {
    let largest = 0;
    for (const node of this.subtree(id)) if (node.type === "file") largest = Math.max(largest, node.size);
    return largest;
  }
  copyTree(sourceId: number, parentId: number, name: string, now: number) {
    const source = this.nodes.get(sourceId);
    if (!source) throw new Error("Missing copy source");
    const queue = [{ source, parentId, name }];
    for (const item of queue) {
      const copy = this.insert({
        parentId: item.parentId, name: item.name, type: item.source.type, size: item.source.size, createdAt: now, modifiedAt: now,
      });
      if (item.source.type === "file") {
        this.copyContent(item.source.id, copy.id);
        continue;
      }
      for (const child of this.index.get(item.source.id)?.values() ?? []) {
        queue.push({ source: child, parentId: copy.id, name: child.name });
      }
    }
  }
  delete(id: number) {
    this.setNode(id, undefined);
    this.setContent(id, undefined);
  }
  deleteTree(id: number) {
    for (const node of this.subtree(id).reverse()) this.delete(node.id);
  }

  private subtree(id: number): NodeRecord[] {
    const root = this.nodes.get(id);
    if (!root) return [];
    const nodes = [root];
    for (const node of nodes) {
      for (const child of this.index.get(node.id)?.values() ?? []) nodes.push(child);
    }
    return nodes;
  }

  private content(id: number): Uint8Array {
    const content = this.contents.get(id);
    if (!content) throw new Error("Missing file content");
    return content;
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
