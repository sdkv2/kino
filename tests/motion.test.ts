import { describe, it, expect } from "vitest";
import {
  pickShot,
  pickTransition,
  shotTransform,
  motionHandoff,
  MOTION_XFADE_FRAMES,
  SHOTS,
  TRANSITIONS,
} from "../src/render/motion.js";

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

describe("motionHandoff", () => {
  it("last motion beat matches VO end (no extension, no fade-in)", () => {
    const h = motionHandoff({
      startSec: 10,
      endSec: 12,
      nextMotionStartSec: null,
      prevIsMotion: true,
      fps: 30,
    });
    expect(h).toEqual({ from: 300, seqDur: 60, beatDur: 60, fadeIn: true });
  });

  it("holds through a VO gap and overlaps the next motion beat", () => {
    // beat 0→2s, gap, next starts 2.32s → hold to 2.32s + xfade
    const h = motionHandoff({
      startSec: 0,
      endSec: 2,
      nextMotionStartSec: 2.32,
      prevIsMotion: false,
      fps: 30,
    });
    expect(h.from).toBe(0);
    expect(h.beatDur).toBe(60);
    expect(h.fadeIn).toBe(false); // opener — loop-safe
    expect(h.seqDur).toBe(Math.round(2.32 * 30) + MOTION_XFADE_FRAMES);
  });

  it("incoming beat after another motion fades in", () => {
    const h = motionHandoff({
      startSec: 2.32,
      endSec: 5,
      nextMotionStartSec: 5.3,
      prevIsMotion: true,
      fps: 30,
    });
    expect(h.fadeIn).toBe(true);
  });
});
