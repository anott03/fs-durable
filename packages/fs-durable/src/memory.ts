import { Effect, Layer } from "effect";
import { VirtualFileSystem, type FileSystemOptions } from "./filesystem.js";
import { FsError } from "./errors.js";
import { fileLimit, layerFileSystem } from "./internal/engine.js";
import { MemoryStorage } from "./internal/memory-storage.js";

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
