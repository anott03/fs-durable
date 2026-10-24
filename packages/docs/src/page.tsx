import { Effect, Schema } from "effect";
import { Runtime } from "foldkit";
import type { HtmlBuilder } from "foldkit/html";
import * as Mount from "foldkit/mount";
import typescript from "highlight.js/lib/languages/typescript";
import { createLowlight } from "lowlight";
import { StrictMode, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { justifyProse } from "./justify.js";

const example = `const fs = yield* VirtualFileSystem;

yield* fs.makeDirectory("/src", { recursive: true });
yield* fs.writeFileString("/src/main.ts", "export const hello = 'world'");

const code = yield* fs.readFileString("/src/main.ts");`;

const highlightedExample = createLowlight({ typescript }).highlight("typescript", example);

function renderToken(node: (typeof highlightedExample.children)[number], key: number): ReactNode {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return null;
  const classes = node.properties.className;
  return (
    <span key={key} className={Array.isArray(classes) ? classes.join(" ") : undefined}>
      {node.children.map(renderToken)}
    </span>
  );
}

type CopyStatus = "idle" | "copied" | "error";

const copyMessages = {
  idle: "",
  copied: "Copied!",
  error: "Could not copy. Select the code to copy manually.",
} satisfies Record<CopyStatus, string>;

function CopyIcon({ status }: { readonly status: CopyStatus }) {
  if (status === "copied") return <path d="m5 12 4 4L19 6" />;
  if (status === "error") return <path d="m6 6 12 12M6 18 18 6" />;
  return (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  );
}

function CodeExample() {
  const [status, setStatus] = useState<CopyStatus>("idle");

  useEffect(() => {
    if (status === "idle") return;
    const timeout = window.setTimeout(() => setStatus("idle"), 3000);
    return () => window.clearTimeout(timeout);
  }, [status]);

  async function writeExample() {
    try {
      await navigator.clipboard.writeText(example);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }

  function copyCode() {
    void writeExample();
  }

  return (
    <div className="relative rounded-xl border border-zinc-700 p-4 sm:p-6">
      <span role="status" className="sr-only">{copyMessages[status]}</span>
      <button
        type="button"
        aria-label="Copy code"
        title={copyMessages[status] || "Copy code"}
        onClick={copyCode}
        className="absolute right-3 top-3 cursor-pointer rounded bg-zinc-950 p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-200 sm:right-5 sm:top-5"
      >
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <CopyIcon status={status} />
        </svg>
      </button>
      <pre className="overflow-x-auto pr-10 text-xs leading-6 sm:text-sm" tabIndex={0} aria-label="Filesystem usage example">
        <code className="hljs language-typescript">{highlightedExample.children.map(renderToken)}</code>
      </pre>
    </div>
  );
}

function Documentation() {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (container.current === null) return;
    return justifyProse(container.current);
  }, []);

  return (
    <div ref={container} className="w-full overflow-x-clip font-mono text-sm leading-7 sm:text-base">
      <div className="mx-auto flex min-h-dvh w-full flex-col after:pointer-events-none after:fixed after:hidden md:after:block after:inset-y-0 after:left-1/2 after:z-20 after:w-full after:-translate-x-1/2 after:border-x after:border-zinc-700 md:max-w-4xl md:after:w-[calc(var(--container-4xl)+2px)]">
        <header className="sticky top-0 z-10 flex w-full md:top-8 justify-between border-b border-zinc-700 bg-zinc-950 md:mt-8 md:before:absolute md:before:-inset-x-[100vw] md:before:bottom-full md:before:h-8 md:before:border-b md:before:border-zinc-700 md:before:bg-zinc-950">
          <span className="bg-yellow-300 px-3 text-zinc-950 duration-200">fs-durable</span>
          <a href="https://github.com/anott03/fs-durable" className="flex items-center gap-1.5 bg-blue-500 px-3 text-white duration-200 hover:bg-blue-600">
            GitHub
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
            </svg>
          </a>
        </header>
        <div className="flex-1">
          <main className="p-6 pb-0">
            <h1 className="mb-6 text-xl font-semibold tracking-tight sm:text-2xl">
              A filesystem for Durable Objects.
            </h1>
            <p className="mb-5">
              fs-durable is a TypeScript library for files and directories inside a Cloudflare Durable Object. Your application or agent uses Effect to read and write files that persist across object evictions.
            </p>
            <p>
              You provide the Durable Object and its storage. fs-durable runs inside that object, with no separate storage service. It does not replace the Node.js fs module.
            </p>
            <h2 className="mb-4 mt-10 font-semibold">How it works</h2>
            <p className="mb-5">
              A SQLite-backed Durable Object has its own private database. fs-durable stores the directory tree and file metadata separately from the file contents. Each object has one filesystem.
            </p>
            <figure className="my-7">
              <div
                role="img"
                aria-label="Architecture: your application or agent calls the fs-durable Effect service. Each operation uses storage.transactionSync() to access a private SQLite database. The database stores the directory tree, file metadata, and file bytes. Everything runs inside your Durable Object."
                className="architecture text-xs leading-6 sm:text-sm"
              >
                <p className="mb-5 font-semibold text-zinc-400">Your Durable Object</p>
                <div className="architecture-node">Application or agent</div>
                <div className="architecture-connector" />
                <div className="architecture-node">
                  <p className="font-semibold">fs-durable</p>
                  <p className="text-zinc-400">Effect service</p>
                </div>
                <div className="architecture-transaction"><code>storage.transactionSync()</code></div>
                <div className="architecture-node">
                  <p className="mb-3 font-semibold">Private SQLite database</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded border border-zinc-700 p-3">
                      <p>nodes</p>
                      <p className="text-zinc-400">Tree and metadata</p>
                    </div>
                    <div className="rounded border border-zinc-700 p-3">
                      <p>contents</p>
                      <p className="text-zinc-400">File bytes</p>
                    </div>
                  </div>
                </div>
              </div>
              <figcaption className="mt-3 text-xs text-zinc-400">
                SQLite retains your files when Cloudflare evicts the object from memory.
              </figcaption>
            </figure>
            <p className="mb-5">
              Each filesystem operation returns an Effect. When you run the Effect, fs-durable accesses SQLite synchronously in one transaction. If the operation fails, the transaction rolls back its changes. Separate filesystem calls do not share a transaction.
            </p>
            <h2 className="mb-4 mt-10 font-semibold">File operations</h2>
            <p className="mb-5">
              Your Effect program accesses files through the VirtualFileSystem service. This example creates a directory, writes a TypeScript file, and reads its contents:
            </p>
            <CodeExample />
            <p className="mt-5">
              Paths are absolute and case-sensitive. You can read and write text or bytes, create directories, and list their entries. The API also supports copy, rename, append, truncate, and remove operations. Tests can use the same API with the memory backend.
            </p>
            <h2 className="mb-4 mt-10 font-semibold">Limits</h2>
            <p className="mb-5">
              fs-durable is a proof of concept for small workspaces. Reads and writes buffer the entire file in memory. The default file size limit is 1 MiB. There are no permissions, symlinks, file watchers, or shell commands. fs-durable stores code, but it does not execute it.
            </p>
          </main>
        </div>
        <div aria-hidden="true" className="sticky bottom-0 z-10 hidden h-8 md:block md:before:absolute md:before:-inset-x-[100vw] md:before:inset-y-0 md:before:border-t md:before:border-zinc-700 md:before:bg-zinc-950" />
      </div>
    </div>
  );
}

const Model = Schema.Struct({});
type Model = typeof Model.Type;
const CompletedReactMount = Schema.TaggedStruct("CompletedReactMount", {});

// Foldkit owns the host and lifecycle; React exclusively owns its descendants.
const MountDocumentation = Mount.define("MountDocumentation", {
  messages: [CompletedReactMount],
  execute: ({ element }) => Effect.gen(function* () {
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const root = createRoot(element);
        root.render(<StrictMode><Documentation /></StrictMode>);
        return root;
      }),
      (root) => Effect.sync(() => root.unmount()),
    );
    return CompletedReactMount.make({});
  }),
});

const init = () => ({ model: {} });
const update = (model: Model, _message: typeof CompletedReactMount.Type) => ({ model });
export const view = (_model: Model, h: HtmlBuilder<typeof CompletedReactMount.Type>) =>
  h.div([h.OnMount(MountDocumentation())], []);

export const docsElement = (container: HTMLElement) =>
  Runtime.makeElement({ Model, init, update, view, container });
