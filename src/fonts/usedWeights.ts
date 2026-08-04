// Which brand-font cuts a spec's motion graphics actually ask for.
//
// `fontWeights` is author-declared, and every declared cut is base64-inlined into EVERY frame's
// raster (see bgTextures.buildFontFaceCss) — ~66KB of TTF becomes ~88KB of base64 on all 2000-odd
// frames. A cut nothing references is therefore not a tidiness problem, it is a per-frame tax, and
// an author has no way to see it. The build resolves the used set here instead of asking them.
//
// The bar is asymmetric: keeping a cut nothing uses costs render time, but dropping one something
// DOES use is a silent visual regression (the face falls back and the weight contrast quietly
// disappears). So this proves the set or declines to answer — any weight it cannot resolve
// statically sets `dynamic`, and a dynamic result means the caller keeps everything.

export interface FontWeightUsage {
  /** Weights referenced by a statically-readable `font-weight` (or an implied-bold element). */
  weights: Set<number>;
  /** A weight was set in a way that cannot be read statically — the set is not provable. */
  dynamic: boolean;
}

/** Elements the UA stylesheet renders bold. A graphic using <h1> with no font-weight still needs
 *  a bold cut, and nothing in the source says "700". */
const IMPLIED_BOLD = /<\s*(b|strong|h[1-6]|th)(\s|>|\/)/i;

/** The `font:` shorthand — matches the shorthand only, never `font-weight:` / `font-family:`
 *  (those have `-` where this needs `:`). It can both set and RESET weight, so it is treated as
 *  unreadable rather than parsed. */
const FONT_SHORTHAND = /\bfont\s*:/;

const NAMED: Record<string, number> = { normal: 400, bold: 700 };

/**
 * Scan one motion source (Tier-1 `.html` or Tier-2 `.js`) for the brand-font weights it uses.
 *
 * Works on `.js` procs because their markup lives in string literals, and the same regex sees
 * `font-weight:900` inside a quoted string. What it must NOT do is guess: a proc that builds
 * `'font-weight:' + w` or `font-weight:${w}` yields an unreadable value, which sets `dynamic`.
 */
export function scanFontWeights(raw: string): FontWeightUsage {
  const weights = new Set<number>();
  let dynamic = false;

  if (FONT_SHORTHAND.test(raw)) dynamic = true;
  if (IMPLIED_BOLD.test(raw)) weights.add(700);

  // Value runs to the first CSS/JS terminator. A concatenation like `'font-weight:' + w` therefore
  // captures an empty value (the quote ends it) and lands in the unreadable branch below.
  const re = /font-weight\s*:\s*([^;}"'`)\n]*)/gi;
  for (const m of raw.matchAll(re)) {
    const value = m[1].trim();
    if (/^\d+$/.test(value)) {
      const n = Number(value);
      // CSS clamps to 1..1000; anything else is a typo, not a cut worth staging.
      if (n >= 1 && n <= 1000) weights.add(n);
      else dynamic = true;
      continue;
    }
    const named = NAMED[value.toLowerCase()];
    if (named !== undefined) {
      weights.add(named);
      continue;
    }
    // `bolder` / `lighter` are relative to the inherited weight, and `var(--x)` / `${w}` / '' are
    // simply not readable here. All of them mean: cannot prove the set.
    dynamic = true;
  }

  return { weights, dynamic };
}

/** Merge per-source scans into one verdict for the whole spec. */
export function mergeFontWeightUsage(scans: FontWeightUsage[]): FontWeightUsage {
  const weights = new Set<number>();
  let dynamic = false;
  for (const s of scans) {
    for (const w of s.weights) weights.add(w);
    if (s.dynamic) dynamic = true;
  }
  return { weights, dynamic };
}

/**
 * Narrow the declared cut list to what is actually referenced.
 *
 * `captionWeight` is always kept: captions and text overlays are drawn by the native text path, not
 * by any motion source, so nothing in the scan can vouch for it — and with `fontFaces` non-empty
 * every face carries a `font-weight` descriptor, so a missing caption cut is a synthetic-bold miss
 * rather than a fallback.
 *
 * Returns the cuts to stage plus the ones dropped, so the caller can say what it did.
 */
export function narrowFontCuts(
  declared: number[],
  captionWeight: number,
  usage: FontWeightUsage,
): { keep: number[]; dropped: number[] } {
  // Unprovable set → stage everything. Silently shipping a lighter face is worse than the bytes.
  if (usage.dynamic) return { keep: declared, dropped: [] };
  const keep = declared.filter((w) => w === captionWeight || usage.weights.has(w));
  const dropped = declared.filter((w) => !keep.includes(w));
  return { keep, dropped };
}
