import { describe, it, expect } from "vitest";
import { paramsAt, pulseAt } from "../src/render/bgparams.js";

const base = { intensity: 0.5, colorA: "#000000" };

describe("paramsAt", () => {
  const kf = [
    { at: 0, params: { intensity: 0 } },
    { at: 2, params: { intensity: 1 } },
  ];
  it("lerps numbers between surrounding keyframes", () => {
    expect(paramsAt(base, kf, 1).intensity).toBeCloseTo(0.5);
  });
  it("clamps before the first and after the last keyframe", () => {
    expect(paramsAt(base, kf, -1).intensity).toBe(0);
    expect(paramsAt(base, kf, 9).intensity).toBe(1);
  });
  it("leaves params that have no keyframes at their base value", () => {
    expect(paramsAt(base, kf, 1).colorA).toBe("#000000");
  });
  it("lerps colours channel-wise", () => {
    const ck = [
      { at: 0, params: { colorA: "#000000" } },
      { at: 2, params: { colorA: "#ffffff" } },
    ];
    expect(paramsAt(base, ck, 1).colorA).toBe("#808080");
  });
  it("applies easeInOut (smoothstep) at the midpoint = 0.5", () => {
    const ek = [
      { at: 0, params: { intensity: 0 } },
      { at: 2, params: { intensity: 1 }, ease: "easeInOut" as const },
    ];
    expect(paramsAt(base, ek, 1).intensity).toBeCloseTo(0.5);
  });
  it("overshoot eases past the target before settling", () => {
    const ok = [
      { at: 0, params: { scale: 0 } },
      { at: 1, params: { scale: 1 }, ease: "overshoot" as const },
    ];
    expect(paramsAt(base, ok, 0.8).scale as number).toBeGreaterThan(1); // overshoots target=1
    expect(paramsAt(base, ok, 1).scale).toBe(1); // settles exactly at the keyframe
  });
});

describe("pulseAt", () => {
  const trig = [{ at: 1, action: "pulse" }];
  it("is 1 at the trigger, decays by half each half-life, 0 before", () => {
    expect(pulseAt(trig, 1, 0.5)).toBeCloseTo(1);
    expect(pulseAt(trig, 1.5, 0.5)).toBeCloseTo(0.5);
    expect(pulseAt(trig, 0.5, 0.5)).toBe(0);
  });
  it("ignores non-pulse actions and empty lists", () => {
    expect(pulseAt([{ at: 1, action: "flash" }], 1)).toBe(0);
    expect(pulseAt([], 5)).toBe(0);
  });
});
