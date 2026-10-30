import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { toHighlightedLines, type HighlightedLines } from "./tokens.js";

const theme = "github-dark-default";

const languages = {
  ".ts": "typescript",
  ".md": "markdown",
  ".json": "json",
} as const;

const highlighter = createHighlighterCore({
  themes: [import("shiki/themes/github-dark-default.mjs")],
  langs: [
    import("shiki/langs/typescript.mjs"),
    import("shiki/langs/markdown.mjs"),
    import("shiki/langs/json.mjs"),
  ],
  engine: createJavaScriptRegexEngine(),
});

function languageFor(path: string) {
  for (const [extension, language] of Object.entries(languages)) {
    if (path.endsWith(extension)) return language;
  }
  return null;
}

export async function highlightFile(path: string, content: string): Promise<HighlightedLines | null> {
  const lang = languageFor(path);
  if (lang === null) return null;
  const { tokens } = (await highlighter).codeToTokens(content, { lang, theme });
  return toHighlightedLines(tokens);
}
