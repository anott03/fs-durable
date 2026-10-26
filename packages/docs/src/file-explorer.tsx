import { Schema } from "effect";
import { useEffect, useState } from "react";
import { childPath } from "./demo/paths.js";
import { DemoNode } from "./demo/protocol.js";

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly node: DemoNode }
  | { readonly status: "error" };

const control = "cursor-pointer rounded px-2 py-1 text-zinc-300 hover:bg-zinc-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-300";

function useDemoNode(path: string) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    async function load() {
      try {
        const response = await fetch(`/api/demo?${new URLSearchParams({ path })}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Demo request failed");
        const node = Schema.decodeUnknownSync(DemoNode)(await response.json());
        if (node.path !== path) throw new Error("Unexpected demo path");
        if (!controller.signal.aborted) setState({ status: "ready", node });
      } catch {
        if (!controller.signal.aborted) setState({ status: "error" });
      }
    }
    void load();
    return () => controller.abort();
  }, [path, attempt]);

  return { state, retry: () => setAttempt((current) => current + 1) };
}

function LoadError({ retry }: { readonly retry: () => void }) {
  return (
    <div className="p-4">
      <p role="alert" className="text-zinc-400">Could not load the live filesystem.</p>
      <button type="button" onClick={retry} className={`${control} mt-2 underline`}>Try again</button>
    </div>
  );
}

function EntryIcon({ directory }: { readonly directory: boolean }) {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={directory ? "shrink-0 text-yellow-300" : "shrink-0 text-zinc-500"}>
      {directory
        ? <path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />
        : <><path d="M14 3H5v18h14V8Z" /><path d="M14 3v5h5M8 12h8M8 16h6" /></>}
    </svg>
  );
}

function DirectoryPanel({ path, selected, open }: {
  readonly path: string;
  readonly selected: string | null;
  readonly open: (path: string, directory: boolean) => void;
}) {
  const { state, retry } = useDemoNode(path);
  if (state.status === "loading") return <p role="status" className="p-4 text-zinc-400">Loading directory...</p>;
  if (state.status === "error") return <LoadError retry={retry} />;
  if (state.node.type !== "directory") return <p role="alert" className="p-4 text-zinc-400">Expected a directory.</p>;
  const entries = [...state.node.entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <nav aria-label={`Files in ${path}`} className="p-2">
      {entries.length === 0 && <p className="p-2 text-zinc-500">This directory is empty.</p>}
      <ul>
        {entries.map((entry) => {
          const target = childPath(path, entry.name);
          const directory = entry.type === "directory";
          return (
            <li key={entry.name}>
              <button type="button" onClick={() => open(target, directory)} aria-pressed={!directory && selected === target} className={`${control} flex w-full items-center gap-2 text-left aria-pressed:bg-zinc-800 aria-pressed:text-white`}>
                <EntryIcon directory={directory} />
                <span className="min-w-0 break-all">{entry.name}{directory && "/"}</span>
                {!directory && <span className="ml-auto shrink-0 text-[10px] text-zinc-500">{entry.size} B</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function FilePanel({ path }: { readonly path: string }) {
  const { state, retry } = useDemoNode(path);
  if (state.status === "loading") return <p role="status" className="p-4 text-zinc-400">Loading file...</p>;
  if (state.status === "error") return <LoadError retry={retry} />;
  if (state.node.type !== "file") return <p role="alert" className="p-4 text-zinc-400">Expected a file.</p>;
  const file = state.node;
  return (
    <>
      <div className="border-b border-zinc-700 px-4 py-3">
        <p className="break-all text-zinc-200">{file.path}</p>
        <p className="mt-1 text-[10px] leading-5 text-zinc-500">
          {file.size} bytes · Modified <time dateTime={new Date(file.modifiedAt).toISOString()}>{new Date(file.modifiedAt).toLocaleString()}</time>
        </p>
      </div>
      <pre tabIndex={0} aria-label={`Contents of ${file.path}`} className="max-h-96 overflow-auto p-4 text-xs leading-6 text-zinc-300"><code>{file.content}</code></pre>
    </>
  );
}

export function FileExplorer() {
  const [directory, setDirectory] = useState("/");
  const [selected, setSelected] = useState<string | null>("/README.md");
  const parts = directory.split("/").filter(Boolean);

  function navigate(path: string) {
    setDirectory(path);
    setSelected(null);
  }

  function open(path: string, isDirectory: boolean) {
    if (isDirectory) navigate(path);
    else setSelected(path);
  }

  return (
    <section aria-label="Live filesystem explorer" className="mt-6 overflow-hidden rounded-xl border border-zinc-700 text-xs leading-6 sm:text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-700 px-3 py-2">
        <nav aria-label="Filesystem breadcrumbs" className="flex min-w-0 flex-wrap items-center gap-1">
          <button type="button" onClick={() => navigate("/")} aria-current={directory === "/" ? "page" : undefined} className={control}>/</button>
          {parts.map((part, index) => {
            const path = `/${parts.slice(0, index + 1).join("/")}`;
            return (
              <span key={path} className="flex items-center gap-1">
                <button type="button" onClick={() => navigate(path)} aria-current={path === directory ? "page" : undefined} className={`${control} break-all`}>{part}</button>
                <span aria-hidden="true" className="text-zinc-600">/</span>
              </span>
            );
          })}
        </nav>
        <span className="px-2 text-[10px] uppercase tracking-wide text-yellow-300">Live · Read-only</span>
      </div>
      <div className="grid sm:min-h-80 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="max-h-64 overflow-auto border-b border-zinc-700 sm:max-h-[32rem] sm:border-b-0 sm:border-r">
          <DirectoryPanel key={directory} path={directory} selected={selected} open={open} />
        </div>
        <div className="min-w-0">
          {selected === null
            ? <p className="p-4 text-zinc-500">Select a file to read its contents.</p>
            : <FilePanel key={selected} path={selected} />}
        </div>
      </div>
    </section>
  );
}
