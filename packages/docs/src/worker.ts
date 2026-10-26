import type { DocsEnv } from "../alchemy.run.js";
import { isDemoPath } from "./demo/paths.js";

export default {
  async fetch(request: Request, env: DocsEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/demo") {
      if (request.method !== "GET") {
        return Response.json({ error: "Method not allowed" }, { status: 405, headers: { Allow: "GET" } });
      }
      const path = url.searchParams.get("path") ?? "/";
      if (!isDemoPath(path)) return Response.json({ error: "Invalid path" }, { status: 400 });
      try {
        return await env.DEMO.fetch(`https://demo.internal/api/demo?${new URLSearchParams({ path })}`);
      } catch (error) {
        console.error(JSON.stringify({ message: "Filesystem demo request failed", error: String(error) }));
        return Response.json({ error: "The filesystem demo is temporarily unavailable" }, {
          status: 503,
          headers: { "Cache-Control": "no-store" },
        });
      }
    }
    if (url.pathname.startsWith("/api/")) return Response.json({ error: "Not found" }, { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
