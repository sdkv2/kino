import { describe, it, expect } from "vitest";
import { scanFontWeights, mergeFontWeightUsage, narrowFontCuts } from "../src/fonts/usedWeights.js";

const scan = (raw: string) => {
  const u = scanFontWeights(raw);
  return { weights: [...u.weights].sort((a, b) => a - b), dynamic: u.dynamic };
};

describe("scanFontWeights", () => {
  it("reads numeric longhand weights from Tier-1 CSS", () => {
    expect(scan(`<style>.a{font-weight:900}.b{font-weight: 600;}</style><div class="a">x</div>`)).toEqual({
      weights: [600, 900],
      dynamic: false,
    });
  });

  it("reads weights out of a Tier-2 proc's string literals", () => {
    const js = `return '<style>.hero{font-weight:800;font-size:4vw}</style><div class="hero">' + env.frame + '</div>';`;
    expect(scan(js)).toEqual({ weights: [800], dynamic: false });
  });

  it("maps the bold/normal keywords", () => {
    expect(scan(`.a{font-weight:bold}.b{font-weight:normal}`)).toEqual({ weights: [400, 700], dynamic: false });
  });

  it("counts UA-bold elements that never say a weight", () => {
    // <h1> renders bold with nothing in the source naming 700 — dropping that cut would change it.
    expect(scan(`<h1>Title</h1>`)).toEqual({ weights: [700], dynamic: false });
  });

  // Everything below must refuse to answer rather than guess — a wrong drop is a silent regression.
  it.each([
    ["template interpolation", "`font-weight:${w}`"],
    ["string concatenation", `'font-weight:' + w`],
    ["a custom property", `.a{font-weight:var(--w)}`],
    ["relative keywords", `.a{font-weight:bolder}`],
    ["the font shorthand", `.a{font:700 3vw/1 Inter}`],
    ["an out-of-range value", `.a{font-weight:1600}`],
  ])("flags %s as unprovable", (_label, src) => {
    expect(scanFontWeights(src).dynamic).toBe(true);
  });

  it("does not mistake font-family or font-size for the shorthand", () => {
    expect(scan(`.a{font-family:var(--kino-font);font-size:3vw;font-weight:700}`)).toEqual({
      weights: [700],
      dynamic: false,
    });
  });
});

describe("narrowFontCuts", () => {
  const usage = (weights: number[], dynamic = false) => ({ weights: new Set(weights), dynamic });

  it("drops declared cuts nothing references", () => {
    expect(narrowFontCuts([400, 600, 700, 800, 900], 800, usage([600, 700, 800, 900]))).toEqual({
      keep: [600, 700, 800, 900],
      dropped: [400],
    });
  });

  it("always keeps the caption weight, which no motion source can vouch for", () => {
    // Captions are drawn by the native text path; with fontFaces non-empty every face carries a
    // weight descriptor, so losing this cut is a synthetic-bold miss rather than a fallback.
    expect(narrowFontCuts([400, 800], 800, usage([400]))).toEqual({ keep: [400, 800], dropped: [] });
  });

  it("keeps everything when any source was unprovable", () => {
    expect(narrowFontCuts([400, 600, 900], 900, usage([900], true))).toEqual({
      keep: [400, 600, 900],
      dropped: [],
    });
  });

  it("merges usage across sources, and one dynamic source poisons the whole set", () => {
    const merged = mergeFontWeightUsage([usage([700]), usage([900]), usage([], true)]);
    expect([...merged.weights].sort()).toEqual([700, 900]);
    expect(merged.dynamic).toBe(true);
    expect(narrowFontCuts([400, 700, 900], 700, merged).dropped).toEqual([]);
  });
});
