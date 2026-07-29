import { describe, it, expect } from "vitest";
import { resolveEffects } from "../src/render/effectParams.js";
import type { LayerEffect } from "../src/render/maskSpec.js";

describe("resolveEffects", () => {
  it("returns the same array reference when no effect carries keyframes", () => {
    const effects: LayerEffect[] = [{ kind: "blur", params: { radius: 8 } }];
    expect(resolveEffects(effects, 1.5)).toBe(effects);
  });

  it("passes undefined and empty lists through untouched", () => {
    expect(resolveEffects(undefined, 1)).toBeUndefined();
    const empty: LayerEffect[] = [];
    expect(resolveEffects(empty, 1)).toBe(empty);
  });

  it("treats base params as an implicit t=0 keyframe", () => {
    const effects: LayerEffect[] = [
      { kind: "blur", params: { radius: 0 }, keyframes: [{ at: 2, params: { radius: 20 } }] },
    ];
    expect(resolveEffects(effects, 0)![0].params.radius).toBeCloseTo(0, 5);
    expect(resolveEffects(effects, 1)![0].params.radius).toBeCloseTo(10, 5);
    expect(resolveEffects(effects, 2)![0].params.radius).toBeCloseTo(20, 5);
  });

  it("holds the first value before the track and the last value after it", () => {
    const effects: LayerEffect[] = [
      {
        kind: "blur",
        params: {},
        keyframes: [
          { at: 1, params: { radius: 4 } },
          { at: 3, params: { radius: 12 } },
        ],
      },
    ];
    expect(resolveEffects(effects, 0)![0].params.radius).toBeCloseTo(4, 5);
    expect(resolveEffects(effects, 99)![0].params.radius).toBeCloseTo(12, 5);
  });

  it("applies the named ease of the keyframe being approached", () => {
    const linear: LayerEffect[] = [
      { kind: "blur", params: { radius: 0 }, keyframes: [{ at: 2, params: { radius: 100 } }] },
    ];
    const eased: LayerEffect[] = [
      { kind: "blur", params: { radius: 0 }, keyframes: [{ at: 2, params: { radius: 100 }, ease: "easeOutQuart" }] },
    ];
    // easeOutQuart is above linear everywhere inside the segment.
    expect(Number(resolveEffects(eased, 1)![0].params.radius)).toBeGreaterThan(
      Number(resolveEffects(linear, 1)![0].params.radius),
    );
  });

  it("resolves each effect independently and leaves un-keyframed neighbours alone", () => {
    const still: LayerEffect = { kind: "grade", params: { saturation: 1.4 } };
    const effects: LayerEffect[] = [
      { kind: "blur", params: { radius: 0 }, keyframes: [{ at: 2, params: { radius: 20 } }] },
      still,
    ];
    const out = resolveEffects(effects, 1)!;
    expect(out[0].params.radius).toBeCloseTo(10, 5);
    expect(out[1]).toBe(still);
  });

  it("drops the keyframes track from the resolved effect", () => {
    const effects: LayerEffect[] = [
      { kind: "blur", params: { radius: 0 }, keyframes: [{ at: 2, params: { radius: 20 } }] },
    ];
    expect(resolveEffects(effects, 1)![0].keyframes).toBeUndefined();
  });

  it("carries string params through untouched", () => {
    const effects: LayerEffect[] = [
      { kind: "blur", params: { focusMode: "band", radius: 0 }, keyframes: [{ at: 2, params: { radius: 8 } }] },
    ];
    expect(resolveEffects(effects, 1)![0].params.focusMode).toBe("band");
  });
});
