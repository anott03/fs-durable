import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./examples/durable-object/wrangler.jsonc" } })],
  test: { include: ["test/**/*.workers.test.ts"] },
});
