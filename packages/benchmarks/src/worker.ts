import { DurableObject, tracing } from "cloudflare:workers";
import { Effect, Schema } from "effect";
import type { VirtualFileSystem } from "fs-durable";
import { makeDurableObject } from "fs-durable/durable-object";
import {
  MAX_URL_LENGTH,
  NONCE_PATTERN,
  ROUTES,
  RUN_ID_PATTERN,
  doName,
  parseIterations,
  type CleanupBody,
  type ErrorBody,
  type ErrorCode,
  type PrepareBody,
  type RunBody,
} from "./protocol.ts";
import { FILESYSTEM_OPTIONS, findCase, measureBatch, prepareBatch, type PreparedBatch } from "./workloads.ts";

const PREPARED_KEY = "fs-bench:prepared";

const PreparedRecord = Schema.UndefinedOr(Schema.Struct({
  nonce: Schema.String,
  caseId: Schema.String,
  iterations: Schema.Number,
}));
const decodePreparedRecord = Schema.decodeUnknownSync(PreparedRecord);

interface PreparedState {
  readonly nonce: string;
  readonly caseId: string;
  readonly iterations: number;
  readonly batch: PreparedBatch;
}

const failure = (code: ErrorCode, error: string): ErrorBody => ({ ok: false, code, error });

const randomHex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");

const log = (event: string, fields: Readonly<Record<string, string | number | boolean | null>>): void => {
  console.log(JSON.stringify({ event, ...fields }));
};

export class FsBench extends DurableObject<Env> {
  private fs: VirtualFileSystem | undefined;
  private prepared: PreparedState | undefined;

  private filesystem(): VirtualFileSystem {
    this.fs ??= Effect.runSync(makeDurableObject(this.ctx.storage, FILESYSTEM_OPTIONS));
    return this.fs;
  }

  private doId(): string {
    return this.ctx.id.toString();
  }

  prepare(runId: string, caseId: string, iterations: number): PrepareBody | ErrorBody {
    const definition = findCase(caseId);
    if (definition === undefined) return failure("bad_request", "unknown case");
    if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > definition.maxIterations) {
      return failure("bad_request", `iterations must be between 1 and ${definition.maxIterations}`);
    }
    this.prepared = undefined;
    this.ctx.storage.kv.delete(PREPARED_KEY);
    const result = prepareBatch(this.filesystem(), definition, iterations);
    if (!result.ok) {
      log("fs-bench.prepare", { runId, doId: this.doId(), case: caseId, iterations, ok: false, error: result.error });
      return failure("batch_failed", result.error);
    }
    const nonce = randomHex(16);
    this.ctx.storage.kv.put(PREPARED_KEY, { nonce, caseId, iterations });
    this.prepared = { nonce, caseId, iterations, batch: result.batch };
    return { ok: true, doId: this.doId(), nonce };
  }

  run(runId: string, nonce: string): RunBody | ErrorBody {
    const record = decodePreparedRecord(this.ctx.storage.kv.get(PREPARED_KEY));
    if (record === undefined || record.nonce !== nonce) return failure("stale_nonce", "batch is not prepared for this nonce");
    this.ctx.storage.kv.delete(PREPARED_KEY);
    const prepared = this.prepared;
    this.prepared = undefined;
    if (prepared === undefined || prepared.nonce !== nonce) {
      log("fs-bench.evicted", { runId, doId: this.doId(), case: record.caseId });
      return failure("evicted", "prepared fixture state was lost; prepare again");
    }
    const definition = findCase(prepared.caseId);
    if (definition === undefined) return failure("internal", "prepared case no longer exists");
    const local = this.env.INTERNAL_TIMING === "local";
    const outcome = tracing.enterSpan("fs-bench.batch", (span) => {
      span.setAttributes({
        "bench.run_id": runId,
        "bench.case": prepared.caseId,
        "bench.iterations": prepared.iterations,
      });
      return measureBatch(definition, prepared.batch, prepared.iterations);
    });
    if (!outcome.ok) {
      log("fs-bench.batch", { runId, doId: this.doId(), case: prepared.caseId, iterations: prepared.iterations, ok: false, error: outcome.error });
      return failure("batch_failed", outcome.error);
    }
    const { measurement } = outcome;
    const operationMs = local ? measurement.elapsedMs : null;
    log("fs-bench.batch", {
      runId,
      doId: this.doId(),
      case: prepared.caseId,
      iterations: prepared.iterations,
      ops: measurement.ops,
      bytes: measurement.bytes,
      ok: true,
      operationMs,
    });
    return {
      ok: true,
      doId: this.doId(),
      ops: measurement.ops,
      bytes: measurement.bytes,
      checksum: measurement.checksum,
      timingScope: local ? "local-do-operation" : "none",
      operationMs,
    };
  }

  async cleanup(runId: string): Promise<CleanupBody> {
    this.prepared = undefined;
    this.fs = undefined;
    await this.ctx.storage.deleteAll();
    log("fs-bench.cleanup", { runId, doId: this.doId() });
    return { ok: true, doId: this.doId() };
  }
}

const STATUS = {
  unauthorized: 401,
  not_configured: 503,
  bad_request: 400,
  not_found: 404,
  evicted: 409,
  stale_nonce: 409,
  batch_failed: 500,
  internal: 500,
} as const satisfies Record<ErrorCode, number>;

const respond = (body: PrepareBody | RunBody | CleanupBody | ErrorBody): Response =>
  Response.json(body, { status: body.ok ? 200 : STATUS[body.code], headers: { "cache-control": "no-store" } });

const encoder = new TextEncoder();

const sameSecret = async (provided: string, expected: string): Promise<boolean> => {
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(left, right);
};

const ALLOWED_PARAMS = new Map<string, ReadonlyArray<string>>([
  [ROUTES.prepare, ["run", "case", "iterations"]],
  [ROUTES.run, ["run", "nonce"]],
  [ROUTES.cleanup, ["run"]],
]);

const handle = async (request: Request, env: Env): Promise<Response> => {
  if (request.url.length > MAX_URL_LENGTH) return respond(failure("bad_request", "URL too long"));
  const token = env.BENCHMARK_TOKEN;
  if (!token) return respond(failure("not_configured", "BENCHMARK_TOKEN is not configured"));
  if (!(await sameSecret(request.headers.get("authorization") ?? "", `Bearer ${token}`))) {
    return respond(failure("unauthorized", "unauthorized"));
  }
  const url = new URL(request.url);
  const allowed = ALLOWED_PARAMS.get(url.pathname);
  if (allowed === undefined) return respond(failure("not_found", "not found"));
  if (request.method !== "POST") return respond(failure("bad_request", "use POST"));
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key)) return respond(failure("bad_request", `unexpected parameter ${key}`));
  }
  const runId = url.searchParams.get("run") ?? "";
  if (!RUN_ID_PATTERN.test(runId)) return respond(failure("bad_request", "invalid run id"));

  if (url.pathname === ROUTES.prepare) {
    const definition = findCase(url.searchParams.get("case") ?? "");
    if (definition === undefined) return respond(failure("bad_request", "unknown case"));
    const iterations = parseIterations(url.searchParams.get("iterations"));
    if (iterations === undefined || iterations > definition.maxIterations) {
      return respond(failure("bad_request", `iterations must be between 1 and ${definition.maxIterations}`));
    }
    const stub = env.FS_BENCH.getByName(doName(runId));
    return respond(await stub.prepare(runId, definition.id, iterations));
  }
  if (url.pathname === ROUTES.run) {
    const nonce = url.searchParams.get("nonce") ?? "";
    if (!NONCE_PATTERN.test(nonce)) return respond(failure("bad_request", "invalid nonce"));
    const stub = env.FS_BENCH.getByName(doName(runId));
    return respond(await stub.run(runId, nonce));
  }
  const stub = env.FS_BENCH.getByName(doName(runId));
  return respond(await stub.cleanup(runId));
};

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (error) {
      console.error(JSON.stringify({ event: "fs-bench.error", message: error instanceof Error ? error.message : String(error) }));
      return respond(failure("internal", "internal error"));
    }
  },
} satisfies ExportedHandler<Env>;
