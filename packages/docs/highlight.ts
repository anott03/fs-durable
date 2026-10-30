import { readFile } from "node:fs/promises";
import { codeToTokens, type BundledLanguage, type BundledTheme } from "shiki";
import type { Plugin } from "vite";
import { toHighlightedLines } from "./src/tokens.js";

const query = "?highlight";

export function highlight(options: { readonly lang: BundledLanguage; readonly theme: BundledTheme }): Plugin {
  return {
    name: "highlight",
    enforce: "pre",
    async load(id) {
      if (!id.endsWith(query)) return null;
      const file = id.slice(0, -query.length);
      this.addWatchFile(file);
      const code = (await readFile(file, "utf8")).trimEnd();
      const { tokens } = await codeToTokens(code, options);
      return `export default ${JSON.stringify({ code, lines: toHighlightedLines(tokens) })};`;
    },
  };
}
