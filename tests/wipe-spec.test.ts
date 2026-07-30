import { describe, it, expect } from "vitest";
import { resolveWipeParams, isWipe, WIPE_ANGLES, WIPE_DEFAULTS } from "../src/render/wipeSpec.js";
import { transitionWipeForWindow, transitionKindForWindow, transitionInvertForWindow } from "../src/render/transitionSpec.js";
import type { KinoProps } from "../src/render/props.js";

const MINT = "#80e2b4";
const deg = (rad: number) => Math.round((rad * 180) / Math.PI);

describe("isWipe", () => {
  it("recognises the family, bare and directional", () => {
    expect(["wipe", "wipe-down", "wipe-up", "wipe-left", "wipe-right"].every(isWipe)).toBe(true);
  });
  it("leaves the other transitions alone", () => {
    expect(["fade", "dissolve", "fly-left", "fly-up", "pop", "cut"].some(isWipe)).toBe(false);
  });
});

describe("resolveWipeParams", () => {
  it("maps each directional shorthand to its angle", () => {
    expect(deg(resolveWipeParams("wipe-down", undefined, MINT).angle)).toBe(0);
    expect(deg(resolveWipeParams("wipe-right", undefined, MINT).angle)).toBe(90);
    expect(deg(resolveWipeParams("wipe-up", undefined, MINT).angle)).toBe(180);
    expect(deg(resolveWipeParams("wipe-left", undefined, MINT).angle)).toBe(270);
    expect(WIPE_ANGLES["wipe"]).toBe(0); // bare `wipe` is down unless an angle says otherwise
  });

  it("lets an explicit angle override the shorthand, including diagonals", () => {
    expect(deg(resolveWipeParams("wipe-down", { angle: 45 }, MINT).angle)).toBe(45);
    expect(deg(resolveWipeParams("wipe-up", { angle: 315 }, MINT).angle)).toBe(315);
  });

  it("falls back to the brand mint for the lit edge, and takes an override", () => {
    expect(resolveWipeParams("wipe", undefined, "#ff0000").edgeColor).toEqual([1, 0, 0]);
    const custom = resolveWipeParams("wipe", { edgeColor: "#0000ff" }, MINT).edgeColor;
    expect(custom).toEqual([0, 0, 1]);
  });

  it("applies documented defaults when nothing is set", () => {
    const p = resolveWipeParams("wipe", undefined, MINT);
    expect(p.softness).toBeCloseTo(WIPE_DEFAULTS.softness, 6);
    expect(p.edgeWidth).toBeCloseTo(WIPE_DEFAULTS.edgeWidth, 6);
    expect(p.edgeGain).toBeCloseTo(WIPE_DEFAULTS.edgeGain, 6);
  });

  it("takes per-knob overrides", () => {
    const p = resolveWipeParams("wipe", { softness: 0.09, edgeWidth: 0.04, edgeGain: 1.5 }, MINT);
    expect(p.softness).toBeCloseTo(0.09, 6);
    expect(p.edgeWidth).toBeCloseTo(0.04, 6);
    expect(p.edgeGain).toBeCloseTo(1.5, 6);
  });

  it("floors softness above zero — a literal 0 aliases into a staircase on a diagonal", () => {
    expect(resolveWipeParams("wipe", { softness: 0 }, MINT).softness).toBeGreaterThan(0);
  });

  it("treats either edge knob at 0 as 'no lit edge', so the shader has one thing to test", () => {
    const noWidth = resolveWipeParams("wipe", { edgeWidth: 0 }, MINT);
    expect([noWidth.edgeWidth, noWidth.edgeGain]).toEqual([0, 0]);
    const noGain = resolveWipeParams("wipe", { edgeGain: 0 }, MINT);
    expect([noGain.edgeWidth, noGain.edgeGain]).toEqual([0, 0]);
  });
});

describe("transitionWipeForWindow", () => {
  const props = (segs: unknown[]) =>
    ({ fps: 30, theme: { mint: MINT }, segments: segs }) as unknown as KinoProps;
  const win = { from: "beat0", to: "beat1", p: 0.5 };

  it("is undefined for a non-wipe transition, so other shaders get no uniforms", () => {
    const p = props([
      { kind: "motion", startSec: 0, endSec: 3, motion: {} },
      { kind: "motion", startSec: 3, endSec: 6, motion: {} }, // defaults to dissolve
    ]);
    expect(transitionKindForWindow(p, win)).toBe("dissolve");
    expect(transitionWipeForWindow(p, win)).toBeUndefined();
  });

  it("resolves off the INCOMING beat and picks up the brand mint", () => {
    const p = props([
      { kind: "motion", startSec: 0, endSec: 3, motion: {} },
      { kind: "motion", startSec: 3, endSec: 6, motion: {}, transition: "wipe-left" },
    ]);
    const w = transitionWipeForWindow(p, win)!;
    expect(deg(w.angle)).toBe(270);
    expect(w.edgeColor).toEqual([128 / 255, 226 / 255, 180 / 255]);
  });

  it("threads the incoming beat's transitionParams through", () => {
    const p = props([
      { kind: "motion", startSec: 0, endSec: 3, motion: {} },
      {
        kind: "motion", startSec: 3, endSec: 6, motion: {},
        transition: "wipe",
        transitionParams: { angle: 135, softness: 0.05, edgeWidth: 0, edgeColor: "#ffffff" },
      },
    ]);
    const w = transitionWipeForWindow(p, win)!;
    expect(deg(w.angle)).toBe(135);
    expect(w.softness).toBeCloseTo(0.05, 6);
    expect(w.edgeWidth).toBe(0);
    expect(w.edgeColor).toEqual([1, 1, 1]);
  });

  it("works on video beats too — the family is not motion-only", () => {
    const p = props([
      { kind: "video", source: "a.png", startSec: 0, endSec: 3 },
      { kind: "video", source: "b.png", startSec: 3, endSec: 6, transition: "wipe-up" },
    ]);
    expect(deg(transitionWipeForWindow(p, win)!.angle)).toBe(180);
  });
});

describe("transitionInvertForWindow", () => {
  const props = (seg1: Record<string, unknown>) =>
    ({
      fps: 30,
      theme: { mint: MINT },
      segments: [{ kind: "motion", startSec: 0, endSec: 3, motion: {} }, { kind: "motion", startSec: 3, endSec: 6, motion: {}, ...seg1 }],
    }) as unknown as KinoProps;
  const win = { from: "beat0", to: "beat1", p: 0.5 };

  it("defaults to false, so every existing spec is untouched", () => {
    expect(transitionInvertForWindow(props({ transition: "wipe-down" }), win)).toBe(false);
  });

  it("reads off the incoming beat", () => {
    expect(transitionInvertForWindow(props({ transition: "wipe-down", transitionInvert: true }), win)).toBe(true);
  });

  it("applies to a custom shader too — inversion is compositor-side, not shader-side", () => {
    expect(
      transitionInvertForWindow(props({ transition: "custom", transitionSource: "x", transitionInvert: true }), win),
    ).toBe(true);
  });

  it("applies to transitions that take no params at all", () => {
    expect(transitionInvertForWindow(props({ transition: "fade", transitionInvert: true }), win)).toBe(true);
  });
});
