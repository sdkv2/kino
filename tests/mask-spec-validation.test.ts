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

  it('accepts a "file"-kind segment mask — the binding is wired now', () => {
    // #25: planMaskJobs extracts lmask<beat> frames (coverage + SDF), registry registers them,
    // renderer binds them. A well-formed file mask is a valid segment mask.
    const errs = validateSegmentFx(
      { mask: { source: { kind: "file", src: "masks/subject/mask.mp4", channel: "r" } } },
      5,
    );
    expect(errs).toEqual([]);
  });

  it('still reports OTHER mask errors on a "file"-kind mask', () => {
    // No `src` — validateMask's own check fires; the kind itself is no longer an error.
    const errs = validateSegmentFx({ mask: { source: { kind: "file", channel: "r" } } }, 0);
    expect(errs.some((e) => /mask\.source\.src is required/.test(e))).toBe(true);
    expect(errs.some((e) => /mask\.source\.kind "file"/.test(e))).toBe(false);
  });

  it('does not reject "shape" or "layer" mask kinds', () => {
    expect(
      validateSegmentFx({ mask: { source: { kind: "shape", shape: { kind: "rect", x: 0, y: 0, w: 10, h: 10 } } } }, 0),
    ).toEqual([]);
    expect(validateSegmentFx({ mask: { source: { kind: "layer", layerId: "seg0" } } }, 0)).toEqual([]);
  });
});

describe("effect keyframe validation", () => {
  it("accepts a well-formed track", () => {
    expect(
      validateSegmentFx(
        { effects: [{ kind: "blur", params: { radius: 0 }, keyframes: [{ at: 1.2, params: { radius: 20 }, ease: "easeOutQuart" }] }] },
        0,
      ),
    ).toEqual([]);
  });

  it("rejects a non-array keyframes", () => {
    const errs = validateSegmentFx({ effects: [{ kind: "blur", params: {}, keyframes: {} }] }, 2);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("beat 2");
    expect(errs[0]).toContain("keyframes must be an array");
  });

  it("rejects a negative at", () => {
    const errs = validateSegmentFx({ effects: [{ kind: "blur", params: {}, keyframes: [{ at: -1, params: { radius: 2 } }] }] }, 0);
    expect(errs[0]).toContain("at must be a number >= 0");
  });

  it("rejects a missing params object", () => {
    const errs = validateSegmentFx({ effects: [{ kind: "blur", params: {}, keyframes: [{ at: 1 }] }] }, 0);
    expect(errs[0]).toContain("params must be an object");
  });

  it("rejects an unknown ease and names the valid ones", () => {
    const errs = validateSegmentFx({ effects: [{ kind: "blur", params: {}, keyframes: [{ at: 1, params: { radius: 2 }, ease: "swoosh" }] }] }, 0);
    expect(errs[0]).toContain("swoosh");
    expect(errs[0]).toContain("easeOutQuart");
  });

  it("rejects an unknown blur focusMode", () => {
    const errs = validateSegmentFx({ effects: [{ kind: "blur", params: { focusMode: "sideways" } }] }, 0);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("expected radial or band");
  });

  it("accepts both real focus modes", () => {
    expect(validateSegmentFx({ effects: [{ kind: "blur", params: { focusMode: "band" } }] }, 0)).toEqual([]);
    expect(validateSegmentFx({ effects: [{ kind: "blur", params: { focusMode: "radial" } }] }, 0)).toEqual([]);
  });
});
