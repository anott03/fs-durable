import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";
import { layerDurableObject } from "../../src/durable-object.js";
import { VirtualFileSystem } from "../../src/index.js";

export class Workspace extends DurableObject<Env> {
  private readonly fs: VirtualFileSystem;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Schema initialization is entirely synchronous. No network I/O or yield here.
    this.fs = Effect.runSync(Effect.provide(VirtualFileSystem, layerDurableObject(this.ctx.storage)));
  }

  async write(path: string, text: string): Promise<void> {
    await Effect.runPromise(this.fs.writeFileString(path, text));
  }

  async read(path: string): Promise<string> {
    return Effect.runPromise(this.fs.readFileString(path));
  }
}

export default {
  // Deliberately no public filesystem endpoint. Access workspaces through a
  // trusted binding, or add application-specific authentication and routing.
  fetch(): Response {
    return new Response("Workspace filesystem example; use the WORKSPACES binding.");
  },
} satisfies ExportedHandler<Env>;
