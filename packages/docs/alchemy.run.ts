import { fileURLToPath } from "node:url";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as GitHub from "alchemy/GitHub";
import * as Output from "alchemy/Output";
import { Config, Effect, Layer } from "effect";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default Alchemy.Stack(
  "fs-durable-docs",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage;
    const docs = stage === "prod"
      ? yield* Cloudflare.Website.Foldkit("Docs", { rootDir, domain: "fs-durable.amitav.dev" })
      : yield* Cloudflare.Website.Foldkit("Docs", { rootDir });

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
