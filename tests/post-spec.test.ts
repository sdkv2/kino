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
  it("is grade, bloom, lens, film, dither — dither last of all so nothing smears it", () => {
    expect(postChainOrder).toEqual(["grade", "bloom", "lens", "film", "dither"]);
  });
});
