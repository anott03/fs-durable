import report from "./benchmarks.json";
import reportUrl from "./benchmarks.json?url";
import { DocsLayout } from "./layout.js";

const revisionUrl = `https://github.com/anott03/fs-durable/tree/${report.deployment.revision}`;
const benchmarkSourceUrl = `${revisionUrl}/packages/benchmarks`;
const linkClass = "text-blue-400 underline decoration-blue-400/50 underline-offset-4 hover:text-blue-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current";
const numericCell = "whitespace-nowrap px-3 py-3 text-right tabular-nums";

export function Benchmarks() {
  return (
    <DocsLayout page="benchmarks">
      <main className="p-6 [&>p]:[font-kerning:none] [&>p]:[font-variant-ligatures:none]">
        <p className="mb-3 text-xs text-zinc-400">Cloudflare Durable Objects · <time dateTime="2026-10-26">October 26, 2026</time></p>
        <h1 className="mb-6 text-xl font-semibold tracking-tight sm:text-2xl">Benchmarks</h1>
        <p className="mb-5">
          These results measure fs-durable running in SQLite-backed Durable Objects on Cloudflare. They do not include local workerd or in-memory benchmarks.
        </p>
        <p className="mb-6">
          The benchmark Worker was deployed with Alchemy from commit <a href={revisionUrl} className={linkClass}><code>2bc9f5a</code></a>. Each case uses 2 warmup batches and 10 measured batches, with a fresh fixture prepared before every batch.
        </p>
        <aside aria-labelledby="run-status" className="mb-8 rounded-lg border border-yellow-300/40 bg-yellow-300/5 p-4 text-sm leading-6">
          <h2 id="run-status" className="mb-2 font-semibold text-yellow-300">Complete results, but not a timeout-free run</h2>
          <p className="mb-3">
            The first sweep completed 33 cases. <code>stat.miss</code> hit the CLI's 60-second request timeout and completed in a separate retry. The table combines those 33 cases with the retry, for 340 measured batches across all 34 cases.
          </p>
          <p>
            A second full sweep timed out on <code>write.create.utf8.1MiB</code> and <code>read.utf8.1MiB</code>. Neither sweep was timeout-free. The timings below describe completed batches only, not the timeouts. Cleanup completed after each invocation.
          </p>
        </aside>

        <h2 className="mb-4 font-semibold">What the clock measures</h2>
        <p className="mb-5">
          A driver Durable Object in the same Cloudflare location times one RPC to the filesystem Durable Object. That RPC runs a sequential batch of filesystem operations. The clock includes the DO-to-DO RPC hop and the storage output gate, including the wait for write durability. It excludes the client's network trip to Cloudflare, fixture setup, verification, and cleanup.
        </p>
        <p className="mb-5">
          Every time in the table is for a whole batch, not one operation. For example, <code>read.binary.64KiB</code> took a median of 35 ms for 100 reads. Dividing that number by 100 gives amortized throughput, not the latency of an individual read.
        </p>
        <p className="mb-5">
          The RPC floor is the median of three no-op RPCs measured just before each batch. The table reports the median floor across the 10 samples. It ranges from 5 to 9 ms and has not been subtracted from the batch times.
        </p>
        <p className="mb-8">
          The report uses nearest-rank percentiles. With only 10 measured samples per case, p95 is the slowest completed batch in that case. Treat it as a small-sample observation, not a production tail-latency estimate.
        </p>

        <h2 className="mb-4 font-semibold">Cloudflare results</h2>
        <div role="region" aria-label="Cloudflare benchmark results, horizontally scrollable" tabIndex={0} className="overflow-x-auto rounded-lg border border-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-200">
          <table className="w-full text-xs leading-6 sm:text-sm">
            <caption className="border-b border-zinc-700 px-3 py-3 text-left text-zinc-400">
              34 cases · 10 measured batches per case · all times in milliseconds
            </caption>
            <thead className="bg-zinc-900 text-zinc-300">
              <tr>
                <th scope="col" className="px-3 py-3 text-left font-medium">Case</th>
                <th scope="col" className={`${numericCell} font-medium`}>Ops/batch</th>
                <th scope="col" className={`${numericCell} font-medium`}>Median ms</th>
                <th scope="col" className={`${numericCell} font-medium`}>p95 ms</th>
                <th scope="col" className={`${numericCell} font-medium`}>RPC floor ms</th>
              </tr>
            </thead>
            <tbody>
              {report.results.map((result) => {
                const timing = result.summaries.find((summary) => summary.kind === "remote-do-rpc");
                const floor = result.summaries.find((summary) => summary.kind === "remote-do-rpc-floor");
                return (
                  <tr key={result.case} className="border-t border-zinc-800 hover:bg-zinc-900/60">
                    <th scope="row" className="whitespace-nowrap px-3 py-3 text-left font-normal">
                      <code>{result.case}</code>{result.case === "stat.miss" && <span className="ml-2 text-yellow-300">retry</span>}
                    </th>
                    <td className={numericCell}>{result.opsPerBatch.toLocaleString("en-US")}</td>
                    <td className={numericCell}>{timing?.batchMedianMs ?? "N/A"}</td>
                    <td className={numericCell}>{timing?.batchP95Ms ?? "N/A"}</td>
                    <td className={`${numericCell} text-zinc-400`}>{floor?.batchMedianMs ?? "N/A"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-zinc-400">
          <code>stat.miss</code> comes from the targeted retry. All other rows come from the first sweep. The second sweep is not included in these timings.
        </p>

        <h2 className="mb-4 mt-10 font-semibold">Workloads</h2>
        <p className="mb-5">
          Binary and UTF-8 cases use the byte sizes in their names. UTF-8 payloads mix 1-, 2-, 3-, and 4-byte characters. Reads and overwrites repeatedly access one file. Creates write to new paths, and appends grow a file that starts empty.
        </p>
        <p className="mb-5">
          Directory listing cases contain 10, 1,000, or 5,000 empty files. Stat cases look up an existing path at the named depth or a missing path. File rename and remove cases use 1 KiB files. Tree cases use 10 directories with 100 files of 1 KiB in total. File copy uses a 64 KiB file.
        </p>
        <p className="mb-8">
          Batch sizes differ by case. Creates and copies add nodes, appends grow file contents, and removes shrink the fixture as the batch runs. Compare results only at matching batch sizes and deployment settings. These measurements are not a before/after comparison or a guarantee for another workload.
        </p>

        <h2 className="mb-4 mt-10 font-semibold">Data and reproduction</h2>
        <p className="mb-5">
          <a href={reportUrl} download="2bc9f5a-remote-summary.json" className={linkClass}>Download the consolidated JSON report</a> for all 340 samples, per-case summaries, timeout records, and source-report attribution.
        </p>
        <p>
          The <a href={`${benchmarkSourceUrl}/README.md#remote-benchmarks`} className={linkClass}>remote benchmark guide</a> at the measured commit explains how to deploy your own authenticated Worker and run the suite. Use 2 warmup batches, 10 measured batches, and the default iteration counts to match this report. Deploying and running it uses billable Cloudflare resources.
        </p>
      </main>
    </DocsLayout>
  );
}
