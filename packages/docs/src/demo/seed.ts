export const seedVersion = 1;

export const seedFiles = [
  {
    path: "/README.md",
    content: `# A durable workspace

These files live in a real SQLite-backed Durable Object.
The docs Worker reads them through a private service binding.

Open the src and notes directories to explore the workspace.
This demo is read-only. The files persist when the object is evicted.
`,
  },
  {
    path: "/src/workspace.ts",
    content: `import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";
import { makeDurableObject } from "fs-durable/durable-object";

export class Workspace extends DurableObject {
  private readonly fs = Effect.runSync(
    makeDurableObject(this.ctx.storage),
  );

  async read(path: string): Promise<string> {
    return Effect.runPromise(this.fs.readFileString(path));
  }
}
`,
  },
  {
    path: "/src/greetings/hello.ts",
    content: `export function hello(name: string): string {
  return "Hello, " + name + "!";
}
`,
  },
  {
    path: "/notes/storage.md",
    content: `# Where are the files?

fs-durable keeps paths and metadata in fs_durable_nodes.
File bytes live in fs_durable_contents in the same SQLite database.

Each filesystem write runs inside storage.transactionSync().
Separate filesystem calls do not share a transaction.
`,
  },
  {
    path: "/notes/paths.md",
    content: `# Paths

Paths are absolute and case-sensitive.

/src/workspace.ts and /src/Workspace.ts are different paths.
Directories can contain files and other directories.
This workspace has no symlinks or file permissions.
`,
  },
  {
    path: "/workspace.json",
    content: `${JSON.stringify({ name: "docs-demo", backend: "durable-object", readOnly: true, directories: ["/src", "/notes", "/empty"] }, null, 2)}\n`,
  },
];
