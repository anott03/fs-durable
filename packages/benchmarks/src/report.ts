export type TimingKind =
  | "node-batch"
  | "local-do-operation"
  | "local-harness-roundtrip"
  | "remote-client-roundtrip";

export const TIMING_DESCRIPTIONS = {
  "node-batch": "performance.now() around the measured batch in Node; excludes prepare, verify, and cleanup",
  "local-do-operation": "performance.now() inside the local workerd Durable Object around the measured batch only",
  "local-harness-roundtrip": "Node client roundtrip for the run request to local workerd; includes HTTP, Worker, DO RPC, and output gate",
  "remote-client-roundtrip": "Node client roundtrip for the run request; includes network, Worker, DO RPC, and durability (output gate)",
} as const satisfies Record<TimingKind, string>;

export type SampleTimings = Partial<Record<TimingKind, number>>;

export const TIMER_RESOLUTION_MS = {
  "node-batch": null,
  "local-do-operation": 1,
  "local-harness-roundtrip": null,
  "remote-client-roundtrip": null,
} as const satisfies Record<TimingKind, number | null>;

const LOW_RESOLUTION_FACTOR = 20;

export interface Sample {
  readonly ops: number;
  readonly bytes: number;
  readonly checksum: number;
  readonly timings: Readonly<SampleTimings>;
  readonly reprepared: number;
}

export interface TimingSummary {
  readonly kind: TimingKind;
  readonly description: string;
  readonly batchMedianMs: number;
  readonly batchP95Ms: number;
  readonly batchMinMs: number;
  readonly batchMaxMs: number;
  readonly amortizedMedianUsPerOp: number | null;
  readonly opsPerSecond: number | null;
  readonly mibPerSecond: number | null;
  readonly timerResolutionMs: number | null;
  readonly belowResolution: boolean;
}

const MiB = 1024 * 1024;

type NonEmpty<A> = readonly [A, ...ReadonlyArray<A>];

const nearestRank = (sorted: NonEmpty<number>, percentile: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentile * sorted.length) - 1))] ?? sorted[0];

export const summarize = (kind: TimingKind, samples: ReadonlyArray<Sample>): TimingSummary | undefined => {
  const values: Array<number> = [];
  for (const sample of samples) {
    const value = sample.timings[kind];
    if (value !== undefined) values.push(value);
  }
  const [firstSample] = samples;
  if (firstSample === undefined || values.length !== samples.length) return undefined;
  const [min, ...rest] = values.sort((left, right) => left - right);
  if (min === undefined) return undefined;
  const sorted: NonEmpty<number> = [min, ...rest];
  const max = rest.at(-1) ?? min;
  const { ops, bytes } = firstSample;
  const median = nearestRank(sorted, 0.5);
  const timerResolutionMs = TIMER_RESOLUTION_MS[kind];
  const belowResolution = timerResolutionMs !== null && median < timerResolutionMs * LOW_RESOLUTION_FACTOR;
  const seconds = belowResolution ? 0 : median / 1000;
  return {
    kind,
    description: TIMING_DESCRIPTIONS[kind],
    batchMedianMs: median,
    batchP95Ms: nearestRank(sorted, 0.95),
    batchMinMs: min,
    batchMaxMs: max,
    amortizedMedianUsPerOp: ops > 0 && !belowResolution ? (median * 1000) / ops : null,
    opsPerSecond: seconds > 0 ? ops / seconds : null,
    mibPerSecond: bytes > 0 && seconds > 0 ? bytes / MiB / seconds : null,
    timerResolutionMs,
    belowResolution,
  };
};

const fixed = (value: number | null, digits: number): string => value === null ? "-" : value.toFixed(digits);

export interface TableRow {
  readonly backend: string;
  readonly caseId: string;
  readonly ops: number;
  readonly summary: TimingSummary;
}

export const renderTable = (rows: ReadonlyArray<TableRow>): string => {
  const header = ["backend", "case", "timing", "ops/batch", "batch med ms", "batch p95 ms", "amortized us/op", "ops/s", "MiB/s"];
  const body = rows.map((row) => [
    row.backend,
    row.caseId,
    row.summary.belowResolution ? `${row.summary.kind}*` : row.summary.kind,
    String(row.ops),
    fixed(row.summary.batchMedianMs, 3),
    fixed(row.summary.batchP95Ms, 3),
    fixed(row.summary.amortizedMedianUsPerOp, 2),
    fixed(row.summary.opsPerSecond, 0),
    row.summary.mibPerSecond === null ? "" : fixed(row.summary.mibPerSecond, 1),
  ]);
  const widths = header.map((title, column) => Math.max(title.length, ...body.map((cells) => cells[column]?.length ?? 0)));
  const line = (cells: ReadonlyArray<string>) =>
    cells.map((cell, column) => column < 3 ? cell.padEnd(widths[column] ?? 0) : cell.padStart(widths[column] ?? 0)).join("  ");
  return [line(header), widths.map((width) => "-".repeat(width)).join("  "), ...body.map(line)].join("\n");
};
