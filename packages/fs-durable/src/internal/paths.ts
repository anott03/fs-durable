export type ParsedPath =
  | { readonly valid: true; readonly parts: string[] }
  | { readonly valid: false; readonly message: string };

const MAX_PATH_BYTES = 4096;
const MAX_NAME_BYTES = 255;

function utf8Length(text: string): number {
  let bytes = text.length;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) continue;
    if (code < 0x800) {
      bytes += 1;
      continue;
    }
    bytes += 2;
    const next = text.charCodeAt(index + 1);
    if (code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) index++;
  }
  return bytes;
}

const exceeds = (text: string, limit: number): boolean =>
  text.length > limit || (text.length * 3 > limit && utf8Length(text) > limit);

/** Lexical normalization, not POSIX traversal or a host filesystem path. */
export function segments(path: string): ParsedPath {
  if (!path.startsWith("/") || path.includes("\0") || exceeds(path, MAX_PATH_BYTES)) {
    return { valid: false, message: "Expected an absolute path without NUL, at most 4096 UTF-8 bytes" };
  }
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return { valid: false, message: "Path escapes the virtual root" };
      parts.pop();
    } else {
      if (exceeds(part, MAX_NAME_BYTES)) return { valid: false, message: "Name exceeds 255 UTF-8 bytes" };
      parts.push(part);
    }
  }
  return { valid: true, parts };
}
