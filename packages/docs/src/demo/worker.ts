import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect-filesystem";
import { makeDurableObject } from "fs-durable/durable-object";
import type { DemoEnv } from "../../alchemy.run.js";
import { isDemoPath } from "./paths.js";
import type { DemoNode } from "./protocol.js";
import { seedFiles, seedVersion } from "./seed.js";

export class DemoFilesystem extends DurableObject {
  readonly #fs = Effect.runSync(makeDurableObject(this.ctx.storage, { maxFileBytes: 16_384 }));

  constructor(ctx: DurableObjectState, env: DemoEnv) {
    super(ctx, env);
    this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      sql.exec("CREATE TABLE IF NOT EXISTS docs_demo_seed (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)");
      const version = sql.exec<{ version: number }>("SELECT version FROM docs_demo_seed WHERE id = 1").toArray()[0]?.version;
      if (version === seedVersion) return;
      if (version !== undefined && version > seedVersion) throw new Error("Unsupported demo seed version");

      Effect.runSync(Effect.gen({ self: this }, function* () {
        const entries = yield* this.#fs.readDirectory("/");
        for (const entry of entries) {
          yield* this.#fs.remove(`/${entry.name}`, { recursive: true });
        }
        for (const file of seedFiles) {
          const parent = file.path.slice(0, file.path.lastIndexOf("/")) || "/";
          yield* this.#fs.makeDirectory(parent, { recursive: true });
          yield* this.#fs.writeFileString(file.path, file.content);
        }
        yield* this.#fs.makeDirectory("/empty");
      }));
      sql.exec("INSERT OR REPLACE INTO docs_demo_seed (id, version) VALUES (1, ?)", seedVersion);
    });
  }

  async browse(path: string): Promise<DemoNode | null> {
    if (!isDemoPath(path)) throw new RangeError("Invalid demo path");
    return Effect.runSync(Effect.gen({ self: this }, function* () {
      const stat = yield* this.#fs.stat(path);
      if (stat.type === "directory") {
        const entries = yield* this.#fs.readDirectory(path);
        return { ...stat, type: "directory" as const, path, entries };
      }
      const content = yield* this.#fs.readFileString(path);
      return { ...stat, type: "file" as const, path, content };
    }).pipe(Effect.match({
      onSuccess: (node) => node,
      onFailure: (error) => {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
        throw error;
      },
    })));
  }
}

export default {
  async fetch(request: Request, env: DemoEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/api/demo") return new Response("Not found", { status: 404 });
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
    const path = url.searchParams.get("path") ?? "/";
    if (!isDemoPath(path)) return Response.json({ error: "Invalid path" }, { status: 400 });

    const node = await env.FILESYSTEM.getByName("docs-demo").browse(path);
    if (node === null) return Response.json({ error: "Path not found" }, { status: 404 });
    return Response.json(node, { headers: { "Cache-Control": "public, max-age=30" } });
  },
};
