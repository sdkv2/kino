import { describe, it, expect } from "vitest";
import { motionFoScale, MOTION_FO_MIN_SCALE } from "../src/render/native/page/motionRaster.js";

describe("motionFoScale", () => {
  it("floors at 1× — the FO supersample is opt-in via --quality very-high", () => {
    expect(MOTION_FO_MIN_SCALE).toBe(1);
    expect(motionFoScale(1)).toBe(1);
    expect(motionFoScale(2)).toBe(2);
    expect(motionFoScale(3)).toBe(3);
  });

  it("still honours a raised floor, which is how very-high restores 2×", () => {
    (globalThis as { __kinoMotionFoMin?: number }).__kinoMotionFoMin = 2;
    try {
      expect(motionFoScale(1)).toBe(2);
      expect(motionFoScale(3)).toBe(3);
    } finally {
      delete (globalThis as { __kinoMotionFoMin?: number }).__kinoMotionFoMin;
    }
  });
});
