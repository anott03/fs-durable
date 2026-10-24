# fs-durable

An Effect 4 virtual filesystem for small Cloudflare Durable Object workspaces.
Proof of concept; not a Node `fs` replacement. ESM and TypeScript declarations,
with **`effect` as the only runtime peer dependency**. The library itself imports
no Node APIs and requires no ORM, SQLite driver, or Cloudflare runtime imports.

## In a Durable Object

The host owns its Durable Object, storage, and Effect runtime. The library only
uses `storage.sql.exec()` and `storage.transactionSync()`.

```ts
import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";
import { layerDurableObject } from "fs-durable/durable-object";
import { VirtualFileSystem } from "fs-durable";

export class Workspace extends DurableObject {
  private readonly fs: VirtualFileSystem;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    this.fs = Effect.runSync(Effect.provide(VirtualFileSystem, layerDurableObject(this.ctx.storage)));
  }

  async saveCode(code: string) {
    const fs = this.fs;
    await Effect.runPromise(Effect.gen(function* () {
      yield* fs.makeDirectory("/src", { recursive: true });
      yield* fs.writeFileString("/src/main.ts", code);
    }));
  }

  async readCode() {
    return Effect.runPromise(this.fs.readFileString("/src/main.ts"));
  }
}
```

Use a SQLite-backed DO class (`new_sqlite_classes` in your Wrangler migration).
See [`examples/durable-object`](examples/durable-object) for a typechecked example
and config. Its default HTTP handler deliberately exposes no filesystem access.
Trusted application code can call `env.WORKSPACES.getByName(workspaceId).write(...)`
and `.read(...)`. Authentication, tenant routing, and authorization belong to the
host; a virtual path is not an authorization boundary.

Initialization is synchronous, transactional, and idempotent. Run it once per
DO instance, during construction. No `blockConcurrencyWhile()` is needed for
this entirely synchronous setup. Reopening does not reset files. Do not wrap
`Effect.runPromise()` inside `transactionSync()`.

## Effect service and memory backend

```ts
import { Effect } from "effect";
import { VirtualFileSystem } from "fs-durable";
import { layerMemory } from "fs-durable/memory";

const program = Effect.gen(function* () {
  const fs = yield* VirtualFileSystem;
  yield* fs.writeFileString("/hello.txt", "hello");
  return yield* fs.readFileString("/hello.txt");
});

const text = await Effect.runPromise(
  program.pipe(Effect.provide(layerMemory({ maxFileBytes: 1024 * 1024 }))),
);
```

`makeMemory(options?)` returns an Effect that creates a fresh filesystem on each
execution. `layerDurableObject(storage, options?)` provides the same service over
DO storage. This is a focused `VirtualFileSystem` service, **not** an implementation
of Effect's larger `FileSystem` interface.

## Operations

Every operation returns an `Effect<Success, FsError>`. No persistence occurs until
the Effect is run. Bytes are copied when executing writes and reads; modifying a
read result never modifies stored data. Don't mutate a write input before its
Effect has finished.

| Operation | Behavior |
| --- | --- |
| `stat(path)` | Type, byte size, creation and modification times |
| `exists(path)` | ENOENT and ENOTDIR become `false`; invalid paths and storage errors fail |
| `readDirectory(path)` | Immediate entries, including stats, sorted by JS string order |
| `makeDirectory(path, { recursive? })` | Recursive mode accepts existing directories; an existing file fails with EEXIST |
| `readFile(path)` / `readFileString(path)` | Bytes / UTF-8 text; malformed UTF-8 uses replacement characters |
| `writeFile(path, bytes, { exclusive? })` / `writeFileString(...)` | Create or replace; parents must exist |
| `appendFile(path, bytes)` / `appendFileString(path, text)` | Create or append; parents must exist |
| `truncate(path, size = 0)` | Existing files only; zero-fill when growing |
| `rename(from, to)` | Move files or trees; replace files or empty directories of the same type; preserves the moved node's `modifiedAt` |
| `copy(from, to, { recursive?, overwrite? })` | Independent copy; directories require recursive mode; overwrite replaces only files (EISDIR for a directory destination) |
| `remove(path, { recursive?, force? })` | Nonempty directories require recursive mode; force ignores only ENOENT |

Copies use the exact destination path, not shell `cp` destination-directory
semantics. They never merge directories. Copying onto itself or inside the source
fails. Renaming onto itself succeeds. Root cannot be removed, renamed, copied,
or replaced.

### Paths

- Absolute, case-sensitive virtual paths only; no process-global working directory.
- Lexically collapse repeated `/`, `.`, and `..`; reject attempts to escape `/`.
- **Not full POSIX traversal:** trailing slashes are ignored, and `/file/..` is
  normalized lexically rather than checking whether `file` is a directory.
- Reject NUL, paths over 4096 UTF-8 bytes, and names over 255 UTF-8 bytes.
- Backslashes are literal characters, not Windows separators. No Unicode normalization.

### Errors

`FsError` is a tagged Effect error with `code`, `operation`, `path`, `message`, and
an optional storage `cause`. Codes: `ENOENT`, `EEXIST`, `ENOTDIR`, `EISDIR`,
`ENOTEMPTY`, `EINVAL`, `EBUSY`, `EFBIG`, and `EIO`. For two-path operations,
`path` identifies the source. Underlying storage errors become `EIO` and roll back
the operation; inspect their cause for diagnostics, not for portable application logic.

```ts
const content = fs.readFileString("/optional.txt").pipe(
  Effect.catchTag("FsError", (error) =>
    error.code === "ENOENT" ? Effect.succeed("") : Effect.fail(error)),
);
```

## Storage and consistency

- One filesystem per DO storage, using reserved `fs_durable_schema`, `fs_durable_nodes`,
  and `fs_durable_contents` tables. Other host tables are untouched. Schema version 1
  is created transactionally; unknown versions fail instead of being overwritten.
  The table prefix is part of the storage format; renaming it does not migrate existing data.
- Nodes use parent IDs and names, so directory moves do not rewrite descendants.
  Content is stored separately from metadata, as one BLOB per file.
- `maxFileBytes` defaults to **1 MiB** and is configurable from 0 to **1,900,000**
  bytes. This conservatively fits Cloudflare's current 2 MB SQL row/BLOB limit.
  Text limits count UTF-8 bytes, not characters. Files above a newly lowered limit
  remain readable; writes and copies that would store them fail with EFBIG.
- Each operation runs synchronously inside one `transactionSync()` callback.
  Failures roll back all its changes, including partially copied or removed trees.
  Cursors are fully consumed before returning. No in-memory filesystem cache
  needs to survive eviction; DO output gates provide the platform's normal
  durability guarantees.
- A sequence of separate filesystem operations is **not** a transaction. Effects
  may interleave between operations. A failure or interruption after an operation
  commits does not undo it. In particular, retrying an append may duplicate data.
- The library does not manipulate alarms, call `deleteAll()`, or restore the DO's
  database through PITR.

## Limits and non-goals

Designed for small workspaces: whole-file reads/writes, whole-tree atomic
copy/removal, and a simple memory backend that rolls back failed operations from an undo log. There is no aggregate
workspace quota or pagination yet; hosts must bound total usage and operation
sizes. Large trees can exhaust CPU or memory even with small individual files.

No shell/code execution, links, permissions, ownership, file descriptors,
streaming, watchers, mounts, snapshots, cross-DO transactions, Node adapter, or
Pi dependency. A virtual filesystem stores code; it does not sandbox or execute it.

## Development

```sh
pnpm install
pnpm --workspace-root lint
pnpm typecheck
pnpm test
pnpm build
pnpm example:dev
```

Tests run the same conformance suite against memory in Node and SQLite in the
Workers runtime, plus failure-injection, schema, maximum-file-size, and actual
DO eviction tests. `pnpm example:types` regenerates the example's binding types
after config changes; runtime types come from the development-only
`@cloudflare/workers-types` package. No Cloudflare account or deployment is needed to test.

Package exports are `.`, `./memory`, and `./durable-object`. The package is a local
POC and has not been published to npm.

Linting uses Oxlint with the vendored generic and Effect anti-slop plugins in
`../../tools/oxlint/anti-slop/`. All anti-slop rules are errors. Generated output and
agent tooling are excluded. The Effect rule checks relative project imports;
package-alias imports are not currently enforced by that rule.
