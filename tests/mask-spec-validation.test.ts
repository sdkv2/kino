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
  });

  it("rejects effects that is not an array", () => {
    expect(validateSegmentFx({ effects: { kind: "blur" } }, 0)[0]).toMatch(/array/i);
  });
});
