import { fileURLToPath } from "node:url";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

export const Docs = Cloudflare.Website.Foldkit("Docs", {
  rootDir: fileURLToPath(new URL(".", import.meta.url)),
  domain: "fs-durable.amitav.dev",
});

export default Alchemy.Stack(
  "fs-durable-docs",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const docs = yield* Docs;
    return { url: docs.url };
  }),
);
