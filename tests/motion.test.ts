import { describe, it, expect } from "vitest";
import { pickShot, pickTransition, SHOTS, TRANSITIONS } from "../src/render/motion.js";

describe("auto-vary motion picker", () => {
  it("cycles shots so consecutive app cut-ins differ", () => {
    const seq = [0, 1, 2, 3].map((i) => pickShot(i));
    expect(new Set(seq).size).toBe(4); // all different across a run of 4
    expect(pickShot(SHOTS.length)).toBe(pickShot(0)); // wraps deterministically
  });
  it("cycles transitions and wraps", () => {
    expect(pickTransition(0)).toBe(TRANSITIONS[0]);
    expect(pickTransition(TRANSITIONS.length)).toBe(TRANSITIONS[0]);
  });
  it("honours an explicit override", () => {
    expect(pickShot(0, "tilt-up")).toBe("tilt-up");
    expect(pickTransition(0, "cut")).toBe("cut");
  });
});
