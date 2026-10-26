import { fileURLToPath } from "node:url";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as GitHub from "alchemy/GitHub";
import * as Output from "alchemy/Output";
import { Config, Effect, Layer } from "effect";
import type { DemoFilesystem } from "./src/demo/worker.js";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export const Demo = Cloudflare.Worker("FilesystemDemo", {
  main: fileURLToPath(new URL("./src/demo/worker.ts", import.meta.url)),
  workersDev: { enabled: false, previewsEnabled: false },
  compatibility: { date: "2026-10-26", flags: ["nodejs_compat"] },
  observability: { enabled: true },
  env: { FILESYSTEM: Cloudflare.DurableObject<DemoFilesystem>("DemoFilesystem") },
});
export type DemoEnv = Cloudflare.InferEnv<typeof Demo>;

export const Docs = Cloudflare.Website.Foldkit("Docs", Effect.gen(function* () {
  const stage = yield* Alchemy.Stage;
  const demo = yield* Demo;
  return {
    rootDir,
    main: "src/worker.ts",
    domain: stage === "prod" ? "fs-durable.amitav.dev" : null,
    env: { DEMO: demo },
    assets: { runWorkerFirst: ["/api/*"] },
    observability: { enabled: true },
  };
}));
export type DocsEnv = Cloudflare.InferEnv<typeof Docs>;

export default Alchemy.Stack(
  "fs-durable-docs",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const docs = yield* Docs;

    const github = yield* GitHub.GitHubEnv.pipe(Effect.orElseSucceed(() => undefined));
    if (github?.pr) {
      const sha = yield* Config.String("PREVIEW_SHA").pipe(Config.withDefault(github.sha));
      yield* GitHub.Comment("preview-comment", {
        owner: github.owner,
        repository: github.repository,
        issueNumber: github.pr,
        body: Output.interpolate`
          ## Docs preview

          **URL:** ${docs.url}

          Built from commit ${sha.slice(0, 7)}. This comment updates on every push.
        `,
      });
    }

    return { url: docs.url };
  }),
);
