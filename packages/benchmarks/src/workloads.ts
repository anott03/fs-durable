import { Cause, Data, Effect, Exit } from "effect";
import { MAX_FILE_BYTES, type FsError, type VirtualFileSystem } from "fs-durable";

const KiB = 1024;
const MiB = 1024 * KiB;
const ROOT = "/bench";
const DIR = `${ROOT}/s`;
const MAX_BATCH_BYTES = 64 * MiB;
const MAX_BATCH_NODES = 20_000;
const MAX_BATCH_OPS = 20_000;
const TREE_DIRS = 10;
const TREE_FILES_PER_DIR = 10;
const TREE_FILE_BYTES = KiB;
const TREE_FILES = TREE_DIRS * TREE_FILES_PER_DIR;
const TREE_NODES = 1 + TREE_DIRS + TREE_FILES;

export const FILESYSTEM_OPTIONS = { maxFileBytes: MAX_FILE_BYTES } as const;

export class BenchmarkCheckError extends Data.TaggedError("BenchmarkCheckError")<{
  readonly message: string;
}> {}

type BatchError = FsError | BenchmarkCheckError;

export interface PreparedBatch {
  readonly run: Effect.Effect<number, BatchError>;
  readonly verify: (checksum: number) => Effect.Effect<void, BatchError>;
}

export type CaseParam = string | number;

export interface CaseDefinition {
  readonly id: string;
  readonly operation: string;
  readonly params: Readonly<Record<string, CaseParam>>;
  readonly bytesPerOp: number;
  readonly defaultIterations: number;
  readonly maxIterations: number;
  readonly prepare: (fs: VirtualFileSystem, iterations: number) => Effect.Effect<PreparedBatch, BatchError>;
}

type Encoding = "binary" | "utf8";

const check = (condition: boolean, message: string): Effect.Effect<void, BenchmarkCheckError> =>
  condition ? Effect.void : Effect.fail(new BenchmarkCheckError({ message }));

const binaryPayload = (size: number): Uint8Array => {
  const data = new Uint8Array(size);
  for (let index = 0; index < size; index++) data[index] = (index * 31 + 7) & 255;
  return data;
};

const UTF8_UNIT = "aé€😀";
const UTF8_UNIT_BYTES = 10;

const utf8Payload = (size: number): string => {
  const units = Math.floor(size / UTF8_UNIT_BYTES);
  return UTF8_UNIT.repeat(units) + "x".repeat(size - units * UTF8_UNIT_BYTES);
};

const bytesChecksum = (data: Uint8Array): number =>
  data.length + (data[0] ?? 0) + (data[data.length - 1] ?? 0);

const textChecksum = (text: string): number =>
  text.length + (text.charCodeAt(0) || 0) + (text.charCodeAt(text.length - 1) || 0);

const indexedPaths = (prefix: string, count: number): ReadonlyArray<string> =>
  Array.from({ length: count }, (_, index) => `${prefix}${index}`);

const lastOf = (paths: ReadonlyArray<string>): string => paths[paths.length - 1] ?? DIR;

const resetFixture = (fs: VirtualFileSystem) =>
  Effect.gen(function* () {
    yield* fs.remove(ROOT, { recursive: true, force: true });
    yield* fs.makeDirectory(DIR, { recursive: true });
  });

export const removeFixtures = (fs: VirtualFileSystem) => fs.remove(ROOT, { recursive: true, force: true });

const makeTree = (fs: VirtualFileSystem, root: string, payload: Uint8Array) =>
  Effect.gen(function* () {
    yield* fs.makeDirectory(root);
    for (let dir = 0; dir < TREE_DIRS; dir++) {
      yield* fs.makeDirectory(`${root}/d${dir}`);
      for (let file = 0; file < TREE_FILES_PER_DIR; file++) {
        yield* fs.writeFile(`${root}/d${dir}/f${file}`, payload);
      }
    }
  });

const treeLeaf = (root: string): string => `${root}/d${TREE_DIRS - 1}/f${TREE_FILES_PER_DIR - 1}`;

const expectFileSize = (fs: VirtualFileSystem, path: string, size: number) =>
  Effect.gen(function* () {
    const stat = yield* fs.stat(path);
    yield* check(stat.type === "file" && stat.size === size, `${path}: expected ${size} bytes, found ${stat.size}`);
  });

const expectChecksum = (actual: number, expected: number) =>
  check(actual === expected, `checksum ${actual} does not match expected ${expected}`);

const repeat = (paths: ReadonlyArray<string>, op: (path: string) => Effect.Effect<number, BatchError>) =>
  Effect.gen(function* () {
    let checksum = 0;
    for (const path of paths) checksum += yield* op(path);
    return checksum;
  });

const sameOp = (iterations: number, op: Effect.Effect<number, BatchError>) =>
  Effect.gen(function* () {
    let checksum = 0;
    for (let index = 0; index < iterations; index++) checksum += yield* op;
    return checksum;
  });

const writer = (fs: VirtualFileSystem, encoding: Encoding, size: number, exclusive: boolean) => {
  if (encoding === "binary") {
    const data = binaryPayload(size);
    return (path: string) => fs.writeFile(path, data, { exclusive }).pipe(Effect.as(1));
  }
  const text = utf8Payload(size);
  return (path: string) => fs.writeFileString(path, text, { exclusive }).pipe(Effect.as(1));
};

const iterationCap = (bytesPerOp: number, nodesPerOp: number): number =>
  Math.max(1, Math.min(
    MAX_BATCH_OPS,
    bytesPerOp > 0 ? Math.floor(MAX_BATCH_BYTES / bytesPerOp) : MAX_BATCH_OPS,
    nodesPerOp > 0 ? Math.floor(MAX_BATCH_NODES / nodesPerOp) : MAX_BATCH_OPS,
  ));

const sizes = [
  { label: "1KiB", bytes: KiB, iterations: 500 },
  { label: "64KiB", bytes: 64 * KiB, iterations: 100 },
  { label: "1MiB", bytes: MiB, iterations: 10 },
] as const;

const encodings: ReadonlyArray<Encoding> = ["binary", "utf8"];

const writeCreateCases = encodings.flatMap((encoding) => sizes.map((size): CaseDefinition => ({
  id: `write.create.${encoding}.${size.label}`,
  operation: encoding === "binary" ? "writeFile" : "writeFileString",
  params: { encoding, bytes: size.bytes, exclusive: "true" },
  bytesPerOp: size.bytes,
  defaultIterations: size.iterations,
  maxIterations: iterationCap(size.bytes, 1),
  prepare: (fs, iterations) => Effect.gen(function* () {
    yield* resetFixture(fs);
    const paths = indexedPaths(`${DIR}/f`, iterations);
    const write = writer(fs, encoding, size.bytes, true);
    return {
      run: repeat(paths, write),
      verify: (checksum) => Effect.gen(function* () {
        yield* expectChecksum(checksum, iterations);
        yield* expectFileSize(fs, lastOf(paths), size.bytes);
      }),
    };
  }),
})));

const writeOverwriteCases = encodings.flatMap((encoding) => sizes.map((size): CaseDefinition => ({
  id: `write.overwrite.${encoding}.${size.label}`,
  operation: encoding === "binary" ? "writeFile" : "writeFileString",
  params: { encoding, bytes: size.bytes, existingBytes: size.bytes },
  bytesPerOp: size.bytes,
  defaultIterations: size.iterations,
  maxIterations: iterationCap(size.bytes, 0),
  prepare: (fs, iterations) => Effect.gen(function* () {
    yield* resetFixture(fs);
    const path = `${DIR}/f`;
    const write = writer(fs, encoding, size.bytes, false);
    yield* write(path);
    return {
      run: sameOp(iterations, write(path)),
      verify: (checksum) => Effect.gen(function* () {
        yield* expectChecksum(checksum, iterations);
        yield* expectFileSize(fs, path, size.bytes);
      }),
    };
  }),
})));

const readCases = encodings.flatMap((encoding) => sizes.map((size): CaseDefinition => ({
  id: `read.${encoding}.${size.label}`,
  operation: encoding === "binary" ? "readFile" : "readFileString",
  params: { encoding, bytes: size.bytes },
  bytesPerOp: size.bytes,
  defaultIterations: size.iterations,
  maxIterations: iterationCap(size.bytes, 0),
  prepare: (fs, iterations) => Effect.gen(function* () {
    yield* resetFixture(fs);
    const path = `${DIR}/f`;
    if (encoding === "binary") {
      const data = binaryPayload(size.bytes);
      yield* fs.writeFile(path, data);
      const expected = bytesChecksum(data) * iterations;
      return {
        run: sameOp(iterations, fs.readFile(path).pipe(Effect.map(bytesChecksum))),
        verify: (checksum) => expectChecksum(checksum, expected),
      };
    }
    const text = utf8Payload(size.bytes);
    yield* fs.writeFileString(path, text);
    const expected = textChecksum(text) * iterations;
    return {
      run: sameOp(iterations, fs.readFileString(path).pipe(Effect.map(textChecksum))),
      verify: (checksum) => expectChecksum(checksum, expected),
    };
  }),
})));

const appendCases = [
  { label: "1KiB", bytes: KiB, iterations: 500 },
  { label: "64KiB", bytes: 64 * KiB, iterations: 20 },
].map((chunk): CaseDefinition => ({
  id: `append.binary.${chunk.label}`,
  operation: "appendFile",
  params: { chunkBytes: chunk.bytes, initialBytes: 0, finalBytes: "iterations*chunkBytes" },
  bytesPerOp: chunk.bytes,
  defaultIterations: chunk.iterations,
  maxIterations: Math.floor(MAX_FILE_BYTES / chunk.bytes),
  prepare: (fs, iterations) => Effect.gen(function* () {
    yield* resetFixture(fs);
    const path = `${DIR}/log`;
    const data = binaryPayload(chunk.bytes);
    yield* fs.writeFile(path, new Uint8Array(0));
    return {
      run: sameOp(iterations, fs.appendFile(path, data).pipe(Effect.as(1))),
      verify: (checksum) => Effect.gen(function* () {
        yield* expectChecksum(checksum, iterations);
        yield* expectFileSize(fs, path, iterations * chunk.bytes);
      }),
    };
  }),
}));

const statDepthCases = [3, 16, 64].map((components): CaseDefinition => ({
  id: `stat.depth.${components}`,
  operation: "stat",
  params: { pathComponents: components, result: "hit" },
  bytesPerOp: 0,
  defaultIterations: 1000,
  maxIterations: MAX_BATCH_OPS,
  prepare: (fs, iterations) => Effect.gen(function* () {
    yield* resetFixture(fs);
    const parent = DIR + "/d".repeat(components - 3);
    yield* fs.makeDirectory(parent, { recursive: true });
    const path = `${parent}/f`;
    yield* fs.writeFileString(path, "x");
    return {
      run: sameOp(iterations, fs.stat(path).pipe(Effect.map((stat) => stat.size))),
      verify: (checksum) => expectChecksum(checksum, iterations),
    };
  }),
}));

const missPath = `${DIR}/d/missing`;

const missCases: ReadonlyArray<CaseDefinition> = [
  {
    id: "stat.miss",
    operation: "stat",
    params: { pathComponents: 4, result: "ENOENT" },
    bytesPerOp: 0,
    defaultIterations: 1000,
    maxIterations: MAX_BATCH_OPS,
    prepare: (fs, iterations) => Effect.gen(function* () {
      yield* resetFixture(fs);
      yield* fs.makeDirectory(`${DIR}/d`);
      const miss = fs.stat(missPath).pipe(
        Effect.as(0),
        Effect.catchTag("FsError", (error) => error.code === "ENOENT" ? Effect.succeed(1) : Effect.fail(error)),
      );
      return { run: sameOp(iterations, miss), verify: (checksum) => expectChecksum(checksum, iterations) };
    }),
  },
  {
    id: "exists.miss",
    operation: "exists",
    params: { pathComponents: 4, result: "false" },
    bytesPerOp: 0,
    defaultIterations: 1000,
    maxIterations: MAX_BATCH_OPS,
    prepare: (fs, iterations) => Effect.gen(function* () {
      yield* resetFixture(fs);
      yield* fs.makeDirectory(`${DIR}/d`);
      const miss = fs.exists(missPath).pipe(Effect.map((exists) => exists ? 0 : 1));
      return { run: sameOp(iterations, miss), verify: (checksum) => expectChecksum(checksum, iterations) };
    }),
  },
];

const readDirectoryCases = [
  { entries: 10, iterations: 500 },
  { entries: 1000, iterations: 20 },
  { entries: 5000, iterations: 5 },
].map((size): CaseDefinition => ({
  id: `readDirectory.${size.entries}`,
  operation: "readDirectory",
  params: { entries: size.entries, entryType: "empty file" },
  bytesPerOp: 0,
  defaultIterations: size.iterations,
  maxIterations: Math.max(1, Math.floor(200_000 / size.entries)),
  prepare: (fs, iterations) => Effect.gen(function* () {
    yield* resetFixture(fs);
    const empty = new Uint8Array(0);
    for (const path of indexedPaths(`${DIR}/f`, size.entries)) yield* fs.writeFile(path, empty);
    return {
      run: sameOp(iterations, fs.readDirectory(DIR).pipe(Effect.map((entries) => entries.length))),
      verify: (checksum) => expectChecksum(checksum, iterations * size.entries),
    };
  }),
}));

const treeParams = { treeFiles: TREE_FILES, treeDirectories: TREE_DIRS, fileBytes: TREE_FILE_BYTES };

const treeCases: ReadonlyArray<CaseDefinition> = [
  {
    id: "rename.file",
    operation: "rename",
    params: { fileBytes: KiB },
    bytesPerOp: 0,
    defaultIterations: 500,
    maxIterations: iterationCap(KiB, 1),
    prepare: (fs, iterations) => Effect.gen(function* () {
      yield* resetFixture(fs);
      const data = binaryPayload(KiB);
      const sources = indexedPaths(`${DIR}/a`, iterations);
      const targets = indexedPaths(`${DIR}/b`, iterations);
      for (const path of sources) yield* fs.writeFile(path, data);
      return {
        run: Effect.gen(function* () {
          for (let index = 0; index < iterations; index++) {
            yield* fs.rename(sources[index] ?? "", targets[index] ?? "");
          }
          return iterations;
        }),
        verify: (checksum) => Effect.gen(function* () {
          yield* expectChecksum(checksum, iterations);
          yield* expectFileSize(fs, lastOf(targets), KiB);
          yield* check(!(yield* fs.exists(lastOf(sources))), "rename source still exists");
        }),
      };
    }),
  },
  {
    id: "rename.tree",
    operation: "rename",
    params: { ...treeParams, pattern: "alternate t->u, u->t" },
    bytesPerOp: 0,
    defaultIterations: 200,
    maxIterations: MAX_BATCH_OPS,
    prepare: (fs, iterations) => Effect.gen(function* () {
      yield* resetFixture(fs);
      const first = `${DIR}/t`;
      const second = `${DIR}/u`;
      yield* makeTree(fs, first, binaryPayload(TREE_FILE_BYTES));
      return {
        run: Effect.gen(function* () {
          for (let index = 0; index < iterations; index++) {
            yield* index % 2 === 0 ? fs.rename(first, second) : fs.rename(second, first);
          }
          return iterations;
        }),
        verify: (checksum) => Effect.gen(function* () {
          yield* expectChecksum(checksum, iterations);
          yield* expectFileSize(fs, treeLeaf(iterations % 2 === 0 ? first : second), TREE_FILE_BYTES);
        }),
      };
    }),
  },
  {
    id: "copy.file.64KiB",
    operation: "copy",
    params: { fileBytes: 64 * KiB },
    bytesPerOp: 64 * KiB,
    defaultIterations: 100,
    maxIterations: iterationCap(64 * KiB, 1),
    prepare: (fs, iterations) => Effect.gen(function* () {
      yield* resetFixture(fs);
      const source = `${DIR}/src`;
      yield* fs.writeFile(source, binaryPayload(64 * KiB));
      const targets = indexedPaths(`${DIR}/c`, iterations);
      return {
        run: repeat(targets, (target) => fs.copy(source, target).pipe(Effect.as(1))),
        verify: (checksum) => Effect.gen(function* () {
          yield* expectChecksum(checksum, iterations);
          yield* expectFileSize(fs, lastOf(targets), 64 * KiB);
        }),
      };
    }),
  },
  {
    id: "copy.tree",
    operation: "copy",
    params: { ...treeParams, recursive: "true" },
    bytesPerOp: TREE_FILES * TREE_FILE_BYTES,
    defaultIterations: 10,
    maxIterations: iterationCap(TREE_FILES * TREE_FILE_BYTES, TREE_NODES),
    prepare: (fs, iterations) => Effect.gen(function* () {
      yield* resetFixture(fs);
      const source = `${DIR}/t`;
      yield* makeTree(fs, source, binaryPayload(TREE_FILE_BYTES));
      const targets = indexedPaths(`${DIR}/c`, iterations);
      return {
        run: repeat(targets, (target) => fs.copy(source, target, { recursive: true }).pipe(Effect.as(1))),
        verify: (checksum) => Effect.gen(function* () {
          yield* expectChecksum(checksum, iterations);
          yield* expectFileSize(fs, treeLeaf(lastOf(targets)), TREE_FILE_BYTES);
        }),
      };
    }),
  },
  {
    id: "remove.file",
    operation: "remove",
    params: { fileBytes: KiB },
    bytesPerOp: 0,
    defaultIterations: 500,
    maxIterations: iterationCap(KiB, 1),
    prepare: (fs, iterations) => Effect.gen(function* () {
      yield* resetFixture(fs);
      const data = binaryPayload(KiB);
      const paths = indexedPaths(`${DIR}/f`, iterations);
      for (const path of paths) yield* fs.writeFile(path, data);
      return {
        run: repeat(paths, (path) => fs.remove(path).pipe(Effect.as(1))),
        verify: (checksum) => Effect.gen(function* () {
          yield* expectChecksum(checksum, iterations);
          yield* check(!(yield* fs.exists(lastOf(paths))), "removed file still exists");
        }),
      };
    }),
  },
  {
    id: "remove.tree",
    operation: "remove",
    params: { ...treeParams, recursive: "true" },
    bytesPerOp: 0,
    defaultIterations: 10,
    maxIterations: iterationCap(TREE_FILES * TREE_FILE_BYTES, TREE_NODES),
    prepare: (fs, iterations) => Effect.gen(function* () {
      yield* resetFixture(fs);
      const payload = binaryPayload(TREE_FILE_BYTES);
      const roots = indexedPaths(`${DIR}/t`, iterations);
      for (const root of roots) yield* makeTree(fs, root, payload);
      return {
        run: repeat(roots, (root) => fs.remove(root, { recursive: true }).pipe(Effect.as(1))),
        verify: (checksum) => Effect.gen(function* () {
          yield* expectChecksum(checksum, iterations);
          yield* check(!(yield* fs.exists(lastOf(roots))), "removed tree still exists");
        }),
      };
    }),
  },
];

export const CASES: ReadonlyArray<CaseDefinition> = [
  ...writeCreateCases,
  ...writeOverwriteCases,
  ...readCases,
  ...appendCases,
  ...statDepthCases,
  ...missCases,
  ...readDirectoryCases,
  ...treeCases,
];

export const findCase = (id: string): CaseDefinition | undefined => CASES.find((definition) => definition.id === id);

export interface BatchMeasurement {
  readonly ops: number;
  readonly bytes: number;
  readonly checksum: number;
  readonly elapsedMs: number;
}

export type BatchOutcome =
  | { readonly ok: true; readonly measurement: BatchMeasurement }
  | { readonly ok: false; readonly error: string };

const failure = <A, E>(exit: Exit.Exit<A, E>): string =>
  Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "unexpected success";

export const prepareBatch = (
  fs: VirtualFileSystem,
  definition: CaseDefinition,
  iterations: number,
): { readonly ok: true; readonly batch: PreparedBatch } | { readonly ok: false; readonly error: string } => {
  const exit = Effect.runSyncExit(definition.prepare(fs, iterations));
  return Exit.isSuccess(exit) ? { ok: true, batch: exit.value } : { ok: false, error: failure(exit) };
};

export type ExecuteOutcome =
  | { readonly ok: true; readonly checksum: number; readonly elapsedMs: number }
  | { readonly ok: false; readonly error: string };

export const executeBatch = (batch: PreparedBatch): ExecuteOutcome => {
  const start = performance.now();
  const exit = Effect.runSyncExit(batch.run);
  const elapsedMs = performance.now() - start;
  return Exit.isSuccess(exit) ? { ok: true, checksum: exit.value, elapsedMs } : { ok: false, error: failure(exit) };
};

export const verifyBatch = (
  definition: CaseDefinition,
  batch: PreparedBatch,
  iterations: number,
  executed: { readonly checksum: number; readonly elapsedMs: number },
): BatchOutcome => {
  const verified = Effect.runSyncExit(batch.verify(executed.checksum));
  if (Exit.isFailure(verified)) return { ok: false, error: failure(verified) };
  return {
    ok: true,
    measurement: {
      ops: iterations,
      bytes: iterations * definition.bytesPerOp,
      checksum: executed.checksum,
      elapsedMs: executed.elapsedMs,
    },
  };
};

export const measureBatch = (definition: CaseDefinition, batch: PreparedBatch, iterations: number): BatchOutcome => {
  const executed = executeBatch(batch);
  return executed.ok ? verifyBatch(definition, batch, iterations, executed) : executed;
};

export const cleanupFixtures = (fs: VirtualFileSystem): string | undefined => {
  const exit = Effect.runSyncExit(removeFixtures(fs));
  return Exit.isFailure(exit) ? failure(exit) : undefined;
};
