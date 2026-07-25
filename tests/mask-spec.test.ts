import { describe, it, expect } from "vitest";
import { validateMask, resolveMaskDefaults, type LayerMask } from "../src/render/maskSpec.js";

const shape: LayerMask = { source: { kind: "shape", shape: { kind: "rect", x: 0, y: 0, w: 100, h: 100 } } };

describe("validateMask", () => {
  it("accepts a shape mask", () => {
    expect(validateMask(shape)).toEqual([]);
  });

  it("accepts a file mask with a channel", () => {
    expect(validateMask({ source: { kind: "file", src: "mask.png", channel: "r" } })).toEqual([]);
  });

  it("accepts a layer mask referencing another layer id", () => {
    expect(validateMask({ source: { kind: "layer", layerId: "motion0", channel: "luma" } })).toEqual([]);
  });

  it("rejects an unknown source kind", () => {
    expect(validateMask({ source: { kind: "vibes" } as any })[0]).toMatch(/unknown mask source/i);
  });

  it("rejects a file mask with no src", () => {
    expect(validateMask({ source: { kind: "file", channel: "r" } as any })[0]).toMatch(/src/i);
  });

  it("rejects a negative feather", () => {
    expect(validateMask({ ...shape, feather: -4 })[0]).toMatch(/feather/i);
  });

  it("rejects a feather beyond the SDF encode range", () => {
    // SDF_MAX_PX is 128; asking for more feather than the field encodes would clip silently.
    expect(validateMask({ ...shape, feather: 400 })[0]).toMatch(/128/);
  });
});

describe("resolveMaskDefaults", () => {
  it("defaults feather to 0, invert to false, and expand to 0", () => {
    const r = resolveMaskDefaults(shape);
    expect(r.feather).toBe(0);
    expect(r.invert).toBe(false);
    expect(r.expand).toBe(0);
  });

  it("preserves explicit values", () => {
    const r = resolveMaskDefaults({ ...shape, feather: 12, invert: true, expand: -6 });
    expect([r.feather, r.invert, r.expand]).toEqual([12, true, -6]);
  });
});
