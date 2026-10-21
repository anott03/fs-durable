import { Schema } from "effect";
import { Runtime } from "foldkit";
import type { HtmlBuilder } from "foldkit/html";
import typescript from "highlight.js/lib/languages/typescript";
import { createLowlight } from "lowlight";

const Model = Schema.Struct({});
type Model = typeof Model.Type;

const init = () => ({ model: {} });
const update = (model: Model) => ({ model });

const example = `const fs = yield* VirtualFileSystem;

yield* fs.makeDirectory("/src", { recursive: true });
yield* fs.writeFileString("/src/main.ts", "export const hello = 'world'");

const code = yield* fs.readFileString("/src/main.ts");`;

const highlightedExample = createLowlight({ typescript }).highlight("typescript", example);

function renderToken(
  node: (typeof highlightedExample.children)[number],
  h: HtmlBuilder<never>,
): string | ReturnType<HtmlBuilder<never>["span"]> {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return "";
  const classes = node.properties.className;
  return h.span(
    [h.Class(Array.isArray(classes) ? classes.join(" ") : "")],
    node.children.map((child) => renderToken(child, h)),
  );
}

export const view = (_model: Model, h: HtmlBuilder<never>) =>
  h.main([], [
    h.h1([h.Class("mb-6 text-xl font-semibold tracking-tight sm:text-2xl")], [
      "A filesystem for Durable Objects.",
    ]),
    h.p([h.Class("mb-5")], [
      "fs-durable is an Effect-native virtual filesystem for TypeScript. It gives an agent or application a small, persistent workspace: files, directories, and familiar read and write operations.",
    ]),
    h.p([], [
      "It is a library you embed in your own Cloudflare Durable Object, not a separate storage service or a replacement for Node’s fs module.",
    ]),
    h.h2([h.Class("mb-4 mt-10 font-semibold")], ["How it works"]),
    h.p([h.Class("mb-5")], [
      "A SQLite-backed Durable Object has its own private database. fs-durable stores the directory tree, file metadata, and binary file contents in tables inside that database. One object owns one filesystem.",
    ]),
    h.figure([h.Class("my-7")], [
      h.div([
        h.Role("img"),
        h.AriaLabel("Architecture: application or agent code calls the fs-durable Effect service, which uses storage.transactionSync() to access private SQLite tables for the directory tree, metadata, and file bytes. All layers live inside one Durable Object."),
        h.Class("architecture text-xs leading-6 sm:text-sm"),
      ], [
        h.p([h.Class("mb-5 font-semibold text-zinc-400")], ["Your Durable Object"]),
        h.div([h.Class("architecture-node")], ["Application / agent"]),
        h.div([h.Class("architecture-connector")], []),
        h.div([h.Class("architecture-node")], [
          h.p([h.Class("font-semibold")], ["fs-durable"]),
          h.p([h.Class("text-zinc-400")], ["Effect service"]),
        ]),
        h.div([h.Class("architecture-transaction")], [
          h.code([], ["storage.transactionSync()"]),
        ]),
        h.div([h.Class("architecture-node")], [
          h.p([h.Class("mb-3 font-semibold")], ["Private SQLite database"]),
          h.div([h.Class("grid gap-2 sm:grid-cols-2")], [
            h.div([h.Class("rounded border border-zinc-700 p-3")], [
              h.p([], ["nodes"]),
              h.p([h.Class("text-zinc-400")], ["Tree + metadata"]),
            ]),
            h.div([h.Class("rounded border border-zinc-700 p-3")], [
              h.p([], ["contents"]),
              h.p([h.Class("text-zinc-400")], ["File bytes"]),
            ]),
          ]),
        ]),
      ]),
      h.figcaption([h.Class("mt-3 text-xs text-zinc-400")], [
        "One object, one filesystem. SQLite keeps the workspace across object evictions.",
      ]),
    ]),
    h.p([h.Class("mb-5")], [
      "Every filesystem operation returns an Effect. When it runs, the database work happens synchronously inside a transaction. A failed mutation rolls back its changes; a sequence of separate filesystem calls is not a single transaction.",
    ]),
    h.p([], [
      "The files live in storage, not in the object’s JavaScript memory. When the object is evicted and later starts again, reopening the filesystem restores access to the same files.",
    ]),
    h.h2([h.Class("mb-4 mt-10 font-semibold")], ["Working with files"]),
    h.p([h.Class("mb-5")], [
      "Provide the filesystem layer from your object’s storage, then use the service in an Effect program:",
    ]),
    h.pre([h.Class("overflow-x-auto text-xs leading-6 sm:text-sm"), h.Tabindex(0), h.AriaLabel("Filesystem usage example")], [
      h.code([h.Class("hljs language-typescript")], highlightedExample.children.map((node) => renderToken(node, h))),
    ]),
    h.p([h.Class("mt-5")], [
      "Paths are absolute and case-sensitive. Read and write text or bytes, create directories, list entries, copy, rename, append, truncate, and remove files. A memory backend offers the same API for tests.",
    ]),
    h.h2([h.Class("mb-4 mt-10 font-semibold")], ["Small by design"]),
    h.p([h.Class("mb-5")], [
      "This is an early proof of concept for small workspaces. Files are buffered in full and limited to 1 MiB by default. There are no permissions, symlinks, watchers, or shell commands. It stores code; it does not execute it.",
    ]),
  ]);

export const docsElement = (container: HTMLElement) =>
  Runtime.makeElement({ Model, init, update, view, container });
