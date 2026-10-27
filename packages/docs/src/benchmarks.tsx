import report from "./benchmarks.json";
import { DocsLayout } from "./layout.js";

const numericCell = "whitespace-nowrap px-3 py-3 text-right tabular-nums";

export function Benchmarks() {
  return (
    <DocsLayout page="benchmarks">
      <main className="p-6 [&>p]:[font-kerning:none] [&>p]:[font-variant-ligatures:none]">
        <p className="mb-3 text-xs text-zinc-400">Cloudflare Durable Objects · <time dateTime="2026-10-26">October 26, 2026</time></p>
        <h1 className="mb-6 text-xl font-semibold tracking-tight sm:text-2xl">Benchmarks</h1>
        <p className="mb-6">
          Batch timings for fs-durable in SQLite-backed Cloudflare Durable Objects. Times are per batch, not per operation.
        </p>
        <aside aria-label="Run caveat" className="mb-8 rounded-lg border border-yellow-300/40 bg-yellow-300/5 p-4 text-sm leading-6">
          Both full-suite runs hit request timeouts. These results use completed batches from the first run and a separate <code>stat.miss</code> retry. Failed requests are not included in the timings.
        </aside>

        <h2 className="mb-4 font-semibold">Results</h2>
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
        <details className="mt-8 text-sm leading-6">
          <summary className="cursor-pointer font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current">Methodology</summary>
          <p className="mt-4">
            Each case uses 2 warmup batches and 10 measured batches, with a fresh fixture before each batch. Batch sizes differ by case.
          </p>
          <p className="mt-4">
            Timings include one DO-to-DO RPC and the wait for storage durability. They exclude the client's network trip, fixture setup, verification, and cleanup.
          </p>
          <p className="mt-4">
            With 10 samples, nearest-rank p95 is the slowest completed batch. The RPC floor is the median of three no-op RPCs before each batch, then the median across samples. It has not been subtracted from the batch times.
          </p>
        </details>
      </main>
    </DocsLayout>
  );
}
