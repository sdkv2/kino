import { describe, it, expect } from "vitest";
import { kenBurnsScale } from "../src/render/backgrounds/glow.js";

describe("kenBurnsScale", () => {
  it("starts at 1.05", () => {
    expect(kenBurnsScale(0)).toBeCloseTo(1.05, 5);
  });

  it("reaches 1.13 at frame 300", () => {
    expect(kenBurnsScale(300)).toBeCloseTo(1.13, 5);
  });

  it("clamps past the end", () => {
    expect(kenBurnsScale(900)).toBeCloseTo(1.13, 5);
  });

  it("is monotonic across the ramp", () => {
    expect(kenBurnsScale(150)).toBeGreaterThan(kenBurnsScale(50));
  });
});
