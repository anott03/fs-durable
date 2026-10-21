import { Context, Effect } from "effect";
import type { FsError } from "./errors.js";

export interface FileStat {
  readonly type: "file" | "directory";
  /** Bytes, or zero for directories. */
  readonly size: number;
  /** Unix milliseconds. Reads do not update timestamps. */
  readonly createdAt: number;
  readonly modifiedAt: number;
}

export interface DirectoryEntry extends FileStat {
  readonly name: string;
}

export interface FileSystemOptions {
  /** Default 1 MiB; maximum 1,900,000 bytes for the single-BLOB backend. */
  readonly maxFileBytes?: number;
}

export interface WriteOptions {
  /** Fail with EEXIST instead of replacing an existing file. Default false. */
  readonly exclusive?: boolean;
}

export interface CopyOptions {
  readonly recursive?: boolean;
  /** Replace existing files (never merge directories). Default false. */
  readonly overwrite?: boolean;
}

export interface VirtualFileSystem {
  readonly stat: (path: string) => Effect.Effect<FileStat, FsError>;
  readonly exists: (path: string) => Effect.Effect<boolean, FsError>;
  readonly readDirectory: (path: string) => Effect.Effect<ReadonlyArray<DirectoryEntry>, FsError>;
  readonly makeDirectory: (path: string, options?: { readonly recursive?: boolean }) => Effect.Effect<void, FsError>;
  readonly readFile: (path: string) => Effect.Effect<Uint8Array, FsError>;
  readonly readFileString: (path: string) => Effect.Effect<string, FsError>;
  readonly writeFile: (path: string, data: Uint8Array, options?: WriteOptions) => Effect.Effect<void, FsError>;
  readonly writeFileString: (path: string, text: string, options?: WriteOptions) => Effect.Effect<void, FsError>;
  /** Creates a missing file, but not its parents. Not replay-safe. */
  readonly appendFile: (path: string, data: Uint8Array) => Effect.Effect<void, FsError>;
  readonly appendFileString: (path: string, text: string) => Effect.Effect<void, FsError>;
  /** Extending a file fills the new bytes with zero. */
  readonly truncate: (path: string, size?: number) => Effect.Effect<void, FsError>;
  /** Replaces a file or empty directory of the same type. */
  readonly rename: (from: string, to: string) => Effect.Effect<void, FsError>;
  readonly copy: (from: string, to: string, options?: CopyOptions) => Effect.Effect<void, FsError>;
  readonly remove: (path: string, options?: { readonly recursive?: boolean; readonly force?: boolean }) => Effect.Effect<void, FsError>;
}

export const VirtualFileSystem = Context.Service<VirtualFileSystem>("do-fs/VirtualFileSystem");
