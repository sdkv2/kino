import { describe, it, expect } from "vitest";
import { motionFoScale, MOTION_FO_MIN_SCALE } from "../src/render/native/page/motionRaster.js";

describe("motionFoScale", () => {
  it("never FO-rasters motion below 2× (draft SS=1 snaps transforms to whole px)", () => {
    expect(MOTION_FO_MIN_SCALE).toBe(2);
    expect(motionFoScale(1)).toBe(2);
    expect(motionFoScale(2)).toBe(2);
    expect(motionFoScale(3)).toBe(3);
  });
});
