/** Lexical normalization, not POSIX traversal or a host filesystem path. */
export function segments(path: string): string[] {
  if (!path.startsWith("/") || path.includes("\0") || path.length > 4096 || new TextEncoder().encode(path).length > 4096) {
    throw new Error("Expected an absolute path without NUL, at most 4096 UTF-8 bytes");
  }
  const result: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (result.length === 0) throw new Error("Path escapes the virtual root");
      result.pop();
    } else {
      if (new TextEncoder().encode(part).length > 255) throw new Error("Name exceeds 255 UTF-8 bytes");
      result.push(part);
    }
  }
  return result;
}
