import { Data } from "effect";

export type FsErrorCode =
  | "ENOENT" | "EEXIST" | "ENOTDIR" | "EISDIR" | "ENOTEMPTY"
  | "EINVAL" | "EBUSY" | "EFBIG" | "EIO";

/** All expected filesystem failures, including underlying storage failures. */
export class FsError extends Data.TaggedError("FsError")<{
  readonly code: FsErrorCode;
  readonly operation: string;
  readonly path: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}
