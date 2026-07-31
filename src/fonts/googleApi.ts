// Optional Google Fonts Developer API client — the full ~1800-family catalog.
//
// OPTIONAL BY DESIGN. Everything kino does with fonts works without this: manager.ts downloads any
// family by exact name through the keyless legacy CSS endpoint. What a key buys is KNOWLEDGE about
// a family before we ask for it — its real available weights (so a caption cut is picked rather
// than guessed), its canonical casing, and a searchable list. So every entry point here degrades to
// `null` when GOOGLE_FONTS_API_KEY is unset or the fetch fails, and callers must treat that as
// "no catalog" rather than an error.
//
// The catalog is ~1MB of JSON and changes on the order of weeks, so it is fetched once and cached
// next to the font files with a 7-day TTL. A stale cache beats no cache: if a refresh fails (or the
// key is later removed) the last good copy is still served, since a month-old family list is far
// more useful than nothing when the alternative is guessing.
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";

export interface CatalogFont {
  family: string; // canonical casing, e.g. "Playfair Display"
  category: string; // sans-serif | serif | display | handwriting | monospace
  weights: number[]; // upright cuts only, ascending
}

const CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function googleFontsKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const k = env.GOOGLE_FONTS_API_KEY?.trim();
  return k ? k : undefined;
}

export function catalogPath(): string {
  return join(homedir(), ".kino", "fonts", "catalog.json");
}

/** Normalised key for matching a user-typed name against a family: case and punctuation are the
 *  two things authors get wrong ("ibm plex mono", "Plus-Jakarta-Sans"), and neither is meaningful. */
export function normalizeFamily(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Google's `variants` list → upright numeric weights. "regular" is 400; italics are dropped
 *  (kino stages one upright face per cut — there is no italic axis in the theme). */
export function parseVariants(variants: string[]): number[] {
  const out = new Set<number>();
  for (const v of variants) {
    if (v.endsWith("italic")) continue; // "italic", "700italic"
    if (v === "regular") {
      out.add(400);
      continue;
    }
    const n = Number(v);
    if (Number.isInteger(n) && n >= 100 && n <= 900) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

function readCached(path: string, maxAgeMs: number | null): CatalogFont[] | null {
  if (!existsSync(path)) return null;
  try {
    if (maxAgeMs != null && Date.now() - statSync(path).mtimeMs >= maxAgeMs) return null;
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed) && parsed.length ? (parsed as CatalogFont[]) : null;
  } catch {
    return null;
  }
}

/** The family catalog, or null when there is neither a usable cache nor a key to fetch one with.
 *  Never throws — a font resolve that cannot reach the catalog falls back to the keyless path. */
export async function loadCatalog(opts: { refresh?: boolean } = {}): Promise<CatalogFont[] | null> {
  const path = catalogPath();
  if (!opts.refresh) {
    const fresh = readCached(path, CATALOG_TTL_MS);
    if (fresh) return fresh;
  }
  const key = googleFontsKey();
  // No key: a catalog fetched while one WAS set stays useful — serve it at any age.
  if (!key) return readCached(path, null);
  try {
    const url = `https://www.googleapis.com/webfonts/v1/webfonts?sort=popularity&key=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    if (!res.ok) return readCached(path, null);
    const body = (await res.json()) as { items?: Array<{ family?: string; category?: string; variants?: string[] }> };
    const items = body.items ?? [];
    if (!items.length) return readCached(path, null);
    const catalog: CatalogFont[] = items
      .filter((i): i is { family: string; category?: string; variants?: string[] } => !!i.family)
      .map((i) => ({ family: i.family, category: i.category ?? "", weights: parseVariants(i.variants ?? []) }));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(catalog));
    return catalog;
  } catch {
    return readCached(path, null);
  }
}

/** Exact family match, ignoring case and punctuation. */
export function matchFamily(catalog: CatalogFont[], name: string): CatalogFont | undefined {
  const want = normalizeFamily(name);
  return catalog.find((f) => normalizeFamily(f.family) === want);
}

/** Closest family name to a miss, for a "did you mean" on an unresolvable font. Prefix beats
 *  substring, and the shortest candidate wins — "space" should suggest "Space Mono", not
 *  "Space Grotesk Variable"-style long tails. Returns undefined when nothing is close. */
export function suggestFamily(catalog: CatalogFont[], name: string): string | undefined {
  const want = normalizeFamily(name);
  if (want.length < 3) return undefined;
  let prefix: CatalogFont | undefined;
  let contains: CatalogFont | undefined;
  for (const f of catalog) {
    const n = normalizeFamily(f.family);
    if (n.startsWith(want)) {
      if (!prefix || f.family.length < prefix.family.length) prefix = f;
    } else if (n.includes(want) || want.includes(n)) {
      if (!contains || f.family.length < contains.family.length) contains = f;
    }
  }
  return (prefix ?? contains)?.family;
}

/** Free-text search over family names and categories, popularity-ordered (the catalog's own order).
 *  Every whitespace-separated term must match, so "condensed display" narrows rather than widens. */
export function searchCatalog(catalog: CatalogFont[], query: string, limit = 30): CatalogFont[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return catalog.slice(0, limit);
  const out: CatalogFont[] = [];
  for (const f of catalog) {
    const hay = `${f.family} ${f.category}`.toLowerCase();
    if (terms.every((t) => hay.includes(t))) out.push(f);
    if (out.length >= limit) break;
  }
  return out;
}
