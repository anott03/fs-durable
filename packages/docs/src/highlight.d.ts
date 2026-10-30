declare module "*?highlight" {
  const highlighted: {
    readonly code: string;
    readonly lines: import("./tokens.js").HighlightedLines;
  };
  export default highlighted;
}
