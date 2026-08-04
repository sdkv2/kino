// The set of characters a spec can actually put on screen, used to subset the staged font cuts.
//
// Every staged cut is base64-inlined into EVERY frame's raster, and a full Latin cut of Inter is
// ~66KB. Subsetting to what the piece renders takes that to ~32KB — the single biggest lever on
// raster decode time, which is ~2/3 of the motion-raster cost.
//
// The danger is undershooting: a character outside the subset falls back down the font-family
// stack (to Helvetica/Arial inside the raster), so it renders in the wrong face rather than as
// tofu — visible, but quiet. So this deliberately over-collects.
//
// THE HARD PART is Tier-2 procs, which build markup at render time. `'0000' + n` puts digits on
// screen that appear nowhere as a literal, and `label.toUpperCase()` puts capitals on screen that
// appear nowhere in that case. Neither is statically knowable, so the floor below is not an
// optimisation target — it is the correctness margin.

/** ASCII printable. Procs generate numbers, separators and padded counters from arithmetic; this is
 *  the cheap way to be right about all of it. ~95 chars, and the fixed tables in a TTF dominate at
 *  that size anyway, so trimming it buys far less than it risks. */
const ASCII_FLOOR = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i));

// HTML entities are how a motion graphic writes a non-ASCII character without putting the raw byte
// in the file — `&#183;` renders a middot that appears NOWHERE in the source as that character. A
// raw-text scan misses it entirely and the glyph silently falls back to another face, so entities
// are decoded before collecting. (Caught by a PSNR check, not by looking: `&#183;` in two beats
// dropped U+00B7 out of the subset while everything still rendered.)
const NAMED_ENTITIES: Record<string, number> = {
  nbsp: 0xa0, iexcl: 0xa1, cent: 0xa2, pound: 0xa3, curren: 0xa4, yen: 0xa5, sect: 0xa7,
  uml: 0xa8, copy: 0xa9, ordf: 0xaa, laquo: 0xab, not: 0xac, reg: 0xae, macr: 0xaf,
  deg: 0xb0, plusmn: 0xb1, sup2: 0xb2, sup3: 0xb3, acute: 0xb4, micro: 0xb5, para: 0xb6,
  middot: 0xb7, cedil: 0xb8, sup1: 0xb9, ordm: 0xba, raquo: 0xbb, frac14: 0xbc, frac12: 0xbd,
  frac34: 0xbe, iquest: 0xbf, times: 0xd7, divide: 0xf7,
  ndash: 0x2013, mdash: 0x2014, lsquo: 0x2018, rsquo: 0x2019, sbquo: 0x201a, ldquo: 0x201c,
  rdquo: 0x201d, bdquo: 0x201e, dagger: 0x2020, Dagger: 0x2021, bull: 0x2022, hellip: 0x2026,
  prime: 0x2032, Prime: 0x2033, euro: 0x20ac, trade: 0x2122,
  larr: 0x2190, uarr: 0x2191, rarr: 0x2192, darr: 0x2193, harr: 0x2194,
  infin: 0x221e, ne: 0x2260, le: 0x2264, ge: 0x2265,
};

/** Append the characters any HTML entity in `src` resolves to. Additive — the original text is
 *  still scanned too, so `&amp;` contributing `&` costs nothing (it is in the ASCII floor). */
function entityChars(src: string): string {
  let out = "";
  for (const m of src.matchAll(/&(#x?[0-9a-f]+|[a-z][a-z0-9]{1,9});/gi)) {
    const body = m[1];
    let cp: number | undefined;
    if (body[0] === "#") {
      const n = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (Number.isFinite(n) && n > 0 && n <= 0x10ffff) cp = n;
    } else {
      cp = NAMED_ENTITIES[body];
    }
    // A named entity outside the table stays undecoded. It would fall back to another face rather
    // than render as tofu, and the table covers what motion graphics actually use.
    if (cp !== undefined) out += String.fromCodePoint(cp);
  }
  return out;
}

/** Characters that never need a glyph — collecting them just pads the `text=` query. */
function isRenderable(ch: string): boolean {
  const code = ch.codePointAt(0)!;
  if (code < 0x20 || code === 0x7f) return false; // controls
  if (ch === "‍" || ch === "﻿") return false; // ZWJ / BOM
  return true;
}

/**
 * Union the ASCII floor with every character appearing in the given sources.
 *
 * Callers pass the spec JSON, every motion source, and the brand file — all small, all cheap to
 * scan, and between them they carry every non-ASCII literal the piece can render (λ, ·, em dashes,
 * curly quotes). Sources are raw file text on purpose: a proc's markup lives in its string
 * literals, so scanning the source catches it without executing anything.
 */
export function collectCharset(sources: string[]): string {
  const set = new Set<string>(ASCII_FLOOR);
  for (const src of sources) {
    // Iterate by code point so astral characters survive as single units rather than lone surrogates.
    for (const ch of src) if (isRenderable(ch)) set.add(ch);
    for (const ch of entityChars(src)) if (isRenderable(ch)) set.add(ch);
  }
  // Sorted so the same content always yields the same string — the subset cache key depends on it.
  return [...set].sort().join("");
}

/** Stable short key for a charset, for the on-disk subset cache filename. */
export function charsetKey(charset: string): string {
  // FNV-1a over code points. Not cryptographic — it only has to separate one spec's subset from
  // another's in a filename, and a collision would serve a font missing a few glyphs, not corrupt.
  let h = 0x811c9dc5;
  for (let i = 0; i < charset.length; i++) {
    h ^= charset.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, "0").slice(0, 7);
}
