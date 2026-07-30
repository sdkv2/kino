import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { download } from "../media/net.js";
import { lookupFont } from "./registry.js";
import { loadCatalog, matchFamily, suggestFamily } from "./googleApi.js";

// On-demand font manager. Resolves a font NAME (anything an author may put in brand.font) to a TTF
// on disk, fetching it once from Google Fonts into a global, cross-project cache (~/.kino/fonts/).
// Every download is offline-safe (returns null on any failure so callers fall back to a system font).
//
// ANY GOOGLE FONT, NO KEY REQUIRED. The registry (registry.ts) is a curated shortlist with
// hand-tuned caption weights and descriptions — it is a recommendation surface, NOT the set of
// usable fonts. A name that is not in it is treated as a literal Google Fonts family and downloaded
// the same way. The fetch leans on the LEGACY Google Fonts CSS API (fonts.googleapis.com/css?...),
// which serves TrueType to old user-agents, so we spoof an old-Safari UA to get a real .ttf for any
// family without hardcoding repo URLs.
//
// The optional Developer API (googleApi.ts, GOOGLE_FONTS_API_KEY) only sharpens the resolve: it
// corrects casing and reads a family's REAL available weights so the caption cut is chosen rather
// than assumed. Without it the caption cut is DEFAULT_FONT_WEIGHT and a family that lacks that cut
// falls back to its regular face (see ensureFont).

/** Caption weight for a family we know nothing about. Bold: captions want heft, and 700 is the cut
 *  Google Fonts families are most likely to actually ship after 400. */
export const DEFAULT_FONT_WEIGHT = 700;

/** Heaviest cut worth auto-selecting when the catalog tells us what exists. The curated weights were
 *  hand-picked in this band — 900 reads as a different typeface in a lot of families, so it is
 *  opt-in through `fontWeights` rather than something a bare family name lands on. */
const CAPTION_WEIGHT_CEILING = 800;

const GENERIC_FAMILIES = new Set(["sans-serif", "serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "inherit", "initial"]);

/** Whether a `font` value is a raw CSS font stack rather than a family to download. A comma means
 *  the author wrote a fallback chain (DEFAULT_BRAND.font is one); a bare generic keyword is a system
 *  face. Both pass through to CSS untouched — asking Google Fonts for "sans-serif" is a 404. */
export function isCssFontStack(name: string): boolean {
  const n = name.trim();
  return n.includes(",") || GENERIC_FAMILIES.has(n.toLowerCase());
}

export interface ResolvedFont {
  /** Google Fonts family name — canonical casing when the catalog could confirm it. */
  family: string;
  /** The cut to stage for captions. */
  weight: number;
  /** Every upright cut the family ships, when the catalog resolved it; null when unknown. */
  available: number[] | null;
  /** True when this came from the curated registry (hand-tuned weight + description). */
  curated: boolean;
  /** Nearest catalog family when the name matched nothing — for a "did you mean" on failure. */
  suggestion?: string;
}

/** Heaviest available cut at or below the ceiling; the lightest available if a family only ships
 *  heavier (a 900-only display face still needs to resolve to something). */
export function pickCaptionWeight(weights: number[]): number {
  if (!weights.length) return DEFAULT_FONT_WEIGHT;
  const under = weights.filter((w) => w <= CAPTION_WEIGHT_CEILING);
  return under.length ? Math.max(...under) : Math.min(...weights);
}

/**
 * Resolve a `brand.font` / `--font` value to a downloadable family + caption cut.
 *
 * Returns null for a raw CSS stack — the caller passes the string through to CSS and stages nothing.
 * Never throws and never returns null for a plausible family name: an unknown name still resolves
 * (optimistically, at DEFAULT_FONT_WEIGHT) so the download itself is what decides whether it exists.
 */
export async function resolveFont(name: string): Promise<ResolvedFont | null> {
  const raw = name.trim();
  if (!raw || isCssFontStack(raw)) return null;
  // Curated names keep their hand-tuned caption weight — that tuning is the point of the shortlist,
  // and it beats anything derived from the catalog's weight list.
  const def = lookupFont(raw);
  if (def) return { family: def.family, weight: def.weight, available: null, curated: true };
  const catalog = await loadCatalog();
  const hit = catalog ? matchFamily(catalog, raw) : undefined;
  if (hit) return { family: hit.family, weight: pickCaptionWeight(hit.weights), available: hit.weights, curated: false };
  return {
    family: raw,
    weight: DEFAULT_FONT_WEIGHT,
    available: null,
    curated: false,
    suggestion: catalog ? suggestFamily(catalog, raw) : undefined,
  };
}

// Global, cross-project cache so a font is downloaded once for all videos.
export function fontCacheDir(): string {
  return join(homedir(), ".kino", "fonts");
}
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** Cache path for one cut of one family. */
export function fontPath(family: string, weight: number): string {
  return join(fontCacheDir(), `${slug(family)}-${weight}.ttf`);
}

/** Pre-3.2 cache name: curated fonts stored their primary cut unsuffixed. Read-only — nothing writes
 *  here any more — so an existing cache does not re-download the whole shortlist on upgrade. */
function legacyFontPath(family: string): string {
  return join(fontCacheDir(), `${slug(family)}.ttf`);
}

/** The cached TTF for a cut if one is already on disk (either name), else null. Read-only probe —
 *  `kino fonts` reports cache status with it, and ensureFont uses it before reaching the network. */
export function cachedFontPath(family: string, weight: number): string | null {
  const out = fontPath(family, weight);
  if (existsSync(out)) return out;
  if (lookupFont(family)?.weight === weight) {
    const legacy = legacyFontPath(family);
    if (existsSync(legacy)) return legacy;
  }
  return null;
}

/** The URL the legacy CSS API hands out for a family (at `weight`, or its regular face when null). */
async function fontFileUrl(family: string, weight: number | null): Promise<string | null> {
  try {
    const spec = weight == null ? family : `${family}:${weight}`;
    const url = `https://fonts.googleapis.com/css?family=${encodeURIComponent(spec)}`;
    // Old-Safari UA makes the legacy API serve real TrueType (modern UAs get woff2; old IE gets EOT).
    const ua = "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; en-us) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1";
    const res = await fetch(url, { headers: { "user-agent": ua } });
    if (!res.ok) return null;
    const css = await res.text();
    // The legacy API + old UA serves TrueType; the src url has no .ttf extension, so match any url().
    return css.match(/url\((https?:\/\/[^)]+)\)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Download one cut of one family on demand (cached). Offline-safe: returns null on any failure so
 * the caller can fall back to a system font.
 *
 * `exact: false` (the default) retries without the weight when that cut does not exist, so the
 * guessed DEFAULT_FONT_WEIGHT never costs a keyless author their font — a family that ships only
 * 400 still resolves, to its regular face. The bytes are then cached under the REQUESTED weight,
 * because that is the name the caller will ask for again; the staged face is simply lighter than
 * asked. Explicit `fontWeights` cuts pass `exact: true`, since silently staging a 400 as
 * `font-800.ttf` would make a motion page's `font-weight: 800` a lie rather than a miss.
 */
export async function ensureFont(family: string, weight: number, opts: { exact?: boolean } = {}): Promise<string | null> {
  const cached = cachedFontPath(family, weight);
  if (cached) return cached;
  const out = fontPath(family, weight);
  const src = (await fontFileUrl(family, weight)) ?? (opts.exact ? null : await fontFileUrl(family, null));
  if (!src) return null;
  try {
    mkdirSync(fontCacheDir(), { recursive: true });
    await download(src, out);
    return out;
  } catch {
    return null;
  }
}

/** Resolve + download in one step: the TTF for a font name's caption cut, or null. */
export async function ensureResolvedFont(name: string): Promise<{ font: ResolvedFont; path: string } | null> {
  const font = await resolveFont(name);
  if (!font) return null;
  const path = await ensureFont(font.family, font.weight);
  return path ? { font, path } : null;
}
