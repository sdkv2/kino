// Dotted-path set for batch variants: "segments.0.text" → mutate an object in place.
// Only replaces existing leaves / array indices — does not create missing paths.

/** Walk `a.b.0.c` and set the leaf. Throws if any hop is missing. */
export function applySet(target: unknown, path: string, value: unknown): void {
  const parts = path.split(".").filter(Boolean);
  if (!parts.length) throw new Error("empty set path");
  let cur: unknown = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const next = indexOrKey(cur, key);
    if (next === undefined) throw new Error(`set path not found: ${parts.slice(0, i + 1).join(".")}`);
    cur = next;
  }
  const leaf = parts[parts.length - 1]!;
  if (Array.isArray(cur)) {
    const idx = Number(leaf);
    if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) {
      throw new Error(`set path array index out of range: ${path}`);
    }
    cur[idx] = value;
    return;
  }
  if (cur && typeof cur === "object") {
    const obj = cur as Record<string, unknown>;
    if (!(leaf in obj)) throw new Error(`set path not found: ${path}`);
    obj[leaf] = value;
    return;
  }
  throw new Error(`set path not found: ${path}`);
}

function indexOrKey(cur: unknown, key: string): unknown {
  if (Array.isArray(cur)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return undefined;
    return cur[idx];
  }
  if (cur && typeof cur === "object") return (cur as Record<string, unknown>)[key];
  return undefined;
}

export function applySets(target: unknown, sets: Record<string, unknown>): void {
  for (const [path, value] of Object.entries(sets)) applySet(target, path, value);
}
