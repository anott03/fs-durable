import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../src/internal/memory-storage.js";
import type { NodeRecord } from "../src/internal/storage.js";

function seed() {
  const store = new MemoryStorage();
  const dir = store.insert({ parentId: 1, name: "dir", type: "directory", size: 0, createdAt: 1, modifiedAt: 1 });
  const file = store.insert({ parentId: dir.id, name: "file", type: "file", size: 1, createdAt: 1, modifiedAt: 1 });
  store.writeContent(file.id, new Uint8Array([1]));
  return { store, dir, file };
}

interface Entry {
  readonly node: NodeRecord | undefined;
  readonly content: number[] | undefined;
}

function snapshot(store: MemoryStorage): Entry[] {
  const entries: Entry[] = [{ node: store.get(1), content: undefined }];
  for (const entry of entries) {
    if (entry.node?.type !== "directory") continue;
    for (const child of store.children(entry.node.id).sort((a, b) => a.name.localeCompare(b.name))) {
      const content = child.type === "file" ? [...store.readContent(child.id)] : undefined;
      entries.push({ node: child, content });
    }
  }
  return entries;
}

describe("MemoryStorage transactions", () => {
  it("rolls back inserts, updates, moves, content, touches, and deletes", () => {
    const { store, dir, file } = seed();
    const before = snapshot(store);
    expect(() => store.transaction(() => {
      store.update({ ...file, parentId: 1, name: "moved", size: 2 });
      store.writeContent(file.id, new Uint8Array([9, 9]));
      const added = store.insert({ parentId: dir.id, name: "added", type: "file", size: 0, createdAt: 2, modifiedAt: 2 });
      store.writeContent(added.id, new Uint8Array());
      store.touch(1, 99);
      store.delete(dir.id);
      throw new Error("boom");
    })).toThrow("boom");
    expect(snapshot(store)).toEqual(before);
    expect(store.child(dir.id, "file")?.id).toBe(file.id);
    expect(store.child(1, "moved")).toBeUndefined();
    expect(store.child(dir.id, "added")).toBeUndefined();
  });

  it("reuses ids rolled back by a failed insert", () => {
    const { store } = seed();
    let failedId = 0;
    expect(() => store.transaction(() => {
      failedId = store.insert({ parentId: 1, name: "x", type: "directory", size: 0, createdAt: 2, modifiedAt: 2 }).id;
      throw new Error("boom");
    })).toThrow();
    expect(store.get(failedId)).toBeUndefined();
    expect(store.insert({ parentId: 1, name: "y", type: "directory", size: 0, createdAt: 2, modifiedAt: 2 }).id).toBe(failedId);
  });

  it("keeps committed changes and treats nested transactions as part of the outer one", () => {
    const { store, file } = seed();
    store.transaction(() => store.touch(file.id, 50));
    expect(store.get(file.id)?.modifiedAt).toBe(50);
    expect(() => store.transaction(() => {
      store.transaction(() => store.touch(file.id, 60));
      throw new Error("boom");
    })).toThrow();
    expect(store.get(file.id)?.modifiedAt).toBe(50);
  });

  it("keeps changes made outside a transaction when a later transaction fails", () => {
    const { store, file } = seed();
    store.touch(file.id, 70);
    expect(() => store.transaction(() => { throw new Error("boom"); })).toThrow();
    expect(store.get(file.id)?.modifiedAt).toBe(70);
  });

  it("copies written content so callers cannot mutate stored bytes", () => {
    const { store, file } = seed();
    const data = new Uint8Array([4, 5]);
    store.writeContent(file.id, data);
    data.fill(0);
    expect([...store.readContent(file.id)]).toEqual([4, 5]);
  });
});
