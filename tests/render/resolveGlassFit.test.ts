import { describe, it, expect } from "vitest";
import { resolveGlassFit } from "../../src/render/native/page/liquidGlass.js";

describe("resolveGlassFit", () => {
  it("fills a plain card (fit 1) so the lens matches the element edge", () => {
    expect(resolveGlassFit(false)).toBe(1);
  });
  it("falls back to the 45° AABB (0.70) once the author uses tilt/morph (rect-hold and spin stay same size)", () => {
    expect(resolveGlassFit(true)).toBe(0.7);
  });
  it("honours --glass-fit override, clamped to [0.3, 1]", () => {
    expect(resolveGlassFit(true, 0.85)).toBe(0.85);
    expect(resolveGlassFit(false, 1.5)).toBe(1);
    expect(resolveGlassFit(false, 0.1)).toBe(0.3);
    expect(resolveGlassFit(true, -1)).toBe(0.7); // missing/invalid → adaptive
  });
});
