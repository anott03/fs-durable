export type ParsedPath =
  | { readonly valid: true; readonly parts: string[] }
  | { readonly valid: false; readonly message: string };

const encoder = new TextEncoder();

/** Lexical normalization, not POSIX traversal or a host filesystem path. */
export function segments(path: string): ParsedPath {
  if (!path.startsWith("/") || path.includes("\0") || path.length > 4096 || encoder.encode(path).length > 4096) {
    return { valid: false, message: "Expected an absolute path without NUL, at most 4096 UTF-8 bytes" };
  }
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return { valid: false, message: "Path escapes the virtual root" };
      parts.pop();
    } else {
      if (encoder.encode(part).length > 255) return { valid: false, message: "Name exceeds 255 UTF-8 bytes" };
      parts.push(part);
    }
  }
  return { valid: true, parts };
}
