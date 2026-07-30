import { describe, it, expect } from "vitest";
import {
  chamferDistance,
  encodeShapeSdf,
  lerpPathD,
  samplePathAnimate,
  shapeSdfMax,
} from "../src/render/native/page/lensShape.js";

describe("kino-lens SVG shape", () => {
  it("encodeShapeSdf yields negative sd inside a filled disk", () => {
    const w = 64;
    const h = 64;
    const ss = 1;
    const rgba = new Uint8ClampedArray(w * h * 4);
    const cx = 32;
    const cy = 32;
    const r = 20;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const on = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
        const i = (y * w + x) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = 255;
        rgba[i + 3] = on ? 255 : 0;
      }
    }
    const maxDist = shapeSdfMax(w, h);
    encodeShapeSdf(rgba, w, h, ss, maxDist);
    const decode = (x: number, y: number) =>
      ((rgba[(y * w + x) * 4] / 255) - 0.5) * 2 * maxDist;
    expect(decode(cx, cy)).toBeLessThan(-10);
    expect(decode(0, 0)).toBeGreaterThan(10);
    expect(Math.abs(decode(cx + r, cy))).toBeLessThan(2.5);
    // Opaque alpha — canvas WebGL upload must not premultiply-away exterior SDF.
    expect(rgba[(cy * w + cx) * 4 + 3]).toBe(255);
    expect(rgba[3]).toBe(255);
  });

  it("chamferDistance is zero on seeds", () => {
    const w = 5;
    const h = 1;
    const seed = new Uint8Array([0, 0, 1, 0, 0]);
    const d = chamferDistance(seed, w, h);
    expect(d[2]).toBe(0);
    expect(d[0]).toBeGreaterThan(d[1]);
  });

  it("lerpPathD interpolates matching path numerics", () => {
    const a = "M0 0 L100 0 L100 100 L0 100 Z";
    const b = "M50 0 L100 50 L50 100 L0 50 Z";
    const mid = lerpPathD(a, b, 0.5);
    expect(mid).toContain("25");
    expect(lerpPathD(a, b, 0)).toBe(a);
    expect(lerpPathD(a, b, 1)).toBe(b);
  });

  it("samplePathAnimate lerps SMIL path values", () => {
    const path = {
      querySelector: () => ({
        getAttribute: (n: string) => {
          if (n === "values") return "M0 0 L100 0 L100 100 L0 100 Z;M50 0 L100 50 L50 100 L0 50 Z";
          if (n === "keyTimes") return "0;1";
          return null;
        },
      }),
    } as unknown as Element;
    expect(samplePathAnimate(path, 0)).toContain("M0 0");
    expect(samplePathAnimate(path, 1)).toContain("L100 50");
    expect(samplePathAnimate(path, 0.5)).toContain("25");
  });
});
