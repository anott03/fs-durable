import { Effect, Layer } from "effect";
import { FsError, type FsErrorCode } from "../errors.js";
import { MAX_FILE_BYTES, VirtualFileSystem, type FileStat, type FileSystemOptions } from "../filesystem.js";
import { segments } from "./paths.js";
import type { NodeRecord, Storage } from "./storage.js";

type Fail = (code: FsErrorCode, message: string) => never;

interface Target {
  readonly parentId: number;
  readonly name: string;
  readonly existing: NodeRecord | undefined;
  readonly parentModifiedAt?: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });

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
    mutates: boolean,
    body: (parts: string[], fail: Fail) => A,
  ): Effect.Effect<A, FsError> {
    return Effect.try({
      try: () => {
        const fail: Fail = (code, message) => {
          throw new FsError({ code, operation: name, path, message });
        };
        const parsed = segments(path);
        if (!parsed.valid) return fail("EINVAL", parsed.message);
        return mutates ? store.transaction(() => body(parsed.parts, fail)) : body(parsed.parts, fail);
      },
      catch: (cause) => cause instanceof FsError ? cause : new FsError({
        code: "EIO", operation: name, path, message: "Filesystem storage operation failed", cause,
      }),
    });
  }

  function missing(node: NodeRecord, fail: Fail): never {
    return node.type === "file"
      ? fail("ENOTDIR", "A path component is not a directory")
      : fail("ENOENT", "Path does not exist");
  }
  function resolve(parts: string[], fail: Fail): NodeRecord {
    const { node, depth } = store.resolve(parts);
    return depth === parts.length ? node : missing(node, fail);
  }
  function target(parts: string[], fail: Fail): Target {
    const name = parts.at(-1);
    if (name === undefined) return fail("EBUSY", "Cannot replace or remove the filesystem root");
    const { node, depth } = store.resolve(parts);
    if (depth === parts.length) {
      if (node.parentId === null) throw new Error("Expected a non-root node");
      return { parentId: node.parentId, name, existing: node };
    }
    if (depth === parts.length - 1 && node.type === "directory") return { parentId: node.id, name, existing: undefined, parentModifiedAt: node.modifiedAt };
    return missing(node, fail);
  }
  function directory(node: NodeRecord, fail: Fail): NodeRecord {
    if (node.type !== "directory") fail("ENOTDIR", "A path component is not a directory");
    return node;
  }
  function file(node: NodeRecord, fail: Fail): NodeRecord {
    if (node.type !== "file") fail("EISDIR", "Expected a file, found a directory");
    return node;
  }
  function checkSize(size: number, fail: Fail): void {
    if (!Number.isSafeInteger(size) || size < 0) fail("EINVAL", "Size must be a non-negative safe integer");
    if (size > maxFileBytes) fail("EFBIG", `File exceeds the ${maxFileBytes} byte limit`);
  }
  function createDirectory(parentId: number, name: string, now: number): NodeRecord {
    return store.insert({ parentId, name, type: "directory", size: 0, createdAt: now, modifiedAt: now });
  }
  function createFile(parentId: number, name: string, data: Uint8Array, fail: Fail, parentModifiedAt?: number): void {
    checkSize(data.byteLength, fail);
    const now = Date.now();
    store.insertFile(parentId, name, data, now);
    if (parentModifiedAt !== now) store.touch(parentId, now);
  }
  function write(node: NodeRecord, data: Uint8Array, fail: Fail): void {
    checkSize(data.byteLength, fail);
    store.writeContent(node.id, data);
    store.resize(node.id, data.byteLength, Date.now());
  }
  function fileTarget(parts: string[], fail: Fail): Target {
    if (parts.length === 0) return fail("EISDIR", "Expected a file, found a directory");
    return target(parts, fail);
  }
  function put(parts: string[], data: Uint8Array, exclusive: boolean, fail: Fail): void {
    const { parentId, name, existing, parentModifiedAt } = fileTarget(parts, fail);
    if (!existing) return createFile(parentId, name, data, fail, parentModifiedAt);
    if (exclusive) return fail("EEXIST", "Destination already exists");
    write(file(existing, fail), data, fail);
  }
  function encode(text: string, fail: Fail): Uint8Array {
    // UTF-8 needs at least as many bytes as UTF-16 code units. Reject obviously
    // oversized strings before allocating their encoded representation.
    checkSize(text.length, fail);
    const data = encoder.encode(text);
    checkSize(data.byteLength, fail);
    return data;
  }
  function append(parts: string[], data: Uint8Array, fail: Fail): void {
    const { parentId, name, existing, parentModifiedAt } = fileTarget(parts, fail);
    if (!existing) return createFile(parentId, name, data, fail, parentModifiedAt);
    const node = file(existing, fail);
    const size = node.size + data.byteLength;
    checkSize(size, fail);
    if (data.byteLength > 0) store.appendContent(node.id, data);
    store.resize(node.id, size, Date.now());
  }
  function secondPath(path: string, fail: Fail): string[] {
    const parsed = segments(path);
    return parsed.valid ? parsed.parts : fail("EINVAL", parsed.message);
  }
  function read(parts: string[], fail: Fail): Uint8Array {
    return store.readContent(file(resolve(parts, fail), fail).id);
  }
  function checkNotDescendant(source: NodeRecord, parentId: number, fail: Fail): void {
    if (source.type === "directory" && store.contains(source.id, parentId)) {
      fail("EINVAL", "Destination is inside the source directory");
    }
  }
  function stat(node: NodeRecord): FileStat {
    return { type: node.type, size: node.size, createdAt: node.createdAt, modifiedAt: node.modifiedAt };
  }

  const fs: VirtualFileSystem = {
    stat: (path) => operation("stat", path, false, (parts, fail) => stat(resolve(parts, fail))),
    exists: (path) => operation("exists", path, false, (parts) => store.resolve(parts).depth === parts.length),
    readDirectory: (path) => operation("readDirectory", path, false, (parts, fail) => {
      const node = directory(resolve(parts, fail), fail);
      return store.entries(node.id).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    }),
    makeDirectory: (path, options = {}) => operation("makeDirectory", path, true, (parts, fail) => {
      if (!options.recursive) {
        if (parts.length === 0) return fail("EEXIST", "Root already exists");
        const { parentId, name, existing } = target(parts, fail);
        if (existing) return fail("EEXIST", "Path already exists");
        const now = Date.now();
        createDirectory(parentId, name, now);
        store.touch(parentId, now);
        return;
      }
      const { node, depth } = store.resolve(parts);
      if (node.type === "file") {
        return depth === parts.length
          ? fail("EEXIST", "Path already exists as a file")
          : fail("ENOTDIR", "A path component is not a directory");
      }
      if (depth === parts.length) return;
      const now = Date.now();
      store.touch(node.id, now);
      let parentId = node.id;
      for (const name of parts.slice(depth)) parentId = createDirectory(parentId, name, now).id;
    }),
    readFile: (path) => operation("readFile", path, false, read),
    readFileString: (path) => operation("readFileString", path, false, (parts, fail) => decoder.decode(read(parts, fail))),
    writeFile: (path, data, options = {}) => operation("writeFile", path, true, (parts, fail) =>
      put(parts, data, options.exclusive ?? false, fail)),
    writeFileString: (path, text, options = {}) => operation("writeFileString", path, true, (parts, fail) =>
      put(parts, encode(text, fail), options.exclusive ?? false, fail)),
    appendFile: (path, data) => operation("appendFile", path, true, (parts, fail) =>
      append(parts, data, fail)),
    appendFileString: (path, text) => operation("appendFileString", path, true, (parts, fail) =>
      append(parts, encode(text, fail), fail)),
    truncate: (path, size = 0) => operation("truncate", path, true, (parts, fail) => {
      checkSize(size, fail);
      const node = file(resolve(parts, fail), fail);
      const content = new Uint8Array(size);
      content.set(store.readContent(node.id).subarray(0, size));
      write(node, content, fail);
    }),
    remove: (path, options = {}) => operation("remove", path, true, (parts, fail) => {
      if (parts.length === 0) return fail("EBUSY", "Cannot remove the filesystem root");
      const { node, depth } = store.resolve(parts);
      if (depth !== parts.length) {
        if (node.type === "directory" && options.force) return;
        return missing(node, fail);
      }
      if (node.parentId === null) throw new Error("Expected a non-root node");
      if (node.type === "file") store.delete(node.id);
      else if (!store.hasChildren(node.id)) store.delete(node.id);
      else if (options.recursive) store.deleteTree(node.id);
      else return fail("ENOTEMPTY", "Directory is not empty");
      store.touch(node.parentId, Date.now());
    }),
    rename: (from, to) => operation("rename", from, true, (parts, fail) => {
      if (parts.length === 0) return fail("EBUSY", "Cannot rename the filesystem root");
      const source = resolve(parts, fail);
      const { parentId, name, existing } = target(secondPath(to, fail), fail);
      if (existing?.id === source.id) return;
      checkNotDescendant(source, parentId, fail);
      if (existing) {
        if (existing.type !== source.type) {
          return fail(existing.type === "directory" ? "EISDIR" : "ENOTDIR", "Cannot replace a different node type");
        }
        if (existing.type === "directory" && store.hasChildren(existing.id)) {
          return fail("ENOTEMPTY", "Destination directory is not empty");
        }
        store.delete(existing.id);
      }
      if (source.parentId === null) throw new Error("Expected a non-root node");
      store.move(source.id, parentId, name);
      const now = Date.now();
      store.touch(source.parentId, now);
      if (parentId !== source.parentId) store.touch(parentId, now);
    }),
    copy: (from, to, options = {}) => operation("copy", from, true, (parts, fail) => {
      if (parts.length === 0) return fail("EBUSY", "Copy a directory below the root instead");
      const source = resolve(parts, fail);
      const { parentId, name, existing } = target(secondPath(to, fail), fail);
      checkNotDescendant(source, parentId, fail);
      if (existing?.id === source.id) return fail("EINVAL", "Cannot copy a path onto itself");
      if (source.type === "directory" && !options.recursive) {
        return fail("EISDIR", "Directory copy requires recursive: true");
      }
      const now = Date.now();
      if (existing) {
        if (!options.overwrite) return fail("EEXIST", "Destination already exists");
        if (source.type === "directory") {
          return fail("EEXIST", "Directory merging and replacement are not supported by copy");
        }
        if (existing.type === "directory") return fail("EISDIR", "Cannot overwrite a directory with a file");
        checkSize(source.size, fail);
        store.copyContent(source.id, existing.id);
        store.resize(existing.id, source.size, now);
        return;
      }
      if (source.type === "file") {
        checkSize(source.size, fail);
        const node = store.insert({ parentId, name, type: "file", size: source.size, createdAt: now, modifiedAt: now });
        store.copyContent(source.id, node.id);
      } else {
        checkSize(store.largestFile(source.id), fail);
        store.copyTree(source.id, parentId, name, now);
      }
      store.touch(parentId, now);
    }),
  };
  return fs;
}

/** The capability owns construction; backends compose this layer with their storage. */
export const layerFileSystem = (store: Storage, maxFileBytes: number) =>
  Layer.sync(VirtualFileSystem, () => makeFileSystem(store, maxFileBytes));
