import { Effect, Layer } from "effect";
import { FsError, type FsErrorCode } from "../errors.js";
import { MAX_FILE_BYTES, VirtualFileSystem, type FileStat, type FileSystemOptions } from "../filesystem.js";
import { segments } from "./paths.js";
import type { NodeRecord, Storage } from "./storage.js";

type Fail = (code: FsErrorCode, message: string) => never;

type Lookup =
  | { readonly found: true; readonly node: NodeRecord }
  | { readonly found: false; readonly code: "ENOENT" | "ENOTDIR" };

export function fileLimit(options: FileSystemOptions): number {
  const limit = options.maxFileBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_FILE_BYTES) {
    throw new FsError({
      code: "EINVAL",
      operation: "initialize",
      path: "/",
      message: `maxFileBytes must be an integer between 0 and ${MAX_FILE_BYTES}`,
    });
  }
  return limit;
}

function makeFileSystem(store: Storage, maxFileBytes: number): VirtualFileSystem {
  function operation<A>(
    name: string,
    path: string,
    body: (parts: string[], fail: Fail) => A,
  ): Effect.Effect<A, FsError> {
    return Effect.try({
      try: () => {
        const fail: Fail = (code, message) => {
          throw new FsError({ code, operation: name, path, message });
        };
        const parsed = segments(path);
        if (!parsed.valid) return fail("EINVAL", parsed.message);
        return store.transaction(() => body(parsed.parts, fail));
      },
      catch: (cause) => cause instanceof FsError ? cause : new FsError({
        code: "EIO", operation: name, path, message: "Filesystem storage operation failed", cause,
      }),
    });
  }

  function root(): NodeRecord {
    const node = store.get(1);
    if (!node) throw new Error("Missing filesystem root");
    return node;
  }
  function parentId(node: NodeRecord): number {
    if (node.parentId === null) throw new Error("Expected a non-root node");
    return node.parentId;
  }
  function directory(node: NodeRecord, fail: Fail): NodeRecord {
    if (node.type !== "directory") fail("ENOTDIR", "A path component is not a directory");
    return node;
  }
  function file(node: NodeRecord, fail: Fail): NodeRecord {
    if (node.type !== "file") fail("EISDIR", "Expected a file, found a directory");
    return node;
  }
  function lookup(parts: string[]): Lookup {
    let node = root();
    for (const name of parts) {
      if (node.type !== "directory") return { found: false, code: "ENOTDIR" };
      const child = store.child(node.id, name);
      if (!child) return { found: false, code: "ENOENT" };
      node = child;
    }
    return { found: true, node };
  }
  function found(result: Lookup, fail: Fail): NodeRecord {
    if (result.found) return result.node;
    return result.code === "ENOENT"
      ? fail("ENOENT", "Path does not exist")
      : fail("ENOTDIR", "A path component is not a directory");
  }
  function resolve(parts: string[], fail: Fail): NodeRecord {
    return found(lookup(parts), fail);
  }
  function destination(parts: string[], fail: Fail) {
    const name = parts.at(-1);
    if (name === undefined) return fail("EBUSY", "Cannot replace or remove the filesystem root");
    return { parent: directory(resolve(parts.slice(0, -1), fail), fail), name };
  }
  function checkSize(size: number, fail: Fail): void {
    if (!Number.isSafeInteger(size) || size < 0) fail("EINVAL", "Size must be a non-negative safe integer");
    if (size > maxFileBytes) fail("EFBIG", `File exceeds the ${maxFileBytes} byte limit`);
  }
  function touch(id: number): void {
    store.touch(id, Date.now());
  }
  function createDirectory(parent: number, name: string): NodeRecord {
    const now = Date.now();
    return store.insert({ parentId: parent, name, type: "directory", size: 0, createdAt: now, modifiedAt: now });
  }
  function createFile(parent: number, name: string, data: Uint8Array, fail: Fail): void {
    checkSize(data.byteLength, fail);
    const now = Date.now();
    const node = store.insert({
      parentId: parent, name, type: "file", size: data.byteLength, createdAt: now, modifiedAt: now,
    });
    store.writeContent(node.id, data);
  }
  function write(node: NodeRecord, data: Uint8Array, fail: Fail): void {
    checkSize(data.byteLength, fail);
    store.writeContent(node.id, data);
    store.update({ ...node, size: data.byteLength, modifiedAt: Date.now() });
  }
  function fileTarget(parts: string[], fail: Fail) {
    if (parts.length === 0) return fail("EISDIR", "Expected a file, found a directory");
    const { parent, name } = destination(parts, fail);
    return { parent, name, existing: store.child(parent.id, name) };
  }
  function put(parts: string[], data: Uint8Array, exclusive: boolean, fail: Fail): void {
    const { parent, name, existing } = fileTarget(parts, fail);
    if (!existing) {
      createFile(parent.id, name, data, fail);
      touch(parent.id);
      return;
    }
    if (exclusive) return fail("EEXIST", "Destination already exists");
    write(file(existing, fail), data, fail);
  }
  function encode(text: string, fail: Fail): Uint8Array {
    // UTF-8 needs at least as many bytes as UTF-16 code units. Reject obviously
    // oversized strings before allocating their encoded representation.
    checkSize(text.length, fail);
    const data = new TextEncoder().encode(text);
    checkSize(data.byteLength, fail);
    return data;
  }
  function append(parts: string[], data: Uint8Array, fail: Fail): void {
    const { parent, name, existing } = fileTarget(parts, fail);
    if (!existing) {
      createFile(parent.id, name, data, fail);
      touch(parent.id);
      return;
    }
    const node = file(existing, fail);
    checkSize(node.size + data.byteLength, fail);
    const content = new Uint8Array(node.size + data.byteLength);
    content.set(store.readContent(node.id));
    content.set(data, node.size);
    write(node, content, fail);
  }
  function secondPath(path: string, fail: Fail): string[] {
    const parsed = segments(path);
    return parsed.valid ? parsed.parts : fail("EINVAL", parsed.message);
  }
  function read(parts: string[], fail: Fail): Uint8Array {
    return store.readContent(file(resolve(parts, fail), fail).id).slice();
  }
  function checkNotDescendant(source: NodeRecord, parent: NodeRecord, fail: Fail): void {
    let ancestor: NodeRecord | undefined = parent;
    while (ancestor) {
      if (ancestor.id === source.id) fail("EINVAL", "Destination is inside the source directory");
      ancestor = ancestor.parentId === null ? undefined : store.get(ancestor.parentId);
    }
  }
  function stat(node: NodeRecord): FileStat {
    return { type: node.type, size: node.size, createdAt: node.createdAt, modifiedAt: node.modifiedAt };
  }

  const fs: VirtualFileSystem = {
    stat: (path) => operation("stat", path, (parts, fail) => stat(resolve(parts, fail))),
    exists: (path) => operation("exists", path, (parts) => lookup(parts).found),
    readDirectory: (path) => operation("readDirectory", path, (parts, fail) => {
      const node = directory(resolve(parts, fail), fail);
      return store.children(node.id)
        .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
        .map((child) => ({ name: child.name, ...stat(child) }));
    }),
    makeDirectory: (path, options = {}) => operation("makeDirectory", path, (parts, fail) => {
      if (!options.recursive) {
        if (parts.length === 0) return fail("EEXIST", "Root already exists");
        const { parent, name } = destination(parts, fail);
        if (store.child(parent.id, name)) return fail("EEXIST", "Path already exists");
        createDirectory(parent.id, name);
        touch(parent.id);
        return;
      }
      let node = root();
      let created = false;
      for (const [index, name] of parts.entries()) {
        const existing = store.child(node.id, name);
        if (existing) {
          if (existing.type === "file" && index === parts.length - 1) {
            return fail("EEXIST", "Path already exists as a file");
          }
          node = directory(existing, fail);
          continue;
        }
        if (!created) touch(node.id);
        created = true;
        node = createDirectory(node.id, name);
      }
    }),
    readFile: (path) => operation("readFile", path, read),
    readFileString: (path) => operation("readFileString", path, (parts, fail) =>
      new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(read(parts, fail))),
    writeFile: (path, data, options = {}) => operation("writeFile", path, (parts, fail) =>
      put(parts, data, options.exclusive ?? false, fail)),
    writeFileString: (path, text, options = {}) => operation("writeFileString", path, (parts, fail) =>
      put(parts, encode(text, fail), options.exclusive ?? false, fail)),
    appendFile: (path, data) => operation("appendFile", path, (parts, fail) =>
      append(parts, data, fail)),
    appendFileString: (path, text) => operation("appendFileString", path, (parts, fail) =>
      append(parts, encode(text, fail), fail)),
    truncate: (path, size = 0) => operation("truncate", path, (parts, fail) => {
      checkSize(size, fail);
      const node = file(resolve(parts, fail), fail);
      const content = new Uint8Array(size);
      content.set(store.readContent(node.id).subarray(0, size));
      write(node, content, fail);
    }),
    remove: (path, options = {}) => operation("remove", path, (parts, fail) => {
      if (parts.length === 0) return fail("EBUSY", "Cannot remove the filesystem root");
      const result = lookup(parts);
      if (!result.found && result.code === "ENOENT" && options.force) return;
      const node = found(result, fail);
      if (node.type === "directory" && !options.recursive && store.children(node.id).length > 0) {
        return fail("ENOTEMPTY", "Directory is not empty");
      }
      const nodes = [node];
      for (const current of nodes) {
        if (current.type === "directory") nodes.push(...store.children(current.id));
      }
      for (const current of nodes.reverse()) store.delete(current.id);
      touch(parentId(node));
    }),
    rename: (from, to) => operation("rename", from, (parts, fail) => {
      if (parts.length === 0) return fail("EBUSY", "Cannot rename the filesystem root");
      const source = resolve(parts, fail);
      const { parent, name } = destination(secondPath(to, fail), fail);
      const existing = store.child(parent.id, name);
      if (existing?.id === source.id) return;
      checkNotDescendant(source, parent, fail);
      if (existing) {
        if (existing.type !== source.type) {
          return fail(existing.type === "directory" ? "EISDIR" : "ENOTDIR", "Cannot replace a different node type");
        }
        if (existing.type === "directory" && store.children(existing.id).length > 0) {
          return fail("ENOTEMPTY", "Destination directory is not empty");
        }
        store.delete(existing.id);
      }
      const sourceParent = parentId(source);
      store.update({ ...source, parentId: parent.id, name });
      touch(sourceParent);
      if (parent.id !== sourceParent) touch(parent.id);
    }),
    copy: (from, to, options = {}) => operation("copy", from, (parts, fail) => {
      if (parts.length === 0) return fail("EBUSY", "Copy a directory below the root instead");
      const source = resolve(parts, fail);
      const { parent, name } = destination(secondPath(to, fail), fail);
      checkNotDescendant(source, parent, fail);
      const existing = store.child(parent.id, name);
      if (existing?.id === source.id) return fail("EINVAL", "Cannot copy a path onto itself");
      if (source.type === "directory" && !options.recursive) {
        return fail("EISDIR", "Directory copy requires recursive: true");
      }
      if (existing) {
        if (!options.overwrite) return fail("EEXIST", "Destination already exists");
        if (source.type === "directory") {
          return fail("EEXIST", "Directory merging and replacement are not supported by copy");
        }
        if (existing.type === "directory") return fail("EISDIR", "Cannot overwrite a directory with a file");
        write(existing, store.readContent(source.id), fail);
        return;
      }
      const queue = [{ source, parent: parent.id, name }];
      for (const item of queue) {
        if (item.source.type === "file") {
          createFile(item.parent, item.name, store.readContent(item.source.id), fail);
          continue;
        }
        const node = createDirectory(item.parent, item.name);
        for (const child of store.children(item.source.id)) {
          queue.push({ source: child, parent: node.id, name: child.name });
        }
      }
      touch(parent.id);
    }),
  };
  return fs;
}

/** The capability owns construction; backends compose this layer with their storage. */
export const layerFileSystem = (store: Storage, maxFileBytes: number) =>
  Layer.sync(VirtualFileSystem, () => makeFileSystem(store, maxFileBytes));
