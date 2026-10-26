import { randomBytes } from "node:crypto";
import { Runtime, layerRuntime } from "@alchemy.run/cloudflare-runtime/core";
import { DurableObjectNamespace, Text } from "@alchemy.run/cloudflare-runtime/core/bindings";
import { NodeServices } from "@effect/platform-node";
import { fromEnv } from "@distilled.cloud/cloudflare/Credentials";
import { Effect, Exit, Scope } from "effect";
import { FetchHttpClient } from "effect/http";
import { compatibility, namespaces } from "../worker-config.ts";
import { bundleWorker } from "./bundle.ts";

export const startLocalWorker = async () => {
  const scope = Scope.makeUnsafe("sequential");
  const close = () => Effect.runPromise(Scope.close(scope, Exit.void));
  const token = randomBytes(32).toString("hex");
  try {
    const bundle = await Effect.runPromise(bundleWorker());
    const url = await Effect.runPromise(
      Effect.gen(function* () {
        const runtime = yield* Runtime;
        return yield* runtime.start({
          name: `fs-durable-benchmarks-${randomBytes(8).toString("hex")}`,
          compatibilityDate: compatibility.date,
          compatibilityFlags: compatibility.flags,
          logging: {
            onOutput: (chunk) => { process.stderr.write(chunk); },
          },
          modules: bundle.files.filter((file) => !file.path.endsWith(".map")).map((file) => ({
            name: file.path,
            type: "ESModule" as const,
            content: file.content instanceof Uint8Array ? new TextDecoder().decode(file.content) : file.content,
          })),
          bindings: [
            Text.local("BENCHMARK_TOKEN", token),
            Text.local("INTERNAL_TIMING", "local"),
            ...Object.entries(namespaces).map(([binding, namespace]) =>
              DurableObjectNamespace.local({ binding, className: namespace.name })),
          ],
          durableObjectNamespaces: Object.values(namespaces).map((namespace) => ({
            className: namespace.name,
            sql: true,
          })),
        });
      }).pipe(
        Effect.provide(layerRuntime({ api: { accountId: "local" } })),
        Effect.provide(fromEnv()),
        Effect.provide(FetchHttpClient.layer),
        Effect.provide(NodeServices.layer),
        Scope.provide(scope),
      ),
    );
    return {
      fetch: (path: string) => fetch(new URL(path, url), {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
};
