/** Resolve `relative` against the folder containing `fromFile` (vault-relative). */
export function resolveRelative(fromFile: string, relative: string): string {
  const baseParts = fromFile.split("/").slice(0, -1);
  const parts = relative.replace(/\\/g, "/").split("/");
  const out = [...baseParts];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
    } else {
      out.push(part);
    }
  }
  return out.join("/");
}

/** Relative path from the folder of `fromFile` to `toPath` (both vault-relative). */
export function relativeTo(fromFile: string, toPath: string): string {
  const fromParts = fromFile.split("/").slice(0, -1);
  const toParts = toPath.split("/");
  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length - 1 &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }
  const ups = fromParts.length - common;
  const rel = [...Array(ups).fill(".."), ...toParts.slice(common)];
  return rel.join("/") || toPath;
}
