import { fileURLToPath, URL } from "node:url";
import * as Cloudflare from "alchemy/Cloudflare";
import { Config } from "effect";
import type { FsBench, FsBenchDriver } from "./src/worker.ts";

export const workerMain = fileURLToPath(new URL("./src/worker.ts", import.meta.url));
export const compatibility = { date: "2026-10-19", flags: ["nodejs_compat"] };

export const namespaces = {
  FS_BENCH: Cloudflare.DurableObject<FsBench>("FsBench"),
  FS_BENCH_DRIVER: Cloudflare.DurableObject<FsBenchDriver>("FsBenchDriver"),
};

export const workerEnv = {
  ...namespaces,
  INTERNAL_TIMING: "off",
  BENCHMARK_TOKEN: Config.Redacted("BENCHMARK_TOKEN"),
};

export type BenchmarkEnv = Cloudflare.InferEnv<typeof workerEnv>;
