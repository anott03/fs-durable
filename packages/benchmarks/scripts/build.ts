import { fileURLToPath, URL } from "node:url";
import { Effect } from "effect";
import { bundleWorker } from "../src/bundle.ts";

await Effect.runPromise(bundleWorker(fileURLToPath(new URL("../dist", import.meta.url))));
