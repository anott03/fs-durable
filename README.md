# fs-durable

An Effect-native virtual filesystem for Cloudflare Durable Objects.

This pnpm workspace contains two packages:

- [`packages/fs-durable`](packages/fs-durable): the publishable TypeScript library,
  its tests, and the Durable Object example. See its [README](packages/fs-durable/README.md)
  for the API and storage semantics.
- [`packages/docs`](packages/docs): a single-page documentation site using Foldkit,
  React, Tailwind CSS, and Vite, including its tests and Alchemy deployment config.
  It is private and is not part of the library package.

## Development

```sh
pnpm install
pnpm dev          # docs site
pnpm lint
pnpm typecheck    # all packages
pnpm test         # library tests (Node + Workers runtime)
pnpm build        # library + docs
```

For the docs' desktop/mobile browser smoke test, install Chromium once with
`pnpm --filter @fs-durable/docs exec playwright install chromium`, then run
`pnpm test:docs`. This checks rendering, links, monospace styling, overflow, and
browser runtime errors against the production build.

Run a package on its own with `pnpm --filter fs-durable ...` or
`pnpm --filter @fs-durable/docs ...`. `pnpm example:dev` starts the local Durable
Object example; `pnpm example:types` regenerates its binding types.

The docs use Foldkit's supported `Runtime.embed` integration: React owns the
page shell, and Foldkit renders the documentation inside it. The embedded runtime
is disposed when the React component unmounts. The page is deliberately simple:
a centered, monospace reading column with no sidebar or component library.

Foldkit currently pins Effect and `@effect/platform-browser` to 4.0.0. Those
versions are local to the docs package; the library keeps its own Effect peer
dependency and does not depend on any frontend packages.

## Deploy the docs

The Alchemy stack uses `Cloudflare.Website.Foldkit` to build the docs with their
own Vite configuration and upload the result as an assets-only Cloudflare Worker
(not Pages). There is no custom server, database, or domain configuration.

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

The docs package keeps Alchemy's Effect adapters aligned with Foldkit's 4.0.0 pin
through compatible dependency overrides in `pnpm-workspace.yaml`. It uses
TypeScript 6 to satisfy Alchemy's tooling peers; the library keeps TypeScript 7.

Anti-slop Oxlint rules apply across both packages. Vendored lint tooling, agent
assets, generated bindings, and build output are excluded. The Effect rule
currently checks relative imports, not package-alias imports.
