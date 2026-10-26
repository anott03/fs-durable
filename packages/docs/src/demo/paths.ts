export function isDemoPath(path: string): boolean {
  return path.length <= 512
    && path.startsWith("/")
    && [...path].every((character) => character >= " " && character !== "\u007f" && character !== "\\")
    && (path === "/" || path.slice(1).split("/").every((part) => part !== "" && part !== "." && part !== ".."));
}

export function childPath(directory: string, name: string): string {
  return directory === "/" ? `/${name}` : `${directory}/${name}`;
}
