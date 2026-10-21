import { Effect, Schema } from "effect";
import { Runtime } from "foldkit";
import type { HtmlBuilder } from "foldkit/html";
import * as Mount from "foldkit/mount";
import typescript from "highlight.js/lib/languages/typescript";
import { createLowlight } from "lowlight";
import { StrictMode, useEffect, useRef, type ReactNode } from "react";
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

function Documentation() {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (container.current === null) return;
    return justifyProse(container.current);
  }, []);

  return (
    <div ref={container} className="mx-auto max-w-2xl px-6 py-12 font-mono text-sm leading-7 sm:py-20 sm:text-base">
      <header className="mb-12 flex items-center justify-between gap-6">
        <a href="/" className="font-semibold">fs-durable</a>
        <a href="https://github.com/anott03/fs-durable" className="underline">GitHub</a>
      </header>
      <main>
        <h1 className="mb-6 text-xl font-semibold tracking-tight sm:text-2xl">
          A filesystem for Durable Objects.
        </h1>
        <p className="mb-5">
          fs-durable is an Effect-native virtual filesystem for TypeScript. It gives an agent or application a small, persistent workspace: files, directories, and familiar read and write operations.
        </p>
        <p>
          It is a library you embed in your own Cloudflare Durable Object, not a separate storage service or a replacement for Node’s fs module.
        </p>
        <h2 className="mb-4 mt-10 font-semibold">How it works</h2>
        <p className="mb-5">
          A SQLite-backed Durable Object has its own private database. fs-durable stores the directory tree, file metadata, and binary file contents in tables inside that database. One object owns one filesystem.
        </p>
        <figure className="my-7">
          <div
            role="img"
            aria-label="Architecture: application or agent code calls the fs-durable Effect service, which uses storage.transactionSync() to access private SQLite tables for the directory tree, metadata, and file bytes. All layers live inside one Durable Object."
            className="architecture text-xs leading-6 sm:text-sm"
          >
            <p className="mb-5 font-semibold text-zinc-400">Your Durable Object</p>
            <div className="architecture-node">Application / agent</div>
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
                  <p className="text-zinc-400">Tree + metadata</p>
                </div>
                <div className="rounded border border-zinc-700 p-3">
                  <p>contents</p>
                  <p className="text-zinc-400">File bytes</p>
                </div>
              </div>
            </div>
          </div>
          <figcaption className="mt-3 text-xs text-zinc-400">
            One object, one filesystem. SQLite keeps the workspace across object evictions.
          </figcaption>
        </figure>
        <p className="mb-5">
          Every filesystem operation returns an Effect. When it runs, the database work happens synchronously inside a transaction. A failed mutation rolls back its changes; a sequence of separate filesystem calls is not a single transaction.
        </p>
        <p>
          The files live in storage, not in the object’s JavaScript memory. When the object is evicted and later starts again, reopening the filesystem restores access to the same files.
        </p>
        <h2 className="mb-4 mt-10 font-semibold">Working with files</h2>
        <p className="mb-5">
          Provide the filesystem layer from your object’s storage, then use the service in an Effect program:
        </p>
        <pre className="overflow-x-auto text-xs leading-6 sm:text-sm" tabIndex={0} aria-label="Filesystem usage example">
          <code className="hljs language-typescript">{highlightedExample.children.map(renderToken)}</code>
        </pre>
        <p className="mt-5">
          Paths are absolute and case-sensitive. Read and write text or bytes, create directories, list entries, copy, rename, append, truncate, and remove files. A memory backend offers the same API for tests.
        </p>
        <h2 className="mb-4 mt-10 font-semibold">Small by design</h2>
        <p className="mb-5">
          This is an early proof of concept for small workspaces. Files are buffered in full and limited to 1 MiB by default. There are no permissions, symlinks, watchers, or shell commands. It stores code; it does not execute it.
        </p>
      </main>
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
