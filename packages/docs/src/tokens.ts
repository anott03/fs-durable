import type { CSSProperties } from "react";
import { getTokenStyleObject, type ThemedToken } from "shiki/core";

export type HighlightedLines = ReadonlyArray<ReadonlyArray<{ readonly content: string; readonly style: CSSProperties }>>;

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

export function toHighlightedLines(tokens: ReadonlyArray<ReadonlyArray<ThemedToken>>): HighlightedLines {
  return tokens.map((line) =>
    line.map((token) => {
      const style: Record<string, string> = {};
      for (const [name, value] of Object.entries(getTokenStyleObject(token))) {
        if (isCssPropertyName(name)) style[cssPropertyNames[name]] = value;
      }
      return { content: token.content, style };
    }),
  );
}
