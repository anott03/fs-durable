import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";
import { compatibility, workerEnv, workerMain } from "./worker-config.ts";

export default Alchemy.Stack(
  "fs-durable-benchmarks",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const worker = yield* Cloudflare.Worker("Benchmarks", {
      main: workerMain,
      compatibility,
      env: workerEnv,
      workersDev: true,
      dev: { port: 8787 },
      observability: {
        enabled: true,
        headSamplingRate: 1,
        logs: { enabled: true, invocationLogs: true },
        traces: { enabled: true, headSamplingRate: 1 },
      },
    });
    return { url: worker.url, workerName: worker.workerName };
  }),
);
