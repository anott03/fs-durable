function hasForbiddenCharacter(path: string): boolean {
  for (let index = 0; index < path.length; index++) {
    const code = path.charCodeAt(index);
    if (code < 0x20 || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

export function isDemoPath(path: string): boolean {
  return (
    path.length <= 512 &&
    path.startsWith("/") &&
    !hasForbiddenCharacter(path) &&
    (path === "/" ||
      path
        .slice(1)
        .split("/")
        .every((part) => part !== "" && part !== "." && part !== ".."))
  );
}

export function childPath(directory: string, name: string): string {
  return directory === "/" ? `/${name}` : `${directory}/${name}`;
}
