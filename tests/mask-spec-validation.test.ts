import { describe, it, expect } from "vitest";
import { validateSegmentFx } from "../src/render/maskSpec.js";

describe("validateSegmentFx", () => {
  it("accepts a beat with no mask or effects", () => {
    expect(validateSegmentFx({}, 0)).toEqual([]);
  });

  it("prefixes errors with the beat index so the message is actionable", () => {
    const errs = validateSegmentFx({ mask: { source: { kind: "nope" } } }, 3);
    expect(errs[0]).toMatch(/beat 3/);
  });

  it("rejects an unknown effect kind, naming the ones that exist", () => {
    const errs = validateSegmentFx({ effects: [{ kind: "bokeh", params: {} }] }, 0);
    expect(errs[0]).toMatch(/bokeh/);
    expect(errs[0]).toMatch(/blur/);
  });

  it("accepts the built-in effects", () => {
    expect(validateSegmentFx({ effects: [{ kind: "blur", params: { radius: 8 } }] }, 0)).toEqual([]);
    expect(
      validateSegmentFx({ effects: [{ kind: "motionBlur", params: { angle: 0, distance: 8 } }] }, 0),
    ).toEqual([]);
  });

  it("rejects an effect with missing params", () => {
    expect(validateSegmentFx({ effects: [{ kind: "blur" }] }, 2)).toContain(
      "beat 2: effects[0].params must be an object",
    );
  });

  it("rejects effects that is not an array", () => {
    expect(validateSegmentFx({ effects: { kind: "blur" } }, 0)[0]).toMatch(/array/i);
  });

  it("rejects an unknown blend mode, naming the beat", () => {
    const errs = validateSegmentFx({ blend: "burn" }, 4);
    expect(errs[0]).toMatch(/beat 4/);
    expect(errs[0]).toMatch(/blend/);
  });

  it("accepts a known blend mode", () => {
    expect(validateSegmentFx({ blend: "screen" }, 0)).toEqual([]);
  });
});
