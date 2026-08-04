import { describe, it, expect } from "vitest";
import { validatePostFx, postChainOrder } from "../src/render/postSpec.js";

describe("validatePostFx", () => {
  it("accepts an empty post object", () => {
    expect(validatePostFx({})).toEqual([]);
  });

  it("accepts a full post object", () => {
    expect(validatePostFx({
      grade: { brightness: 1.1, contrast: 1.05, saturation: 0.9 },
      bloom: { threshold: 0.7, intensity: 0.4, radius: 24 },
      lens: { distortion: 0.06, chroma: 0.004 },
      veil: { amount: 0.05, threshold: 0.1 },
      film: { intensity: 0.8 },
      dither: { strength: 0.7 },
    })).toEqual([]);
  });

  it("rejects an unknown post stage", () => {
    expect(validatePostFx({ sparkles: {} })[0]).toMatch(/sparkles/);
  });

  it("rejects out-of-range values with the range in the message", () => {
    expect(validatePostFx({ film: { intensity: 4 } })[0]).toMatch(/0.*1/);
    expect(validatePostFx({ bloom: { threshold: -1 } })[0]).toMatch(/threshold/);
  });

  it("rejects a non-object stage", () => {
    expect(validatePostFx({ grade: 5 })[0]).toMatch(/object/i);
  });
});

describe("postChainOrder", () => {
  it("is grade, bloom, lens, veil, film, dither — grain then dither last so nothing smears them", () => {
    expect(postChainOrder).toEqual(["grade", "bloom", "lens", "veil", "film", "dither"]);
  });

  it("puts veil after everything it measures and before the grain", () => {
    // The stage reads the composite's mean, so any stage that changes overall brightness has to
    // have run by then; grain has to land on top of the glare, not under it.
    const i = (s: string) => postChainOrder.indexOf(s as (typeof postChainOrder)[number]);
    expect(i("veil")).toBeGreaterThan(i("bloom"));
    expect(i("veil")).toBeGreaterThan(i("lens"));
    expect(i("veil")).toBeLessThan(i("film"));
  });

  it("keeps dither last of all — it breaks up the finished 8-bit values", () => {
    expect(postChainOrder[postChainOrder.length - 1]).toBe("dither");
  });
});
