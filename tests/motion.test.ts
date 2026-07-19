import { describe, it, expect } from "vitest";
import { pickShot, pickTransition, shotTransform, SHOTS, TRANSITIONS } from "../src/render/motion.js";

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
  it("video assets rotate through the soft transitions; override still wins", () => {
    expect(pickTransition(0, undefined, true)).toBe("dissolve");
    expect(pickTransition(1, undefined, true)).toBe("fade");
    expect(pickTransition(2, undefined, true)).toBe("dissolve"); // wraps
    expect(pickTransition(0, "pop", true)).toBe("pop");
  });
});

describe("shotTransform", () => {
  it("scroll pans top→bottom (positive ty → negative) at a mild zoom", () => {
    expect(shotTransform("scroll", 0)).toEqual({ scale: 1.06, tx: 0, ty: 10 });
    expect(shotTransform("scroll", 1)).toEqual({ scale: 1.06, tx: 0, ty: -10 });
    expect(shotTransform("scroll", 0.5).ty).toBeCloseTo(0); // passes through centre
  });

  it("scroll-up reverses the pan (bottom→top)", () => {
    expect(shotTransform("scroll-up", 0)).toEqual({ scale: 1.06, tx: 0, ty: -10 });
    expect(shotTransform("scroll-up", 1)).toEqual({ scale: 1.06, tx: 0, ty: 10 });
  });

  it("keeps the existing shots unchanged", () => {
    expect(shotTransform("push-in", 0).scale).toBeCloseTo(1.06);
    expect(shotTransform("push-in", 1).scale).toBeCloseTo(1.2);
    expect(shotTransform("pan-left", 0)).toEqual({ scale: 1.14, tx: 5, ty: 0 });
    expect(shotTransform("tilt-up", 1)).toEqual({ scale: 1.14, tx: 0, ty: -5 });
    // "static" is a true no-op transform (scale 1) so framed footage fills its inset 1:1 and
    // edge-of-screen UI is never cropped — any scale >1 would silently crop the edges.
    expect(shotTransform("static", 0.5)).toEqual({ scale: 1.0, tx: 0, ty: 0 });
  });
});
