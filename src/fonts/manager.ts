import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { download } from "../media/net.js";
import { lookupFont } from "./registry.js";

// On-demand font manager. Resolves a curated font name (see registry.ts) to a TTF on disk, fetching
// it once from Google Fonts into a global, cross-project cache (~/.kino/fonts/). The download is
// offline-safe (returns null on any failure so callers fall back to a system font). The fetch leans
// on two tricks worth knowing: (1) the LEGACY Google Fonts CSS API (fonts.googleapis.com/css?...)
// served TrueType to old user-agents, so we spoof an old-Safari UA to get a real .ttf for any family
// without hardcoding repo URLs; (2) the requested WEIGHT (e.g. 700) is a magic number that comes from
// the registry entry (def.weight) — it selects which numeric font weight the CSS API returns.

// Global, cross-project cache so a font is downloaded once for all videos.
export function fontCacheDir(): string {
  return join(homedir(), ".kino", "fonts");
}
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
/** Cache path for a cut. The primary (registry) weight keeps its unsuffixed name so an existing
 *  cache stays valid and nothing re-downloads; an explicit extra weight gets its own file. */
export function fontPath(name: string, weight?: number): string {
  const suffix = weight == null ? "" : `-${weight}`;
  return join(fontCacheDir(), `${slug(name)}${suffix}.ttf`);
}

// Download a curated font's TTF on demand (cached). Offline-safe: returns null on any failure so
// the caller can fall back to a system font. Uses the legacy Google Fonts CSS API, which serves
// TTF to old user-agents — works for any family without hardcoding repo paths.
export async function ensureFont(name: string, weight?: number): Promise<string | null> {
  const def = lookupFont(name);
  if (!def) return null;
  // `weight` omitted (or equal to the registry cut) resolves the primary file, unsuffixed.
  const cut = weight == null || weight === def.weight ? undefined : weight;
  const out = fontPath(def.name, cut);
  if (existsSync(out)) return out;
  try {
    const url = `https://fonts.googleapis.com/css?family=${encodeURIComponent(def.family)}:${cut ?? def.weight}`;
    // Old-Safari UA makes the legacy API serve real TrueType (modern UAs get woff2; old IE gets EOT).
    const ua = "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; en-us) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1";
    const res = await fetch(url, { headers: { "user-agent": ua } });
    if (!res.ok) return null;
    const css = await res.text();
    // The legacy API + old UA serves TrueType; the src url has no .ttf extension, so match any url().
    const m = css.match(/url\((https?:\/\/[^)]+)\)/);
    if (!m) return null;
    mkdirSync(fontCacheDir(), { recursive: true });
    await download(m[1], out);
    return out;
  } catch {
    return null;
  }
}
