import { Schema } from "effect";
import { Runtime } from "foldkit";
import type { HtmlBuilder } from "foldkit/html";

const Model = Schema.Struct({});
type Model = typeof Model.Type;

const init = () => ({ model: {} });
const update = (model: Model) => ({ model });

const example = `const fs = yield* VirtualFileSystem;

yield* fs.makeDirectory("/src", { recursive: true });
yield* fs.writeFileString("/src/main.ts", "export const hello = 'world'");

const code = yield* fs.readFileString("/src/main.ts");`;

const architecture = `Your Durable Object
┌─────────────────────────────────┐
│ Application / agent             │
│             │                   │
│             ▼                   │
│ fs-durable (Effect service)      │
│             │                   │
│   storage.transactionSync()     │
│             ▼                   │
│ Private SQLite database         │
│   nodes    → tree + metadata     │
│   contents → file bytes          │
└─────────────────────────────────┘`;

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
      h.pre([
        h.Role("img"),
        h.AriaLabel("Architecture: application or agent code calls the fs-durable Effect service, which uses storage.transactionSync() to access private SQLite tables for the directory tree, metadata, and file bytes. All layers live inside one Durable Object."),
        h.Class("overflow-x-auto text-xs leading-6 sm:text-sm"),
        h.Tabindex(0),
      ], [architecture]),
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
      h.code([], [example]),
    ]),
    h.p([h.Class("mt-5")], [
      "Paths are absolute and case-sensitive. Read and write text or bytes, create directories, list entries, copy, rename, append, truncate, and remove files. A memory backend offers the same API for tests.",
    ]),
    h.h2([h.Class("mb-4 mt-10 font-semibold")], ["Small by design"]),
    h.p([h.Class("mb-5")], [
      "This is an early proof of concept for small workspaces. Files are buffered in full and limited to 1 MiB by default. There are no permissions, symlinks, watchers, or shell commands. It stores code; it does not execute it.",
    ]),
    h.p([], [
      h.a([h.Href("https://github.com/anott03/fs-durable/tree/main/packages/fs-durable"), h.Class("underline")], ["Read the library documentation"]),
      " or learn more about ",
      h.a([h.Href("https://developers.cloudflare.com/durable-objects/"), h.Class("underline")], ["Durable Objects"]),
      " and ",
      h.a([h.Href("https://effect.website/"), h.Class("underline")], ["Effect"]),
      ".",
    ]),
  ]);

export const docsElement = (container: HTMLElement) =>
  Runtime.makeElement({ Model, init, update, view, container });
