import { Schema } from "effect";

export const ROUTES = { prepare: "/v1/prepare", run: "/v1/run", sample: "/v1/sample", cleanup: "/v1/cleanup" } as const;

export const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,63}$/;
export const NONCE_PATTERN = /^[0-9a-f]{32}$/;
const ITERATIONS_PATTERN = /^[1-9][0-9]{0,5}$/;
export const MAX_URL_LENGTH = 512;

export const doName = (runId: string): string => `fs-bench:${runId}`;
export const driverName = (runId: string): string => `fs-bench-driver:${runId}`;

export const parseIterations = (raw: string | null): number | undefined =>
  raw !== null && ITERATIONS_PATTERN.test(raw) ? Number(raw) : undefined;

export const TimingScope = Schema.Literals(["local-do-operation", "none"]);
export type TimingScope = typeof TimingScope.Type;

export const ErrorCode = Schema.Literals([
  "unauthorized", "not_configured", "bad_request", "not_found",
  "evicted", "stale_nonce", "batch_failed", "internal",
]);
export type ErrorCode = typeof ErrorCode.Type;

export const ErrorBody = Schema.Struct({ ok: Schema.Literal(false), code: ErrorCode, error: Schema.String });
export type ErrorBody = typeof ErrorBody.Type;

export const PrepareBody = Schema.Struct({
  ok: Schema.Literal(true),
  doId: Schema.String,
  nonce: Schema.String,
});
export type PrepareBody = typeof PrepareBody.Type;

export const RunBody = Schema.Struct({
  ok: Schema.Literal(true),
  doId: Schema.String,
  ops: Schema.Number,
  bytes: Schema.Number,
  checksum: Schema.Number,
  timingScope: TimingScope,
  operationMs: Schema.NullOr(Schema.Number),
});
export type RunBody = typeof RunBody.Type;

export const ExecuteBody = Schema.Struct({ ok: Schema.Literal(true) });
export type ExecuteBody = typeof ExecuteBody.Type;

export const SampleBody = Schema.Struct({
  ok: Schema.Literal(true),
  doId: Schema.String,
  ops: Schema.Number,
  bytes: Schema.Number,
  checksum: Schema.Number,
  executeMs: Schema.Number,
  rpcFloorMs: Schema.Number,
  reprepared: Schema.Number,
});
export type SampleBody = typeof SampleBody.Type;

export const CleanupBody = Schema.Struct({ ok: Schema.Literal(true), doId: Schema.String });
export type CleanupBody = typeof CleanupBody.Type;

export const PrepareResponse = Schema.Union([PrepareBody, ErrorBody]);
export const RunResponse = Schema.Union([RunBody, ErrorBody]);
export const SampleResponse = Schema.Union([SampleBody, ErrorBody]);
export const CleanupResponse = Schema.Union([CleanupBody, ErrorBody]);
