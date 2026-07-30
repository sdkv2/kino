// Glyph outlines from a TrueType font: text → SVG path data.
//
// Everything else kino can do to text treats it AS text. `<clipPath>` paints through letterforms,
// `stroke-dasharray` draws them on, `<tspan>` colours them one by one — but none of that gives you the
// letterform as geometry, so `data-kino-morph-stops` (which interpolates a `d` attribute) cannot touch
// a glyph. Morphing a ribbon into the numeral "1", or one word into another, needs real outlines.
//
// Hand-rolled rather than a dependency, for the same reasons the path parser in pathMorph.ts is: the
// whole job is ~10 tables' worth of big-endian struct reading, it must be deterministic (it feeds a
// render), and every font in the curated registry is TrueType — verified: Inter, Anton, Bebas Neue and
// the rest all ship `glyf`/`loca` with no `CFF ` table, so PostScript outlines never arise.
//
// Coordinate space: font units with the Y axis FLIPPED, so the output is SVG-native — x increases
// right, y increases down, and the baseline is y=0. A cap-height point therefore has negative y, which
// is why textOutlines reports ascender/descender: they are what a caller needs to write a viewBox.
//
// Pure: Buffer in, strings out. No fs, no network, no DOM.

/** A parsed font, holding only what outline extraction needs. */
export interface ParsedFont {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  numGlyphs: number;
  /** Glyph index for a code point, or 0 (.notdef) when the font has no mapping. */
  glyphId(codePoint: number): number;
  /** Advance width in font units. */
  advance(glyphId: number): number;
  /** SVG path data in Y-flipped font units, baseline at 0. Empty string for a blank glyph. */
  outline(glyphId: number): string;
}

interface Tables {
  [tag: string]: { offset: number; length: number };
}

function readTables(buf: Buffer): Tables {
  if (buf.length < 12) throw new Error("not a font: file is too short for a table directory");
  const tag = buf.readUInt32BE(0);
  // 0x00010000 = TrueType outlines; "true"/"ttcf" also appear in the wild. A "OTTO" tag means CFF
  // (PostScript) outlines, which this parser deliberately does not implement — say so rather than
  // producing nonsense from a table that isn't there.
  if (tag === 0x4f54544f) {
    throw new Error("this font has CFF/PostScript outlines (OTTO); only TrueType glyf outlines are supported");
  }
  const numTables = buf.readUInt16BE(4);
  const out: Tables = {};
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (rec + 16 > buf.length) break;
    const name = buf.toString("ascii", rec, rec + 4).replace(/\0+$/, "");
    out[name] = { offset: buf.readUInt32BE(rec + 8), length: buf.readUInt32BE(rec + 12) };
  }
  return out;
}

/** cmap subtable → code point lookup. Formats 4 (BMP) and 12 (full range) cover every Google Fonts TTF. */
function readCmap(buf: Buffer, base: number): (cp: number) => number {
  const numSub = buf.readUInt16BE(base + 2);
  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < numSub; i++) {
    const rec = base + 4 + i * 8;
    const platform = buf.readUInt16BE(rec);
    const encoding = buf.readUInt16BE(rec + 2);
    const offset = buf.readUInt32BE(rec + 4);
    // Prefer full-repertoire Unicode, then BMP Unicode, then anything.
    const score =
      platform === 3 && encoding === 10 ? 4 : platform === 0 && encoding >= 4 ? 3 : platform === 3 && encoding === 1 ? 2 : platform === 0 ? 1 : 0;
    if (score > bestScore) {
      bestScore = score;
      best = base + offset;
    }
  }
  if (best < 0) return () => 0;
  const format = buf.readUInt16BE(best);

  if (format === 4) {
    const segX2 = buf.readUInt16BE(best + 6);
    const seg = segX2 / 2;
    const endAt = best + 14;
    const startAt = endAt + segX2 + 2;
    const deltaAt = startAt + segX2;
    const rangeAt = deltaAt + segX2;
    return (cp: number): number => {
      if (cp > 0xffff) return 0;
      for (let s = 0; s < seg; s++) {
        const end = buf.readUInt16BE(endAt + s * 2);
        if (cp > end) continue;
        const start = buf.readUInt16BE(startAt + s * 2);
        if (cp < start) return 0;
        const delta = buf.readInt16BE(deltaAt + s * 2);
        const rangeOff = buf.readUInt16BE(rangeAt + s * 2);
        if (rangeOff === 0) return (cp + delta) & 0xffff;
        // rangeOffset is relative to its OWN slot, which is what makes this table awkward.
        const gAt = rangeAt + s * 2 + rangeOff + (cp - start) * 2;
        if (gAt + 2 > buf.length) return 0;
        const g = buf.readUInt16BE(gAt);
        return g === 0 ? 0 : (g + delta) & 0xffff;
      }
      return 0;
    };
  }

  if (format === 12) {
    const nGroups = buf.readUInt32BE(best + 12);
    return (cp: number): number => {
      for (let g = 0; g < nGroups; g++) {
        const rec = best + 16 + g * 12;
        const start = buf.readUInt32BE(rec);
        if (cp < start) return 0;
        const end = buf.readUInt32BE(rec + 4);
        if (cp > end) continue;
        return buf.readUInt32BE(rec + 8) + (cp - start);
      }
      return 0;
    };
  }

  return () => 0;
}

const ON_CURVE = 0x01;
const X_SHORT = 0x02;
const Y_SHORT = 0x04;
const REPEAT = 0x08;
const SAME_X = 0x10; // when X_SHORT: sign bit; else: delta is zero
const SAME_Y = 0x20;

interface Pt {
  x: number;
  y: number;
  on: boolean;
}

const n3 = (v: number): string => {
  const r = Math.round(v * 1e3) / 1e3;
  return Object.is(r, -0) ? "0" : String(r);
};

/**
 * One contour of quadratic B-spline points → path commands.
 *
 * TrueType stores curves as on-curve anchors with off-curve controls between them, and allows two
 * consecutive off-curve points, where an on-curve anchor is IMPLIED at their midpoint. Missing that
 * rule is what turns a smooth bowl into a polygon, so it is handled explicitly below.
 */
function contourPath(pts: Pt[]): string {
  if (!pts.length) return "";
  // Rotate so the contour starts on an anchor. An all-off-curve contour (rare, but legal) gets a
  // synthetic start at the midpoint of the last and first control points.
  let startIdx = pts.findIndex((p) => p.on);
  let start: Pt;
  if (startIdx < 0) {
    const a = pts[pts.length - 1];
    const b = pts[0];
    start = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true };
    startIdx = 0;
  } else {
    start = pts[startIdx];
    startIdx += 1;
  }

  let d = `M${n3(start.x)} ${n3(-start.y)}`;
  const n = pts.length;
  let ctrl: Pt | null = null;
  for (let k = 0; k < n; k++) {
    const p = pts[(startIdx + k) % n];
    if (p.on) {
      d += ctrl
        ? `Q${n3(ctrl.x)} ${n3(-ctrl.y)} ${n3(p.x)} ${n3(-p.y)}`
        : `L${n3(p.x)} ${n3(-p.y)}`;
      ctrl = null;
    } else if (ctrl) {
      // Two controls in a row: the anchor between them is implied at their midpoint.
      const mx = (ctrl.x + p.x) / 2;
      const my = (ctrl.y + p.y) / 2;
      d += `Q${n3(ctrl.x)} ${n3(-ctrl.y)} ${n3(mx)} ${n3(-my)}`;
      ctrl = p;
    } else {
      ctrl = p;
    }
  }
  // Close back onto the start, through a trailing control if the contour ended on one.
  if (ctrl) d += `Q${n3(ctrl.x)} ${n3(-ctrl.y)} ${n3(start.x)} ${n3(-start.y)}`;
  return d + "Z";
}

export function parseTtf(buf: Buffer): ParsedFont {
  const t = readTables(buf);
  for (const need of ["head", "maxp", "loca", "glyf", "hhea", "hmtx"]) {
    if (!t[need]) throw new Error(`font is missing the "${need}" table — cannot read outlines`);
  }
  const head = t.head.offset;
  const unitsPerEm = buf.readUInt16BE(head + 18) || 1000;
  const longLoca = buf.readInt16BE(head + 50) === 1;
  const numGlyphs = buf.readUInt16BE(t.maxp.offset + 4);
  const ascender = buf.readInt16BE(t.hhea.offset + 4);
  const descender = buf.readInt16BE(t.hhea.offset + 6);
  const numHMetrics = buf.readUInt16BE(t.hhea.offset + 34);
  const glyphId = t.cmap ? readCmap(buf, t.cmap.offset) : () => 0;

  const locaAt = (i: number): number =>
    longLoca ? buf.readUInt32BE(t.loca.offset + i * 4) : buf.readUInt16BE(t.loca.offset + i * 2) * 2;

  const advance = (gid: number): number => {
    // Past numHMetrics every glyph shares the last entry's advance — a monospace-tail optimisation
    // in the format, not an error.
    const i = Math.min(gid, numHMetrics - 1);
    if (i < 0) return 0;
    const at = t.hmtx.offset + i * 4;
    return at + 2 <= buf.length ? buf.readUInt16BE(at) : 0;
  };

  // Composite glyphs reference other glyphs, so outline() recurses. Depth-capped: a font with a
  // cyclic component reference would otherwise hang the render.
  const outline = (gid: number, depth = 0): string => {
    if (gid < 0 || gid >= numGlyphs || depth > 5) return "";
    const from = locaAt(gid);
    const to = locaAt(gid + 1);
    if (to <= from) return ""; // blank glyph (space)
    const g = t.glyf.offset + from;
    const numContours = buf.readInt16BE(g);

    if (numContours >= 0) {
      let p = g + 10;
      const ends: number[] = [];
      for (let i = 0; i < numContours; i++, p += 2) ends.push(buf.readUInt16BE(p));
      const nPts = numContours ? ends[ends.length - 1] + 1 : 0;
      p += 2 + buf.readUInt16BE(p); // skip instructions

      const flags: number[] = [];
      while (flags.length < nPts) {
        const f = buf.readUInt8(p++);
        flags.push(f);
        if (f & REPEAT) {
          const rep = buf.readUInt8(p++);
          for (let r = 0; r < rep && flags.length < nPts; r++) flags.push(f);
        }
      }
      const xs: number[] = [];
      let x = 0;
      for (const f of flags) {
        if (f & X_SHORT) x += (f & SAME_X ? 1 : -1) * buf.readUInt8(p++);
        else if (!(f & SAME_X)) {
          x += buf.readInt16BE(p);
          p += 2;
        }
        xs.push(x);
      }
      const ys: number[] = [];
      let y = 0;
      for (const f of flags) {
        if (f & Y_SHORT) y += (f & SAME_Y ? 1 : -1) * buf.readUInt8(p++);
        else if (!(f & SAME_Y)) {
          y += buf.readInt16BE(p);
          p += 2;
        }
        ys.push(y);
      }

      let d = "";
      let startPt = 0;
      for (const end of ends) {
        const pts: Pt[] = [];
        for (let i = startPt; i <= end && i < nPts; i++) {
          pts.push({ x: xs[i], y: ys[i], on: (flags[i] & ON_CURVE) !== 0 });
        }
        d += contourPath(pts);
        startPt = end + 1;
      }
      return d;
    }

    // Composite: accumulate each component's outline under its own offset/scale.
    let p = g + 10;
    let d = "";
    for (;;) {
      const flags = buf.readUInt16BE(p);
      const compGid = buf.readUInt16BE(p + 2);
      p += 4;
      let dx: number;
      let dy: number;
      if (flags & 0x0001) {
        dx = buf.readInt16BE(p);
        dy = buf.readInt16BE(p + 2);
        p += 4;
      } else {
        dx = buf.readInt8(p);
        dy = buf.readInt8(p + 1);
        p += 2;
      }
      let a = 1;
      let bq = 0;
      let c = 0;
      let dd = 1;
      const f2 = (o: number) => buf.readInt16BE(o) / 16384; // F2Dot14
      if (flags & 0x0008) {
        a = dd = f2(p);
        p += 2;
      } else if (flags & 0x0040) {
        a = f2(p);
        dd = f2(p + 2);
        p += 4;
      } else if (flags & 0x0080) {
        a = f2(p);
        bq = f2(p + 2);
        c = f2(p + 4);
        dd = f2(p + 6);
        p += 8;
      }
      const sub = outline(compGid, depth + 1);
      // ARGS_ARE_XY_VALUES unset means the args are point indices to align — vanishingly rare in
      // text faces, and mis-transforming would be worse than skipping the component.
      if (sub && flags & 0x0002) {
        d += transformPath(sub, a, bq, c, dd, dx, dy);
      }
      if (!(flags & 0x0020)) break;
    }
    return d;
  };

  return {
    unitsPerEm,
    ascender,
    descender,
    numGlyphs,
    glyphId,
    advance,
    outline: (gid: number) => outline(gid),
  };
}

/**
 * Apply a component transform to already-emitted path data. Y is already flipped in `d`, so the
 * matrix is applied in that flipped space: the b/c shear terms and dy negate accordingly.
 */
export function transformPath(d: string, a: number, b: number, c: number, dd: number, dx: number, dy: number): string {
  return d.replace(/(-?[\d.]+)\s+(-?[\d.]+)/g, (_m, sx: string, sy: string) => {
    const x = Number(sx);
    const yFlipped = Number(sy);
    const y = -yFlipped; // back to font space
    const nx = a * x + c * y + dx;
    const ny = b * x + dd * y + dy;
    return `${n3(nx)} ${n3(-ny)}`;
  });
}

export interface GlyphOutline {
  char: string;
  /** Path data, already offset to this glyph's position in the run. */
  d: string;
  /** Pen advance for this glyph, in the same units as `d`. */
  advance: number;
  /** Pen x at which this glyph starts. */
  x: number;
}

export interface TextOutlines {
  /** Scale applied to font units (1 when `size` was omitted). */
  scale: number;
  unitsPerEm: number;
  ascender: number;
  descender: number;
  /** Total pen advance for the whole run. */
  advance: number;
  glyphs: GlyphOutline[];
}

/**
 * Outlines for a string, laid out on one baseline at y=0.
 *
 * `size` scales so one em equals `size` units (omit for raw font units). `letterSpacing` is in the
 * same post-scale units. No kerning: the GPOS table is a different problem, and for display type at
 * this size the difference is under a unit — the caller can nudge with letterSpacing.
 */
export function textOutlines(
  font: ParsedFont,
  text: string,
  opts: { size?: number; letterSpacing?: number } = {},
): TextOutlines {
  const scale = opts.size ? opts.size / font.unitsPerEm : 1;
  const extra = opts.letterSpacing ?? 0;
  const glyphs: GlyphOutline[] = [];
  let pen = 0;
  for (const char of [...text]) {
    const gid = font.glyphId(char.codePointAt(0) ?? 0);
    const adv = font.advance(gid) * scale + extra;
    const raw = font.outline(gid);
    const d = raw ? placePath(raw, pen, scale) : "";
    glyphs.push({ char, d, advance: adv, x: pen });
    pen += adv;
  }
  return {
    scale,
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender * scale,
    descender: font.descender * scale,
    advance: pen,
    glyphs,
  };
}

/** Scale a glyph's path about the origin and slide it to the pen position. */
export function placePath(d: string, penX: number, scale: number): string {
  if (scale === 1 && penX === 0) return d;
  return d.replace(/(-?[\d.]+)\s+(-?[\d.]+)/g, (_m, sx: string, sy: string) => {
    return `${n3(Number(sx) * scale + penX)} ${n3(Number(sy) * scale)}`;
  });
}
