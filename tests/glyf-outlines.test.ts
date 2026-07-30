import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseTtf, textOutlines, placePath, transformPath } from "../src/fonts/glyf.js";

describe("placePath", () => {
  it("is a no-op at unit scale and zero pen", () => {
    const d = "M10 -20L30 -40Z";
    expect(placePath(d, 0, 1)).toBe(d);
  });

  it("scales about the origin and slides to the pen", () => {
    expect(placePath("M10 -20", 5, 2)).toBe("M25 -40");
  });

  it("leaves command letters alone", () => {
    expect(placePath("M0 0Q10 -10 20 0Z", 0, 2)).toBe("M0 0Q20 -20 40 0Z");
  });
});

describe("transformPath", () => {
  it("applies an offset in the flipped space", () => {
    // Identity matrix, pure translate: x+7, and dy=+5 in font space is -5 on screen.
    expect(transformPath("M0 0", 1, 0, 0, 1, 7, 5)).toBe("M7 -5");
  });

  it("applies a uniform scale", () => {
    expect(transformPath("M10 -10", 2, 0, 0, 2, 0, 0)).toBe("M20 -20");
  });
});

// The registry's fonts are fetched on demand into a shared cache. Skip rather than fail when a
// machine (or CI) has never downloaded one — the parser's pure helpers are covered above.
const INTER = join(homedir(), ".kino", "fonts", "inter.ttf");
const haveFont = existsSync(INTER);

describe.skipIf(!haveFont)("parseTtf + textOutlines (cached Inter)", () => {
  // describe.skipIf still runs this body to discover the nested its even when the suite is
  // skipped, so this read must not fire unless the font is actually there.
  const font = haveFont ? parseTtf(readFileSync(INTER)) : (undefined as unknown as ReturnType<typeof parseTtf>);

  it("reads the head/hhea/maxp metrics", () => {
    expect(font.unitsPerEm).toBeGreaterThan(0);
    expect(font.ascender).toBeGreaterThan(0);
    expect(font.descender).toBeLessThan(0);
    expect(font.numGlyphs).toBeGreaterThan(100);
  });

  it("maps characters to distinct glyphs via cmap", () => {
    const s = font.glyphId("S".codePointAt(0)!);
    const o = font.glyphId("o".codePointAt(0)!);
    expect(s).toBeGreaterThan(0);
    expect(o).toBeGreaterThan(0);
    expect(s).not.toBe(o);
  });

  it("returns 0 for a code point the font has no mapping for", () => {
    expect(font.glyphId(0x10fffd)).toBe(0);
  });

  it("emits a closed path with curves for a round glyph", () => {
    const d = font.outline(font.glyphId("o".codePointAt(0)!));
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d).toContain("Q"); // quadratic B-splines, per the glyf format
    // 'o' has an outer contour and a counter, so it closes twice.
    expect(d.match(/Z/g)).toHaveLength(2);
  });

  it("emits only straight segments for a glyph that has none", () => {
    const d = font.outline(font.glyphId("1".codePointAt(0)!));
    expect(d).toContain("L");
    expect(d).not.toContain("Q");
  });

  it("gives a blank glyph no outline but a real advance", () => {
    const gid = font.glyphId(" ".codePointAt(0)!);
    expect(font.outline(gid)).toBe("");
    expect(font.advance(gid)).toBeGreaterThan(0);
  });

  it("lays a run out on one baseline with accumulating advances", () => {
    const run = textOutlines(font, "So", { size: 100 });
    expect(run.glyphs).toHaveLength(2);
    expect(run.glyphs[0].x).toBe(0);
    expect(run.glyphs[1].x).toBeCloseTo(run.glyphs[0].advance, 5);
    expect(run.advance).toBeCloseTo(run.glyphs[0].advance + run.glyphs[1].advance, 5);
  });

  it("scales metrics with size, so one em is `size` units", () => {
    const a = textOutlines(font, "Show", { size: 100 });
    const b = textOutlines(font, "Show", { size: 200 });
    expect(b.advance).toBeCloseTo(a.advance * 2, 3);
    expect(b.ascender).toBeCloseTo(a.ascender * 2, 3);
  });

  it("puts the baseline at 0, with the ascender above it (negative y)", () => {
    const run = textOutlines(font, "S", { size: 100 });
    expect(run.ascender).toBeGreaterThan(0);
    const ys = [...run.glyphs[0].d.matchAll(/-?[\d.]+ (-?[\d.]+)/g)].map((m) => Number(m[1]));
    // Cap-height geometry sits above the baseline, i.e. at negative y in SVG space.
    expect(Math.min(...ys)).toBeLessThan(0);
  });

  it("adds letterSpacing to every advance", () => {
    const plain = textOutlines(font, "abc", { size: 100 });
    const spaced = textOutlines(font, "abc", { size: 100, letterSpacing: 10 });
    expect(spaced.advance).toBeCloseTo(plain.advance + 30, 5);
  });

  it("produces a morph-compatible pair for the same string at two sizes", () => {
    // The practical guarantee: `kino glyphs` twice on the same text always yields endpoints whose
    // command structure matches, so data-kino-morph-stops accepts them.
    const structure = (d: string) => (d.match(/[A-Za-z]/g) ?? []).join("");
    const a = textOutlines(font, "Showreel", { size: 80 });
    const b = textOutlines(font, "Showreel", { size: 140 });
    for (let i = 0; i < a.glyphs.length; i++) {
      expect(structure(a.glyphs[i].d)).toBe(structure(b.glyphs[i].d));
    }
  });
});

describe("parseTtf rejects what it cannot read", () => {
  it("refuses a truncated file", () => {
    expect(() => parseTtf(Buffer.alloc(4))).toThrow(/too short/);
  });

  it("names CFF/PostScript outlines rather than emitting nonsense", () => {
    const buf = Buffer.alloc(12);
    buf.writeUInt32BE(0x4f54544f, 0); // "OTTO"
    expect(() => parseTtf(buf)).toThrow(/CFF/);
  });

  it("reports a missing required table", () => {
    const buf = Buffer.alloc(12);
    buf.writeUInt32BE(0x00010000, 0);
    buf.writeUInt16BE(0, 4);
    expect(() => parseTtf(buf)).toThrow(/missing the "head" table/);
  });
});
