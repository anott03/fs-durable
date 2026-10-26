# fs-durable

An Effect-native virtual filesystem for Cloudflare Durable Objects.

This pnpm workspace contains three packages:

- [`packages/fs-durable`](packages/fs-durable): the publishable TypeScript library,
  its tests, and the Durable Object example. See its [README](packages/fs-durable/README.md)
  for the API and storage semantics.
- [`packages/docs`](packages/docs): a single-page documentation site using Foldkit,
  React, Tailwind CSS, and Vite, with its Alchemy deployment config.
  It is private and is not part of the library package.
- [`packages/benchmarks`](packages/benchmarks): a private benchmark runner that
  measures the library's memory and Durable Object SQLite backends locally, or a
  Worker you deploy yourself. See the [benchmark guide](packages/benchmarks/README.md).

## Development

```sh
pnpm install
pnpm dev          # docs site
pnpm lint
pnpm typecheck    # all packages
pnpm test         # library tests (Node + Workers runtime)
pnpm build        # library, docs, and a dry-run bundle of the benchmark Worker
```

## Benchmarks

```sh
pnpm bench --list                    # list cases
pnpm bench                           # memory + local SQLite, all cases
pnpm bench:memory --case read,stat.  # comma-separated case id prefixes
pnpm bench:sqlite --samples 50 --json "$PWD/sqlite.json"
pnpm bench:remote --url https://... --run-id my-bench-run-01
```

The runner uses Node 24's built-in TypeScript support and builds the library
first. Local runs never touch Cloudflare. `bench:remote` needs a Worker you
deploy and a `BENCHMARK_TOKEN` in your environment. The
[benchmark guide](packages/benchmarks/README.md) covers the workload matrix,
how to read the timings, safe remote setup, and production profiling.

Run a package on its own with `pnpm --filter fs-durable ...` or
`pnpm --filter @fs-durable/docs ...`. `pnpm example:dev` starts the local Durable
Object example; `pnpm example:types` regenerates its binding types.

Foldkit hosts the docs through `Runtime.embed`. A scoped `Mount.define` action
mounts the React JSX page inside a Foldkit-owned element and unmounts the React
root when that element is released. React exclusively owns the element's children.
The page is deliberately simple:
a centered, monospace reading column with no sidebar or component library.

Foldkit currently pins Effect and `@effect/platform-browser` to 4.0.0. Those
versions are local to the docs package; the library keeps its own Effect peer
dependency and does not depend on any frontend packages.

## Deploy the docs

The Alchemy stack uses `Cloudflare.Website.Foldkit` to build the docs with their
own Vite configuration and upload the result as an assets-only Cloudflare Worker
(not Pages) at https://fs-durable.amitav.dev. There is no custom server or database.

Use Node.js 24.11.1 or newer. Configure your Cloudflare profile interactively,
then deploy explicitly:

```sh
pnpm --filter @fs-durable/docs exec alchemy profile edit --add Cloudflare
pnpm deploy:docs
```

The deploy command targets the `prod` stage, asks for confirmation, and prints
the site's URL. Alchemy uses Cloudflare-backed deployment state. Credentials live
in your local Alchemy profile, not in the repository. `pnpm dev`, `pnpm build`,
and the test commands are local and do not provision Cloudflare resources.

### CI deployments

`.github/workflows/docs.yml` lints and builds the docs on every pull request that
touches them, deploys `prod` on pushes to `main`, and deploys each same-repository
pull request to its own `pr-<number>` stage. Preview stages get a `workers.dev`
URL, which the workflow posts as a pull request comment; closing the pull request
destroys its stage. Only `prod` uses the custom domain.

The workflow needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository
secrets. `stacks/github.ts` creates a scoped account API token and writes both
secrets. Run it once with an Alchemy profile that has Cloudflare and GitHub
credentials (creating account tokens needs the `Account API Tokens Write`
permission):

```sh
pnpm --filter @fs-durable/docs exec alchemy profile edit --add GitHub
pnpm --filter @fs-durable/docs deploy:github
```

Re-run it to rotate the token. Mark the `docs result` check as required in branch
protection if pull requests should not merge until the docs build.

The docs package keeps Alchemy's Effect adapters aligned with Foldkit's 4.0.0 pin
through compatible dependency overrides in `pnpm-workspace.yaml`. It uses
TypeScript 6 to satisfy Alchemy's tooling peers; the library keeps TypeScript 7.

Anti-slop Oxlint rules apply across all packages. Vendored lint tooling, agent
assets, generated bindings, and build output are excluded. The Effect rule
currently checks relative imports, not package-alias imports.
