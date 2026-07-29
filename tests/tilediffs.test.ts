import { describe, it, expect } from "vitest";
import { tileDiffs, seamDiff, frameStats, CHROMATIC_PX } from "../src/media/seam.js";
import { isSubjectStatic, SUBJECT_TILE_MEAN } from "../src/render/motionProbe.js";
import { GREYSCALE_CHROMA_MAX } from "../src/render/motionQa.js";

/** Raw RGB24 frame filled with one grey level. */
function flat(w: number, h: number, v: number): Buffer {
  return Buffer.alloc(w * h * 3, v);
}

/** Same, then a solid block painted at `v` over [x0,x1)×[y0,y1). */
function withBlock(w: number, h: number, base: number, v: number, x0: number, y0: number, x1: number, y1: number): Buffer {
  const b = flat(w, h, base);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 3;
      b[i] = v;
      b[i + 1] = v;
      b[i + 2] = v;
    }
  }
  return b;
}

describe("tileDiffs", () => {
  it("returns one entry per tile, row-major", () => {
    expect(tileDiffs(flat(16, 16, 0), flat(16, 16, 0), 16, 16, 4, 4)).toHaveLength(16);
  });

  it("is zero for identical frames", () => {
    const d = tileDiffs(flat(16, 16, 30), flat(16, 16, 30), 16, 16, 4, 4);
    expect(Math.max(...d)).toBe(0);
  });

  it("localises change to the tiles that actually changed", () => {
    // A 4x4 block in the top-left corner of a 16x16 frame = exactly tile 0 of a 4x4 grid.
    const a = flat(16, 16, 0);
    const b = withBlock(16, 16, 0, 255, 0, 0, 4, 4);
    const d = tileDiffs(a, b, 16, 16, 4, 4);
    expect(d[0]).toBe(255);
    expect(d.slice(1).every((v) => v === 0)).toBe(true);
  });

  it("separates a diffuse wash from a moving subject — the point of tiling", () => {
    const W = 32;
    const H = 32;
    // Wash: every pixel lifts by 1. Subject: a small block swings by 255.
    const base = flat(W, H, 10);
    const wash = flat(W, H, 11);
    const subject = withBlock(W, H, 10, 255, 0, 0, 4, 4);

    // Frame-wide means are comparably small for both...
    expect(seamDiff(base, wash)).toBeCloseTo(1, 5);
    expect(seamDiff(base, subject)).toBeLessThan(4);

    // ...but the max tile tells them apart decisively.
    expect(Math.max(...tileDiffs(base, wash, W, H, 8, 8))).toBeCloseTo(1, 5);
    // 255 painted over a base of 10 → a 245 delta, filling exactly one 4x4 tile of the 8x8 grid.
    expect(Math.max(...tileDiffs(base, subject, W, H, 8, 8))).toBe(245);
  });

  it("counts every pixel once when the frame does not divide evenly", () => {
    // 10 wide over a 4-col grid: the last tile absorbs the remainder.
    const a = flat(10, 4, 0);
    const b = flat(10, 4, 8);
    const d = tileDiffs(a, b, 10, 4, 4, 2);
    expect(d).toHaveLength(8);
    expect(d.every((v) => v === 8)).toBe(true);
  });

  it("rejects mismatched or wrong-sized buffers", () => {
    expect(() => tileDiffs(flat(4, 4, 0), flat(8, 8, 0), 4, 4, 2, 2)).toThrow(/length mismatch/);
    expect(() => tileDiffs(flat(4, 4, 0), flat(4, 4, 0), 8, 8, 2, 2)).toThrow(/expected/);
    expect(() => tileDiffs(flat(4, 4, 0), flat(4, 4, 0), 4, 4, 0, 2)).toThrow(/positive grid/);
  });
});

describe("frameStats", () => {
  /** A frame of `base` grey with `n` pixels painted an exact colour. */
  function tinted(px: number, base: number, n: number, rgb: [number, number, number]): Buffer {
    const b = Buffer.alloc(px * 3, base);
    for (let i = 0; i < n; i++) {
      b[i * 3] = rgb[0];
      b[i * 3 + 1] = rgb[1];
      b[i * 3 + 2] = rgb[2];
    }
    return b;
  }

  it("reports zeroes for an empty buffer", () => {
    expect(frameStats(Buffer.alloc(0))).toEqual({ colors: 0, luma: 0, chroma: 0, chromaMax: 0, chromaticPx: 0 });
  });

  it("sees no chroma in a greyscale frame", () => {
    const s = frameStats(Buffer.alloc(300 * 3, 90));
    expect(s.chromaMax).toBe(0);
    expect(s.chromaticPx).toBe(0);
    expect(s.colors).toBe(1);
    expect(s.luma).toBeCloseTo(90, 0);
  });

  it("uses the PEAK to find a small saturated element the mean would average away", () => {
    // This is the calibration that matters. A mostly-black frame with a small magenta element is the
    // correct look for the beat whose colour smears were pinned invisible; a mean-chroma threshold
    // could not separate the two (measured 1.29 correct vs 0.01 broken), but the peaks are decisive.
    const correct = tinted(10000, 4, 150, [233, 30, 140]);
    const broken = Buffer.alloc(10000 * 3, 4); // the bug: no colour rendered at all
    expect(frameStats(correct).chroma).toBeLessThan(4); // mean is tiny even when correct...
    expect(frameStats(correct).chromaMax).toBeGreaterThan(GREYSCALE_CHROMA_MAX); // ...the peak is not
    expect(frameStats(broken).chromaMax).toBeLessThan(GREYSCALE_CHROMA_MAX);
  });

  it("counts the coloured fraction of the frame", () => {
    const s = frameStats(tinted(1000, 0, 100, [255, 0, 0]));
    expect(s.chromaticPx).toBeCloseTo(0.1, 5);
    expect(s.chromaMax).toBe(255);
  });

  it("does not count a faint tint as coloured", () => {
    const faint = CHROMATIC_PX - 2;
    const s = frameStats(tinted(1000, 10, 500, [10 + faint, 10, 10]));
    expect(s.chromaticPx).toBe(0);
    expect(s.chromaMax).toBe(faint);
  });
});

describe("isSubjectStatic", () => {
  it("flags a beat whose every pair only breathes diffusely", () => {
    const wash = new Array(64).fill(SUBJECT_TILE_MEAN - 0.2);
    expect(isSubjectStatic([wash, wash])).toBe(true);
  });

  it("passes a beat where any pair has one tile carrying real movement", () => {
    const wash = new Array(64).fill(SUBJECT_TILE_MEAN - 0.2);
    const moved = [...wash];
    moved[17] = 40;
    expect(isSubjectStatic([wash, moved])).toBe(false);
  });

  it("treats no usable tile data as nothing to judge", () => {
    expect(isSubjectStatic([])).toBe(false);
    expect(isSubjectStatic([[], []])).toBe(false);
  });
});
