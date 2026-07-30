import { describe, it, expect } from "vitest";
import { SpecSchema, parseSpec } from "../src/spec/schema.js";
import { resolveFontCuts } from "../src/fonts/registry.js";

const valid = {
  brand: "acme",
  title: "font-weights-spec",
  segments: [{ kind: "scene", text: "hi", caption: "hi" }],
};

describe("SpecSchema fontWeights", () => {
  it("is optional — omitting it leaves the brand (or nothing) to decide", () => {
    expect(SpecSchema.parse(valid).fontWeights).toBeUndefined();
  });

  it("carries the requested cuts through", () => {
    expect(SpecSchema.parse({ ...valid, fontWeights: [400, 500, 800] }).fontWeights).toEqual([400, 500, 800]);
  });

  it("accepts an empty array — the way a spec opts out of a heavy brand's cuts", () => {
    expect(SpecSchema.parse({ ...valid, fontWeights: [] }).fontWeights).toEqual([]);
  });

  it("rejects weights outside the 100..900 CSS range", () => {
    expect(() => SpecSchema.parse({ ...valid, fontWeights: [0] })).toThrow();
    expect(() => SpecSchema.parse({ ...valid, fontWeights: [1000] })).toThrow();
  });

  it("rejects a fractional weight — a cut is a discrete face, not a variable axis", () => {
    expect(() => SpecSchema.parse({ ...valid, fontWeights: [450.5] })).toThrow();
  });

  it("names itself as top-level when parked on a segment by mistake", () => {
    const bad = { ...valid, segments: [{ kind: "scene", text: "hi", fontWeights: [400] }] };
    expect(() => parseSpec(bad)).toThrow(/fontWeights is top-level \(or brand\.md\)/);
  });
});

describe("resolveFontCuts", () => {
  it("stages nothing when neither spec nor brand asks — today's single-cut behaviour", () => {
    expect(resolveFontCuts(800, undefined, undefined)).toEqual([]);
  });

  it("always includes the caption cut, so a page asking for it still resolves", () => {
    expect(resolveFontCuts(800, undefined, [400])).toEqual([400, 800]);
  });

  it("sorts and dedupes, so the caption weight is not staged twice", () => {
    expect(resolveFontCuts(800, undefined, [800, 400, 500, 400])).toEqual([400, 500, 800]);
  });

  it("lets the spec override the brand outright — the more specific declaration wins", () => {
    expect(resolveFontCuts(800, [300], [400, 500])).toEqual([300, 800]);
  });

  it("treats an explicit empty spec array as opting out of the brand's cuts", () => {
    expect(resolveFontCuts(800, [], [400, 500, 900])).toEqual([]);
  });

  it("falls back to the brand when the spec is silent", () => {
    expect(resolveFontCuts(600, undefined, [200, 600])).toEqual([200, 600]);
  });
});
