import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as GitHub from "alchemy/GitHub";
import { Effect, Layer, Redacted } from "effect";

const owner = "anott03";
const repository = "fs-durable";

export default Alchemy.Stack(
  "fs-durable-github",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
    const account = `com.cloudflare.api.account.${accountId}`;

    const token = yield* Cloudflare.ApiToken.AccountApiToken("DocsDeployToken", {
      accountId,
      policies: [
        {
          effect: "allow",
          permissionGroups: [
            "Workers Scripts Write",
            "Secrets Store Write",
            "Account Settings Read",
          ],
          resources: { [account]: "*" },
        },
        {
          effect: "allow",
          permissionGroups: ["Zone Read"],
          resources: { [account]: { "com.cloudflare.api.account.zone.*": "*" } },
        },
      ],
    });

    yield* GitHub.Secret("cf-api-token", {
      owner,
      repository,
      name: "CLOUDFLARE_API_TOKEN",
      value: token.value,
    });

    yield* GitHub.Secret("cf-account-id", {
      owner,
      repository,
      name: "CLOUDFLARE_ACCOUNT_ID",
      value: Redacted.make(accountId),
    });
  }),
);
