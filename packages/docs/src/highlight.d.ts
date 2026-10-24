declare module "*?highlight" {
  const highlighted: {
    readonly code: string;
    readonly lines: ReadonlyArray<ReadonlyArray<{ readonly content: string; readonly style: import("react").CSSProperties }>>;
  };
  export default highlighted;
}
