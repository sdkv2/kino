import { describe, it, expect } from "vitest";
import { paramsAt, pulseAt, applyEase, progressCurves } from "../src/render/bgparams.js";

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
    expect(paramsAt(base, ok, 0.8).scale as number).toBeGreaterThan(1);
    expect(paramsAt(base, ok, 1).scale).toBe(1);
  });
});

describe("applyEase / progressCurves", () => {
  it("ease-out cubic lands soft (above linear mid)", () => {
    expect(applyEase("out", 0.5)).toBeGreaterThan(0.5);
    expect(applyEase("out", 0)).toBe(0);
    expect(applyEase("out", 1)).toBe(1);
  });
  it("edge is 0 at ends and 1 at mid", () => {
    const a = progressCurves(0);
    const b = progressCurves(0.5);
    const c = progressCurves(1);
    expect(a.edge).toBeCloseTo(0);
    expect(b.edge).toBeCloseTo(1);
    expect(c.edge).toBeCloseTo(0);
    expect(b.out).toBeCloseTo(applyEase("out", 0.5));
  });
});

describe("pulseAt", () => {
  const trig = [{ at: 1, action: "pulse" }];
  it("attacks to ~1 then decays (legacy halfLife arg still works)", () => {
    expect(pulseAt(trig, 0.5, 0.5)).toBe(0);
    expect(pulseAt(trig, 1.045, 0.5)).toBeCloseTo(1, 1); // end of default attack @ halfLife 0.5
    expect(pulseAt(trig, 1.045 + 0.5, 0.5)).toBeCloseTo(0.5, 1);
  });
  it("default envelope is punchier than a soft half-life of 0.5s", () => {
    const soft = pulseAt(trig, 1.3, 0.5);
    const punch = pulseAt(trig, 1.3); // default decay
    expect(punch).toBeLessThan(soft);
  });
  it("ignores non-pulse actions and empty lists", () => {
    expect(pulseAt([{ at: 1, action: "flash" }], 1)).toBe(0);
    expect(pulseAt([], 5)).toBe(0);
  });
});
