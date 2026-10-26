import { NodeServices } from "@effect/platform-node";
import { WorkerBundle, type WorkerBuildOptions } from "alchemy/Cloudflare/Workers/Sources/Rolldown";
import { Effect } from "effect";
import { compatibility, workerMain } from "../worker-config.ts";

export const bundleWorker = (directory?: string) =>
  Effect.gen(function* () {
    const bundler = yield* WorkerBundle;
    const output: WorkerBuildOptions["output"] = {};
    if (directory !== undefined) output.dir = directory;
    return yield* bundler.build({
      id: "Benchmarks",
      main: workerMain,
      compatibility,
      entry: { kind: "external" },
      stack: { name: "fs-durable-benchmarks", stage: "build" },
      extraOptions: { output },
    });
  }).pipe(Effect.provide(NodeServices.layer));
