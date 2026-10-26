import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { arch, cpus, platform, release } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Effect, Schema } from "effect";
import { makeMemory } from "fs-durable/memory";
import {
  CleanupResponse,
  PrepareResponse,
  ROUTES,
  RUN_ID_PATTERN,
  RunResponse,
  SampleResponse,
  doName,
  driverName,
  type ErrorBody,
  type RunBody,
} from "./protocol.ts";
import { renderTable, summarize, type Sample, type SampleTimings, type TableRow, type TimingKind, type TimingSummary } from "./report.ts";
import { CASES, FILESYSTEM_OPTIONS, cleanupFixtures, measureBatch, prepareBatch, type CaseDefinition } from "./workloads.ts";

const BACKENDS = ["memory", "sqlite", "remote"] as const;
type Backend = (typeof BACKENDS)[number];
const MAX_SAMPLES = 1000;
const MAX_WARMUP = 100;
const MAX_REPREPARES = 3;
const REMOTE_TIMEOUT_MS = 60_000;
const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

class CliError extends Error {}

interface Options {
  readonly backends: ReadonlyArray<Backend>;
  readonly samples: number;
  readonly warmup: number;
  readonly iterations: number | undefined;
  readonly caseFilters: ReadonlyArray<string>;
  readonly json: string | undefined;
  readonly url: string | undefined;
  readonly runId: string;
}

const usage = `Usage: node src/cli.ts [options]
  --backend <list>     memory,sqlite,remote (default memory,sqlite)
  --case <list>        case id prefixes, comma separated (default all)
  --samples <n>        measured samples per case (default 10)
  --warmup <n>         unmeasured warmup batches per case (default 2)
  --iterations <n>     operations per batch, overriding each case default
  --json <path|->      write structured results, relative to INIT_CWD or the current directory;
                       "-" writes JSON to stdout and the table to stderr
  --url <url>          remote Worker base URL, https:// or http://localhost (remote only; token from BENCHMARK_TOKEN)
  --run-id <id>        Durable Object run name, ${RUN_ID_PATTERN.source} (default random)
  --list               list cases and exit`;

const integer = (raw: string | undefined, name: string, fallback: number, min: number, max: number): number => {
  if (raw === undefined) return fallback;
  if (!/^[0-9]+$/.test(raw)) throw new CliError(`--${name} must be an integer`);
  const value = Number(raw);
  if (value < min || value > max) throw new CliError(`--${name} must be between ${min} and ${max}`);
  return value;
};

const parseRunId = (raw: string | undefined): string => {
  if (raw === undefined) return `cli-${randomBytes(8).toString("hex")}`;
  if (!RUN_ID_PATTERN.test(raw)) throw new CliError(`--run-id must match ${RUN_ID_PATTERN.source}`);
  return raw;
};

const isBackend = (value: string): value is Backend => BACKENDS.some((backend) => backend === value);

const parseCommandLine = () => {
  try {
    return parseArgs({
      args: process.argv.slice(2).filter((arg) => arg !== "--"),
      options: {
        backend: { type: "string" },
        case: { type: "string" },
        samples: { type: "string" },
        warmup: { type: "string" },
        iterations: { type: "string" },
        json: { type: "string" },
        url: { type: "string" },
        "run-id": { type: "string" },
        list: { type: "boolean" },
        help: { type: "boolean" },
      },
      strict: true,
    });
  } catch (cause) {
    throw new CliError(cause instanceof Error ? cause.message : String(cause));
  }
};

const parseOptions = (): Options | "list" => {
  const { values } = parseCommandLine();
  if (values.help === true) {
    console.log(usage);
    process.exit(0);
  }
  if (values.list === true) return "list";
  const backends: Array<Backend> = [];
  for (const name of (values.backend ?? "memory,sqlite").split(",")) {
    if (!isBackend(name)) throw new CliError(`unknown backend ${name}`);
    if (!backends.includes(name)) backends.push(name);
  }
  if (backends.includes("remote") && values.url === undefined) throw new CliError("--backend remote requires --url");
  if (values.url !== undefined && !backends.includes("remote")) throw new CliError("--url is only valid with --backend remote");
  return {
    backends,
    samples: integer(values.samples, "samples", 10, 1, MAX_SAMPLES),
    warmup: integer(values.warmup, "warmup", 2, 0, MAX_WARMUP),
    iterations: values.iterations === undefined ? undefined : integer(values.iterations, "iterations", 1, 1, 1_000_000),
    caseFilters: values.case === undefined ? [] : values.case.split(",").filter((filter) => filter.length > 0),
    json: values.json,
    url: values.url,
    runId: parseRunId(values["run-id"]),
  };
};

const selectCases = (options: Options): ReadonlyArray<CaseDefinition> => {
  const selected = options.caseFilters.length === 0
    ? CASES
    : CASES.filter((definition) => options.caseFilters.some((filter) => definition.id.startsWith(filter)));
  if (selected.length === 0) throw new CliError(`no cases match ${options.caseFilters.join(",")}`);
  for (const definition of selected) {
    const iterations = options.iterations ?? definition.defaultIterations;
    if (iterations > definition.maxIterations) {
      throw new CliError(`${definition.id}: --iterations ${iterations} exceeds the case limit ${definition.maxIterations}`);
    }
  }
  return selected;
};

interface CaseResult {
  readonly backend: Backend;
  readonly case: string;
  readonly operation: string;
  readonly params: CaseDefinition["params"];
  readonly iterations: number;
  readonly opsPerBatch: number;
  readonly bytesPerBatch: number;
  readonly warmup: number;
  readonly ok: boolean;
  readonly error: string | null;
  readonly summaries: ReadonlyArray<TimingSummary>;
  readonly samples: ReadonlyArray<Sample>;
}

interface SampleRunner {
  readonly name: Backend;
  readonly timingKinds: ReadonlyArray<TimingKind>;
  readonly metadata: Readonly<Record<string, string | null>>;
  readonly sample: (definition: CaseDefinition, iterations: number) => Promise<Sample>;
  readonly endCase: () => Promise<void>;
  readonly close: () => Promise<void>;
}

const expectTotals = (definition: CaseDefinition, iterations: number, ops: number, bytes: number): void => {
  if (ops !== iterations || bytes !== iterations * definition.bytesPerOp) {
    throw new Error(`${definition.id}: reported ${ops} ops / ${bytes} bytes, expected ${iterations} / ${iterations * definition.bytesPerOp}`);
  }
};

const memoryRunner = async (): Promise<SampleRunner> => {
  let fs = await Effect.runPromise(makeMemory(FILESYSTEM_OPTIONS));
  return {
    name: "memory",
    timingKinds: ["node-batch"],
    metadata: {},
    sample: async (definition, iterations) => {
      const prepared = prepareBatch(fs, definition, iterations);
      if (!prepared.ok) throw new Error(`prepare failed: ${prepared.error}`);
      const outcome = measureBatch(definition, prepared.batch, iterations);
      if (!outcome.ok) throw new Error(outcome.error);
      const { measurement } = outcome;
      expectTotals(definition, iterations, measurement.ops, measurement.bytes);
      return {
        ops: measurement.ops,
        bytes: measurement.bytes,
        checksum: measurement.checksum,
        timings: { "node-batch": measurement.elapsedMs },
        reprepared: 0,
      };
    },
    endCase: async () => {
      const error = cleanupFixtures(fs);
      fs = await Effect.runPromise(makeMemory(FILESYSTEM_OPTIONS));
      if (error !== undefined) throw new Error(`cleanup failed: ${error}`);
    },
    close: async () => {
      const error = cleanupFixtures(fs);
      if (error !== undefined) throw new Error(`cleanup failed: ${error}`);
    },
  };
};

type Post = (path: string) => Promise<Response>;

const decodePrepare = Schema.decodeUnknownSync(PrepareResponse);
const decodeRun = Schema.decodeUnknownSync(RunResponse);
const decodeSample = Schema.decodeUnknownSync(SampleResponse);
const decodeCleanup = Schema.decodeUnknownSync(CleanupResponse);

const describeError = (body: ErrorBody, status: number): string => `${body.code} (HTTP ${status}): ${body.error}`;

const cleanupRun = async (post: Post, runId: string): Promise<void> => {
  const response = await post(`${ROUTES.cleanup}?${new URLSearchParams({ run: runId })}`);
  const body = decodeCleanup(await response.json());
  if (!body.ok) throw new Error(`cleanup ${describeError(body, response.status)}`);
};

const trackDoId = () => {
  let doId: string | null = null;
  return {
    get current() {
      return doId;
    },
    observe: (next: string): void => {
      if (doId !== null && next !== doId) throw new Error(`Durable Object id changed from ${doId} to ${next}`);
      doId = next;
    },
  };
};

const sqliteHttpRunner = (
  post: Post,
  runId: string,
  metadata: Readonly<Record<string, string | null>>,
  shutdown: () => Promise<void>,
): SampleRunner => {
  const roundtrip: TimingKind = "local-harness-roundtrip";
  const doId = trackDoId();

  const prepare = async (definition: CaseDefinition, iterations: number): Promise<string> => {
    const query = new URLSearchParams({ run: runId, case: definition.id, iterations: String(iterations) });
    const response = await post(`${ROUTES.prepare}?${query}`);
    const body = decodePrepare(await response.json());
    if (!body.ok) throw new Error(`prepare ${describeError(body, response.status)}`);
    doId.observe(body.doId);
    return body.nonce;
  };

  const run = async (nonce: string): Promise<{ readonly body: RunBody | ErrorBody; readonly status: number; readonly ms: number }> => {
    const query = new URLSearchParams({ run: runId, nonce });
    const start = performance.now();
    const response = await post(`${ROUTES.run}?${query}`);
    const json: unknown = await response.json();
    const ms = performance.now() - start;
    return { body: decodeRun(json), status: response.status, ms };
  };

  return {
    name: "sqlite",
    timingKinds: ["local-do-operation", roundtrip],
    get metadata() {
      return { ...metadata, runId, durableObjectName: doName(runId), durableObjectId: doId.current };
    },
    sample: async (definition, iterations) => {
      for (let attempt = 0; attempt <= MAX_REPREPARES; attempt++) {
        const nonce = await prepare(definition, iterations);
        const result = await run(nonce);
        const { body } = result;
        if (!body.ok) {
          if (body.code === "evicted" && attempt < MAX_REPREPARES) continue;
          throw new Error(`run ${describeError(body, result.status)}`);
        }
        expectTotals(definition, iterations, body.ops, body.bytes);
        if (body.timingScope !== "local-do-operation" || body.operationMs === null) {
          throw new Error("local Worker did not report operation timing; INTERNAL_TIMING must be local");
        }
        const timings: SampleTimings = { [roundtrip]: result.ms, "local-do-operation": body.operationMs };
        return { ops: body.ops, bytes: body.bytes, checksum: body.checksum, timings, reprepared: attempt };
      }
      throw new Error("prepared fixture was evicted repeatedly");
    },
    endCase: async () => {},
    close: async () => {
      try {
        await cleanupRun(post, runId);
      } finally {
        await shutdown();
      }
    },
  };
};

const remoteHttpRunner = (post: Post, runId: string, metadata: Readonly<Record<string, string | null>>): SampleRunner => {
  const doId = trackDoId();
  return {
    name: "remote",
    timingKinds: ["remote-do-rpc", "remote-do-rpc-floor"],
    get metadata() {
      return {
        ...metadata,
        runId,
        durableObjectName: doName(runId),
        durableObjectId: doId.current,
        driverName: driverName(runId),
      };
    },
    sample: async (definition, iterations) => {
      const query = new URLSearchParams({ run: runId, case: definition.id, iterations: String(iterations) });
      const response = await post(`${ROUTES.sample}?${query}`);
      const body = decodeSample(await response.json());
      if (!body.ok) throw new Error(`sample ${describeError(body, response.status)}`);
      doId.observe(body.doId);
      expectTotals(definition, iterations, body.ops, body.bytes);
      return {
        ops: body.ops,
        bytes: body.bytes,
        checksum: body.checksum,
        timings: { "remote-do-rpc": body.executeMs, "remote-do-rpc-floor": body.rpcFloorMs },
        reprepared: body.reprepared,
      };
    },
    endCase: async () => {},
    close: () => cleanupRun(post, runId),
  };
};

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

const PackageVersion = Schema.Struct({ version: Schema.String });
const packageVersion = (name: string): string =>
  Schema.decodeUnknownSync(PackageVersion)(JSON.parse(readFileSync(require.resolve(`${name}/package.json`), "utf8"))).version;

const sqliteRunner = async (runId: string): Promise<SampleRunner> => {
  const { createTestHarness } = await import("wrangler");
  const token = randomBytes(32).toString("hex");
  const server = createTestHarness({
    root: packageDir,
    workers: [{ configPath: "wrangler.jsonc", vars: { INTERNAL_TIMING: "local" }, secrets: { BENCHMARK_TOKEN: token } }],
  });
  try {
    await server.listen();
  } catch (error) {
    await server.close();
    throw error;
  }
  const post: Post = (path) => server.fetch(path, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  return sqliteHttpRunner(post, runId, { wrangler: packageVersion("wrangler"), state: "ephemeral createTestHarness storage" }, () => server.close());
};

const remoteRunner = (runId: string, rawUrl: string): SampleRunner => {
  const token = process.env["BENCHMARK_TOKEN"];
  if (token === undefined || token.length === 0) throw new CliError("remote backend requires the BENCHMARK_TOKEN environment variable");
  let base: URL;
  try {
    base = new URL(rawUrl);
  } catch {
    throw new CliError(`invalid --url ${rawUrl}`);
  }
  const local = base.protocol === "http:" && LOCAL_HOSTS.includes(base.hostname);
  if (base.protocol !== "https:" && !local) {
    throw new CliError("--url must use https://, or http:// for localhost or 127.0.0.1");
  }
  if (base.username !== "" || base.password !== "") throw new CliError("--url must not contain credentials");
  const post: Post = (path) =>
    fetch(new URL(path, base), {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
    });
  return remoteHttpRunner(post, runId, { origin: base.origin });
};

const runCase = async (runner: SampleRunner, definition: CaseDefinition, options: Options): Promise<CaseResult> => {
  const iterations = options.iterations ?? definition.defaultIterations;
  const samples: Array<Sample> = [];
  let error: string | null = null;
  try {
    for (let index = 0; index < options.warmup; index++) await runner.sample(definition, iterations);
    for (let index = 0; index < options.samples; index++) samples.push(await runner.sample(definition, iterations));
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  try {
    await runner.endCase();
  } catch (cause) {
    error ??= cause instanceof Error ? cause.message : String(cause);
  }
  const summaries: Array<TimingSummary> = [];
  if (error === null) {
    for (const kind of runner.timingKinds) {
      const summary = summarize(kind, samples);
      if (summary !== undefined) summaries.push(summary);
    }
  }
  return {
    backend: runner.name,
    case: definition.id,
    operation: definition.operation,
    params: definition.params,
    iterations,
    opsPerBatch: iterations,
    bytesPerBatch: iterations * definition.bytesPerOp,
    warmup: options.warmup,
    ok: error === null,
    error,
    summaries,
    samples,
  };
};

interface GitRevision {
  readonly revision: string | null;
  readonly dirty: boolean | null;
}

const gitRevision = (): GitRevision => {
  try {
    const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: packageDir, encoding: "utf8" }).trim();
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: packageDir, encoding: "utf8" });
    return { revision, dirty: status.trim().length > 0 };
  } catch {
    return { revision: null, dirty: null };
  }
};

const startRunner = (backend: Backend, runId: string, options: Options): Promise<SampleRunner> => {
  if (backend === "memory") return memoryRunner();
  if (backend === "sqlite") return sqliteRunner(runId);
  return Promise.resolve(remoteRunner(runId, options.url ?? ""));
};

const main = async (): Promise<number> => {
  const parsed = parseOptions();
  if (parsed === "list") {
    for (const definition of CASES) {
      console.log(`${definition.id.padEnd(30)} default ${String(definition.defaultIterations).padStart(5)}  max ${String(definition.maxIterations).padStart(5)}  ${JSON.stringify(definition.params)}`);
    }
    return 0;
  }
  const options = parsed;
  const cases = selectCases(options);
  const { runId } = options;
  const output = options.json === "-" ? console.error : console.log;
  const results: Array<CaseResult> = [];
  const backends: Array<{ readonly name: Backend; readonly metadata: Readonly<Record<string, string | null>> }> = [];
  const failures: Array<string> = [];

  for (const backend of options.backends) {
    let runner: SampleRunner;
    try {
      runner = await startRunner(backend, runId, options);
    } catch (cause) {
      if (cause instanceof CliError) throw cause;
      failures.push(`${backend}: failed to start: ${cause instanceof Error ? cause.message : String(cause)}`);
      continue;
    }
    output(`# ${backend}: ${cases.length} cases, ${options.warmup} warmup + ${options.samples} samples`);
    try {
      for (const definition of cases) {
        const result = await runCase(runner, definition, options);
        results.push(result);
        if (!result.ok) {
          failures.push(`${backend} ${definition.id}: ${result.error}`);
          output(`  FAIL ${definition.id}: ${result.error}`);
        }
      }
    } finally {
      try {
        await runner.close();
      } catch (cause) {
        failures.push(`${backend}: cleanup failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
      backends.push({ name: backend, metadata: runner.metadata });
    }
  }

  const rows: Array<TableRow> = [];
  for (const result of results) {
    for (const summary of result.summaries) rows.push({ backend: result.backend, caseId: result.case, ops: result.opsPerBatch, summary });
  }
  if (rows.length > 0) output(`\n${renderTable(rows)}`);
  output("\nTimes are per batch; us/op and ops/s are amortized over the batch, not per-operation latency.");
  if (rows.some((row) => row.summary.belowResolution)) {
    output("* median is under 20x the timer resolution (workerd local clock: 1 ms); rates omitted. Raise --iterations.");
  }
  if (options.backends.includes("remote")) {
    output("Remote times come from a driver Durable Object in the same colo as the benchmark DO; the client network is not timed.");
    output("remote-do-rpc includes one DO-to-DO RPC hop and the output gate; remote-do-rpc-floor is a no-op RPC on the same hop.");
  }

  const cpu = cpus()[0];
  const report = {
    schemaVersion: 1,
    ok: failures.length === 0,
    failures,
    runId,
    environment: {
      node: process.version,
      platform: platform(),
      osRelease: release(),
      arch: arch(),
      cpu: cpu === undefined ? null : `${cpu.model} x${cpus().length}`,
      git: gitRevision(),
      effect: packageVersion("effect"),
    },
    options: {
      backends: options.backends,
      samples: options.samples,
      warmup: options.warmup,
      iterations: options.iterations ?? null,
      caseFilters: options.caseFilters,
      maxFileBytes: FILESYSTEM_OPTIONS.maxFileBytes,
    },
    backends,
    results,
  };
  if (options.json === "-") console.log(JSON.stringify(report, null, 2));
  else if (options.json !== undefined) writeFileSync(resolve(process.env["INIT_CWD"] ?? process.cwd(), options.json), `${JSON.stringify(report, null, 2)}\n`);

  for (const failure of failures) console.error(`error: ${failure}`);
  return failures.length === 0 ? 0 : 1;
};

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof CliError ? `error: ${error.message}\n\n${usage}` : error);
  process.exitCode = 1;
}
