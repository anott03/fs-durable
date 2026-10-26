# @fs-durable/benchmarks

Private benchmark runner for `fs-durable`. It runs the same workload matrix
against three backends:

| Backend  | Where it runs                                              | Timings reported                                       |
| -------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| `memory` | `makeMemory` in the Node process                           | `node-batch`                                           |
| `sqlite` | `makeDurableObject` in local workerd via `createTestHarness` | `local-do-operation`, `local-harness-roundtrip`      |
| `remote` | A deployed copy of `src/worker.ts`, over HTTPS             | `remote-client-roundtrip`                              |

The CLI is plain TypeScript run by Node 24's built-in type stripping
(`node src/cli.ts`). There is no compile step for the runner. Every `bench`
script builds the `fs-durable` library first because the runner and the Worker
import its `dist` output.

## Commands

Run these from the repository root. The package scripts take the same flags.
A `--` separator before the flags is accepted and ignored, so
`pnpm bench -- --list` works too.

```sh
pnpm bench --list                    # case ids, default and max iterations, params
pnpm bench                           # memory + sqlite, all cases
pnpm bench:memory --case read,stat.  # only cases whose id starts with read or stat.
pnpm bench:sqlite --case write.overwrite.binary.1KiB --samples 50 --warmup 5
pnpm bench:sqlite --case stat.miss --iterations 20000
pnpm bench --help
```

| Flag             | Default         | Notes                                                                 |
| ---------------- | --------------- | --------------------------------------------------------------------- |
| `--backend`      | `memory,sqlite` | Comma-separated. `pnpm bench:memory` and friends set it for you.      |
| `--case`         | all             | Comma-separated id prefixes. `read` matches every `read.*` case.      |
| `--samples`      | 10              | Measured batches per case, 1 to 1000.                                 |
| `--warmup`       | 2               | Unmeasured batches per case, 0 to 100.                                |
| `--iterations`   | case default    | Operations per batch for every selected case. The CLI rejects the run if this exceeds any selected case's max. |
| `--json <path>`  | off             | Write the full report to a file.                                      |
| `--json -`       | off             | JSON on stdout, table and banners on stderr.                          |
| `--url`          | none            | Remote backend only. `https://`, or `http://` for `localhost` and `127.0.0.1`. No credentials in the URL. |
| `--run-id`       | random          | Matches `^[a-z0-9][a-z0-9-]{7,63}$`, so at least eight characters.    |

Relative `--json` paths resolve from the directory you ran pnpm in. pnpm runs
the script in `packages/benchmarks`, but it passes your original directory as
`INIT_CWD` and the CLI uses that. When the CLI runs without pnpm, paths resolve
from the current directory.

```sh
pnpm bench:sqlite --json sqlite.json   # writes ./sqlite.json at the repository root
```

With `--json -`, put `-s` on the pnpm command you type. Without it, pnpm prints
its `> script` banners to stdout and the output is no longer valid JSON. Flags
inside the package scripts can't turn those banners off for you:

```sh
pnpm -s bench:memory --case read --json - > memory.json
pnpm -s bench:memory --case read --json - | jq '.results[].summaries'
```

The CLI exits with status 1 if any case fails or cleanup fails. Failed cases
keep their samples in the JSON with `ok: false` and an `error`.

## Workload matrix

`pnpm bench --list` prints the current matrix. Every batch is a sequential loop
of one operation.

| Group                   | Ids                                                     | What a batch does                                      |
| ----------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| Create                  | `write.create.{binary,utf8}.{1KiB,64KiB,1MiB}`          | Exclusive `writeFile`/`writeFileString` to new paths   |
| Overwrite               | `write.overwrite.{binary,utf8}.{1KiB,64KiB,1MiB}`       | Rewrite one existing file of the same size            |
| Read                    | `read.{binary,utf8}.{1KiB,64KiB,1MiB}`                  | Read one file repeatedly                               |
| Append                  | `append.binary.{1KiB,64KiB}`                            | Append chunks to a file that starts empty              |
| Stat                    | `stat.depth.{3,16,64}`, `stat.miss`, `exists.miss`      | Path lookups that hit at depth N, or miss              |
| Directory listing       | `readDirectory.{10,1000,5000}`                          | List a directory of N empty files                      |
| Rename, copy, remove    | `rename.{file,tree}`, `copy.{file.64KiB,tree}`, `remove.{file,tree}` | Single 1 KiB files, or trees of 10 directories with 100 files of 1 KiB |

UTF-8 payloads mix 1, 2, 3 and 4 byte characters, so the byte sizes are exact
but the string length is smaller.

The prepare step resets the fixture before every sample, including warmups.
Read, overwrite, stat, listing and both rename cases run against the same
amount of state on every operation. The rest do not. Create and copy add nodes
as the batch runs, append grows one file, and remove shrinks the fixture. The
iteration caps bound that state, but the last operation in a batch can see a
different filesystem than the first. Changing `--iterations` changes what those
cases measure, so compare them only at equal iteration counts.

### Iteration caps

Each case has a `max` shown by `--list`. The current limits, from
`src/workloads.ts`:

- 20,000 operations per batch.
- 64 MiB of logical read or write I/O per batch, so `1MiB` cases max out at 64
  and `64KiB` cases at 1,024.
- 20,000 created nodes per batch. `copy.tree` and `remove.tree` create 111
  nodes each, so they stop at 180.
- Append stops before the library's 1,900,000 byte file limit: 1,855 chunks of
  1 KiB or 28 of 64 KiB.
- `readDirectory` lists at most 200,000 entries per batch.

The Worker enforces the same caps on `/v1/prepare`. The CLI checks them before
it starts.

## Reading the results

Each row is one backend, case and timing kind. `batch med ms` and
`batch p95 ms` are the median and nearest-rank p95 of whole batches.
`amortized us/op`, `ops/s` and `MiB/s` divide the median batch by the batch
size. They are throughput figures, not per-operation latency. A batch median of
10 ms over 1,000 ops tells you nothing about the slowest single `stat`.

The JSON report keeps the raw per-sample timings under `results[].samples`,
plus `environment` (Node, OS, CPU, git revision and dirty flag, Effect version)
and per-backend metadata. Compare runs from the same machine and revision.

### What each timing covers

| Timing                    | Clock                              | Includes                                                         |
| ------------------------- | ---------------------------------- | ---------------------------------------------------------------- |
| `node-batch`              | `performance.now()` in Node        | The batch loop only                                              |
| `local-do-operation`      | `performance.now()` in local workerd | The batch loop only, inside the Durable Object                 |
| `local-harness-roundtrip` | Node, around the run request       | HTTP to local workerd, Worker, DO RPC, verification, logging, nonce bookkeeping, output gate |
| `remote-client-roundtrip` | Node, around the run request       | Everything above plus the network and real Durable Object storage durability |

Setup is never timed. Fixture prepare and cleanup happen outside the clock on
every backend, and the prepare request is not part of any roundtrip. Local
backends also verify results after the clock stops. The remote roundtrip
contains verification because it runs inside the same request.

`memory` is not a POSIX baseline. It is the library's in-memory backend in
Node, useful to separate algorithmic cost from SQLite cost. `sqlite` runs real
SQLite storage, but in workerd on your machine with ephemeral storage. Neither
predicts edge latency or durability cost. Only `remote` exercises a deployed
Durable Object, and it reports client-side roundtrips only.

### Timer resolution

workerd's local clock reports `local-do-operation` in whole milliseconds. When
a case's median is under 20 ms, the table marks the timing with `*` and leaves
the rates blank, and the JSON sets `belowResolution: true` and the rates to
`null`. Raise `--iterations` until the median clears 20 ms, within the case's
max. The roundtrip timings come from Node's clock and have no such flag, but at
small batch sizes they mostly measure request overhead.

Deployed Workers freeze timers until I/O happens, which is why the deployed
Worker does not return internal timings at all. See
[Performance and timers](https://developers.cloudflare.com/workers/runtime-apis/performance/).

## Remote benchmarks

The remote backend talks to a Worker you deploy yourself. Nothing in this
package deploys automatically. `pnpm build` runs `wrangler deploy --dry-run`,
which bundles the Worker without uploading it.

### What the Worker exposes

Three `POST` routes, all behind a bearer token:

- `/v1/prepare?run=&case=&iterations=` builds the fixture and returns a nonce.
- `/v1/run?run=&nonce=` runs the prepared batch once.
- `/v1/cleanup?run=` calls `deleteAll()` on the run's Durable Object.

The Worker checks the token before it touches a Durable Object. It fails closed:
a missing `BENCHMARK_TOKEN` secret returns 503, a wrong token returns 401. It
rejects unknown routes, parameters, cases, and iteration counts above the case
cap. There is no endpoint for arbitrary paths, file contents or SQL. Each run id
maps to its own Durable Object named `fs-bench:<run-id>`.

### Deploy a dedicated Worker

Use a Worker name that belongs to you. A separate Worker gets its own Durable
Object namespace, so benchmark data never shares storage with anything else.

The first deploy has to include the secret, because `wrangler secret put`
cannot target a Worker that does not exist yet and `wrangler.jsonc` marks
`BENCHMARK_TOKEN` as required. Generate the token into a private temporary
file so it never appears in your terminal or shell history:

```sh
umask 077
secrets="$(mktemp)"
printf 'BENCHMARK_TOKEN=%s\n' "$(openssl rand -hex 32)" > "$secrets"

pnpm --filter fs-durable build
pnpm --filter @fs-durable/benchmarks exec \
  wrangler deploy --name fs-durable-bench-<you> --secrets-file "$secrets"
```

To rotate the token on an existing Worker, `wrangler secret put` prompts for
the value without echoing it:

```sh
pnpm --filter @fs-durable/benchmarks exec \
  wrangler secret put BENCHMARK_TOKEN --name fs-durable-bench-<you>
```

`wrangler.jsonc` turns on logs and traces with a head sampling rate of 1. Every
request is logged and traced, which counts against your Workers Observability
usage. Lower the rates in your copy if you plan long runs.

### Run against it

Load the token into the environment without printing it, then run:

```sh
set -a; . "$secrets"; set +a

pnpm bench:remote \
  --url https://fs-durable-bench-<you>.<subdomain>.workers.dev \
  --run-id my-bench-run-01 \
  --case read.binary.64KiB,write.overwrite.binary.64KiB \
  --json remote.json

rm "$secrets"
```

Delete the file once you no longer need the token locally. Do not paste a real
token into commands, issues or committed files.

The CLI refuses any scheme other than `https://`, except `http://` to
`localhost` or `127.0.0.1`. It also refuses URLs with a username or password.
Each request times out after 60 seconds, cleanup included. For a local smoke test, put a throwaway token in
`packages/benchmarks/.dev.vars`, run `pnpm --filter @fs-durable/benchmarks dev`,
and pass `--url http://localhost:8787`. That Worker also has internal timing
off, so you only get roundtrips.

### Run ids and cleanup

Without `--run-id`, the CLI picks a random one. Pass a stable id when you want
a stable Durable Object id, for example to profile it. The JSON report records
it under `backends[].metadata`:

```sh
jq -r '.backends[] | select(.name == "remote") | .metadata.durableObjectId' remote.json
```

The CLI calls `/v1/cleanup` at the end of each backend, even after a failed
case. If you kill the process hard, the Durable Object keeps its data until a
later run with the same run id finishes and cleans up. Note the id if you
interrupt a run.

Do not run two clients with the same run id at the same time. They share one
Durable Object: each prepare invalidates the other's nonce, and the first
cleanup deletes the other's fixture.

If the Durable Object restarts between prepare and run, the run returns
`evicted` and the CLI prepares again, up to three times per sample. The JSON
records retries in `samples[].reprepared`.

## Profiling the deployed Durable Object

Remote roundtrips tell you how long a batch took end to end. They do not tell
you where the CPU went. For that, use Cloudflare's
[production CPU and heap profiling](https://developers.cloudflare.com/workers/observability/profiling-in-production/)
for Workers and Durable Objects. Treat the flamegraph as a diagnostic. It shows
which frames dominate, not a speed score to compare against the roundtrip
numbers.

A heap profile samples allocations, one stack every 512 kB allocated. It is not
a heap snapshot and does not show retained memory.

### Supply traffic

Capture only attaches to a recently active, already-loaded isolate, and it
records what runs during the capture window. So start traffic first and keep it
going until the capture ends.

Use one stable run id so every request lands on the same Durable Object. Each
CLI invocation still ends with cleanup, which deletes the storage, but the
Durable Object id stays the same because it comes from the name. Rerunning the
same command keeps feeding the same instance:

```sh
for i in 1 2 3; do
  pnpm bench:remote --url https://fs-durable-bench-<you>.<subdomain>.workers.dev \
    --run-id my-profile-run-01 \
    --case read.binary.64KiB \
    --samples 200 --warmup 2 --iterations 100 \
    --json profile-$i.json
done
```

That is 600 measured batches of 100 reads, about 3.7 GiB of logical reads in
total.
It should outlast a 10 second capture. If it doesn't, rerun the loop rather
than raising the numbers. Keep one narrow `--case` filter so a single
operation dominates the profile.

This traffic can cost money. Every sample is two requests, a prepare and a run.
Each one is a Worker invocation and a Durable Object request, runs SQLite reads
and writes, and emits logs and traces that count as Workers Observability
usage. The fixture also counts as stored data until cleanup. Stop the loop
as soon as the capture finishes. Ctrl-C ends it, then rerun one short command
with the same run id so cleanup deletes the stored data.

The profile covers the whole request, not just the timed loop. Every sample
prepares a fresh fixture, verifies the result and logs it, and the last request
cleans up. When reading the flamegraph, start from `measureBatch` and the
`fs-durable` frames under it. Ignore frames under `prepareBatch`, verification
and the request handling.

### Capture

You need the owning Worker name, the Durable Object namespace id (shown on the
dashboard's **Durable Objects** page), the 64-character Durable Object id from
the JSON report, and the deployed version.
`wrangler.jsonc` sets `upload_source_maps`, so frames show source names.

In the dashboard:

1. Go to **Durable Objects**, select the namespace for your benchmark Worker,
   then the instance with your Durable Object id.
2. Select **Observability**, then *Flamegraph* in the view dropdown.
3. Pick *CPU* or *Heap*, a duration from 1,000 to 50,000 ms, and the running
   version.
4. Select **Capture profile** while the benchmark loop is running.

With the [Cloudflare CLI](https://developers.cloudflare.com/cf/), the same
capture writes pprof to stdout. `--worker-id` is the Worker that owns the
namespace. `latest` is the most recently created version, which may not be
the deployed one; pass the running version id if they differ.

```sh
cf workers versions profile latest \
  --worker-id fs-durable-bench-<you> \
  --duration-ms 10000 \
  --profile-type cpu \
  --namespace-id "$NAMESPACE_ID" \
  --actor-id "$DURABLE_OBJECT_ID" > bench-do-cpu.pprof
```

Use `--profile-type heap` for an allocation profile. If capture reports no
recent executions or no loaded isolate, traffic stopped or went to a different
instance or version.

### Logs and traces

The Durable Object writes one JSON log line per batch, not per operation:
`fs-bench.batch` with `runId`, `doId`, `case`, `iterations`, `ops`, `bytes` and
`ok`. Prepare failures, evictions and cleanup log `fs-bench.prepare`,
`fs-bench.evicted` and `fs-bench.cleanup`. Filter by `runId` in Workers Logs to
find a run.

Traces include the automatic spans for the request and the Durable Object RPC,
plus one custom `fs-bench.batch` span with `bench.run_id`, `bench.case` and
`bench.iterations` attributes. Use these to find a batch, not to time it.
Deployed timers only move on I/O, so spans around non-I/O work can report
0 ms ([known limitations](https://developers.cloudflare.com/workers/observability/traces/known-limitations/)).
The benchmark does not add per-query spans, and you should not expect
automatic spans for individual SQLite statements.
