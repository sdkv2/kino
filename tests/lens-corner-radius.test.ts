import { describe, it, expect } from "vitest";
import { cornerRadiusPx } from "../src/render/native/page/lensMirror.js";

// getComputedStyle does NOT resolve border-radius percentages — the computed value keeps its unit.
// A bare parseFloat therefore read "50%" as 50px, which made a circular lens impossible: the mirror
// came back a barely-rounded square while the CSS border drawn over it was a true circle.
describe("lens corner radius", () => {
  it("resolves a percentage against the short edge, not as pixels", () => {
    // The bug: this returned 50.
    expect(cornerRadiusPx("50%", 365, 365)).toBe(182.5);
    expect(cornerRadiusPx("25%", 400, 400)).toBe(100);
  });

  it("makes border-radius:50% on a square an exact circle", () => {
    const w = 240;
    expect(cornerRadiusPx("50%", w, w)).toBe(w / 2);
  });

  it("still treats plain px as px", () => {
    expect(cornerRadiusPx("48px", 400, 300)).toBe(48);
    expect(cornerRadiusPx("12px", 400, 300)).toBe(12);
  });

  it("caps at half the short edge so a lens can never exceed a circle", () => {
    expect(cornerRadiusPx("9999px", 200, 120)).toBe(60);
    expect(cornerRadiusPx("400%", 200, 120)).toBe(60);
  });

  it("resolves percentages against the SHORT edge on non-square boxes", () => {
    // 50% of min(600,200) = 100, which is also the cap — a stadium end, not an ellipse.
    expect(cornerRadiusPx("50%", 600, 200)).toBe(100);
  });

  it("treats missing or unparseable values as zero rather than NaN", () => {
    expect(cornerRadiusPx("", 100, 100)).toBe(0);
    expect(cornerRadiusPx("auto", 100, 100)).toBe(0);
    expect(cornerRadiusPx("-20px", 100, 100)).toBe(0);
  });
});
