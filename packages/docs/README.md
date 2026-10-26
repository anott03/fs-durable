# Docs and filesystem demo

The docs Alchemy stack deploys two Workers in each stage:

- `Docs` serves the website and the read-only `/api/demo?path=/...` endpoint.
- `FilesystemDemo` owns the SQLite-backed `DemoFilesystem` Durable Object. Both its stable workers.dev URL and version preview URLs are disabled. It has no custom domains or routes. Only the docs Worker's `DEMO` service binding calls it.

The browser calls the docs endpoint, which forwards a validated GET request through the service binding. The demo Worker routes every request to the same named object, `docs-demo`. The object exposes only a `browse` RPC method and reads files using fs-durable. No endpoint accepts writes or caller-supplied object IDs.

## Local development

From the repository root:

```sh
pnpm install
pnpm dev
```

This builds fs-durable and starts Alchemy's local development environment for the docs Worker, service binding, and Durable Object. Use the docs URL printed by Alchemy. Running Vite by itself, including `pnpm --filter @fs-durable/docs preview`, only serves static assets and does not run the demo backend.

Alchemy uses the stack's Cloudflare state provider, so its usual account and credentials setup still applies.

## Seed files

Edit `src/demo/seed.ts` and increment `seedVersion` to replace the sample workspace. On the next object activation after deployment, the constructor replaces the old files and records the version in one synchronous storage transaction. Reopening an object with the same version preserves its existing files and timestamps. The sample includes nested directories and an empty directory.

Files are limited to 16 KiB. Paths must be absolute and canonical, with no empty segments, dot segments, backslashes, or control characters. Successful responses have a 30-second browser cache lifetime. File contents are rendered as text, never HTML.

Production and PR previews use separate Alchemy stages and therefore separate demo Workers and namespaces. The existing PR cleanup workflow destroys the whole stage, including the demo.

## Dependencies

`effect-filesystem` aliases Effect 4.0.5 for the demo Worker, matching fs-durable. The docs frontend and Alchemy keep Effect 4.0.0, which the current Foldkit version requires. Only plain data crosses the Worker boundary.

## Checks

```sh
pnpm --filter @fs-durable/docs build
pnpm exec oxlint packages/docs
```

The docs scripts build the filesystem dependency before typechecking, developing, or deploying. CI does the same before invoking Alchemy directly.
