import { readFile } from "node:fs/promises";
import { codeToTokens, getTokenStyleObject, type BundledLanguage, type BundledTheme } from "shiki";
import type { Plugin } from "vite";

const query = "?highlight";

const cssPropertyNames = {
  color: "color",
  "background-color": "backgroundColor",
  "font-style": "fontStyle",
  "font-weight": "fontWeight",
  "text-decoration": "textDecoration",
} as const;

function isCssPropertyName(name: string): name is keyof typeof cssPropertyNames {
  return name in cssPropertyNames;
}

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
      const lines = tokens.map((line) =>
        line.map((token) => {
          const style: Record<string, string> = {};
          for (const [name, value] of Object.entries(getTokenStyleObject(token))) {
            if (isCssPropertyName(name)) style[cssPropertyNames[name]] = value;
          }
          return { content: token.content, style };
        }),
      );
      return `export default ${JSON.stringify({ code, lines })};`;
    },
  };
}
