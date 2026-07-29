import { describe, it, expect } from "vitest";
import { validateLayers } from "../src/render/layerSpec.js";
import { Z } from "../src/render/layers.js";

const ok = { id: "leak", source: { kind: "image", src: "fx/leak.png" }, z: 350 };

describe("validateLayers", () => {
  it("accepts a minimal declared layer", () => {
    expect(validateLayers([ok], 1)).toEqual([]);
  });

  it("rejects a duplicate id", () => {
    const errs = validateLayers([ok, { ...ok, z: 360 }], 1);
    expect(errs.join()).toMatch(/duplicate layer id "leak"/);
  });

  it("rejects an id that collides with a built-in", () => {
    expect(validateLayers([{ ...ok, id: "seg0" }], 1).join()).toMatch(/reserved/);
    expect(validateLayers([{ ...ok, id: "caption12" }], 1).join()).toMatch(/reserved/);
  });

  // "logo" is an ordinary declared-layer id now — the built-in logo system was removed and its
  // id reservation with it (see BUILTIN_ID_PATTERNS in layerSpec.ts).
  it("accepts \"logo\" as a declared layer id", () => {
    expect(validateLayers([{ ...ok, id: "logo" }], 1)).toEqual([]);
  });

  it('rejects "region{i}" — registry.ts registers it as the regionShader footage provider a seg{i} points at', () => {
    expect(validateLayers([{ ...ok, id: "region0" }], 1).join()).toMatch(/reserved/);
  });

  it("rejects a z that collides with a built-in constant", () => {
    const errs = validateLayers([{ ...ok, z: Z.caption }], 1);
    expect(errs.join()).toMatch(/z 1100 is reserved/);
  });

  it("rejects a missing or non-finite z", () => {
    expect(validateLayers([{ id: "a", source: ok.source }], 1).join()).toMatch(/z is required/);
    expect(validateLayers([{ ...ok, z: NaN }], 1).join()).toMatch(/z must be a finite number/);
  });

  it("rejects an unknown source kind and a missing src", () => {
    expect(validateLayers([{ ...ok, source: { kind: "hologram" } }], 1).join()).toMatch(/unknown layer source kind/);
    expect(validateLayers([{ ...ok, source: { kind: "image" } }], 1).join()).toMatch(/source\.src is required/);
  });

  it("rejects an unknown blend mode", () => {
    expect(validateLayers([{ ...ok, blend: "burn" }], 1).join()).toMatch(/blend must be one of/);
  });

  it("rejects an inverted time window", () => {
    expect(validateLayers([{ ...ok, fromSec: 5, toSec: 2 }], 1).join()).toMatch(/fromSec must be < toSec/);
  });

  it("rejects a segment index out of range and hold without segment", () => {
    expect(validateLayers([{ ...ok, segment: 3 }], 2).join()).toMatch(/segment 3 is out of range/);
    expect(validateLayers([{ ...ok, hold: true }], 2).join()).toMatch(/hold requires segment/);
  });

  it("rejects an adjust entry that also carries a source", () => {
    const errs = validateLayers([{ id: "f", z: 650, source: ok.source, adjust: [{ kind: "film", params: {} }] }], 1);
    expect(errs.join()).toMatch(/cannot have both source and adjust/);
  });

  it("names the offending layer in every message", () => {
    expect(validateLayers([{ ...ok, blend: "burn" }], 1)[0]).toMatch(/^layer "leak":/);
  });

  // Beyond the brief's given cases: branches the implementation has but the prescribed test
  // list above doesn't individually exercise.
  it("passes layers through unmodified when the field is absent, and rejects a non-array", () => {
    expect(validateLayers(undefined, 1)).toEqual([]);
    expect(validateLayers({}, 1)).toEqual(["spec.layers must be an array"]);
  });

  it("rejects a layer with neither source nor adjust", () => {
    expect(validateLayers([{ id: "x", z: 400 }], 1).join()).toMatch(/needs either a source or an adjust chain/);
  });

  // An empty `adjust: []` is not a real adjustment chain — `!l.adjust` alone (truthy for `[]`)
  // would let this slip past both the "needs either" check AND the ADJUST_INCOMPATIBLE_FIELDS
  // check, then fall through layersAt's `d.adjust?.length` guard into the pixel branch, emitting
  // `source: { providerId: "x" }` with nothing ever registered for it. Silent nothing.
  it("rejects a layer with an empty adjust array and no source", () => {
    expect(validateLayers([{ id: "x", z: 400, adjust: [] }], 1).join()).toMatch(/needs either a source or an adjust chain/);
  });

  it("rejects an unknown adjust kind that isn't the film exception", () => {
    const errs = validateLayers([{ id: "f", z: 650, adjust: [{ kind: "chroma", params: {} }] }], 1);
    expect(errs.join()).toMatch(/unknown adjust kind: chroma/);
  });

  it("rejects an unknown effect kind", () => {
    const errs = validateLayers([{ ...ok, effects: [{ kind: "bokeh", params: {} }] }], 1);
    expect(errs.join()).toMatch(/unknown effect kind: bokeh/);
  });

  it("rejects an opacity outside 0..1", () => {
    expect(validateLayers([{ ...ok, opacity: 1.5 }], 1).join()).toMatch(/opacity must be a number between 0 and 1/);
  });

  it("threads mask errors through with the layer label", () => {
    const errs = validateLayers([{ ...ok, mask: { source: { kind: "nope" } } }], 1);
    expect(errs.join()).toMatch(/^layer "leak": unknown mask source kind: nope/);
  });

  it('rejects a "file"-kind mask on a declared layer, naming the layer — same unbound-texture gap as a segment mask', () => {
    const errs = validateLayers(
      [{ ...ok, mask: { source: { kind: "file", src: "masks/subject/mask.png", channel: "r" } } }],
      1,
    );
    expect(errs.join()).toMatch(/^layer "leak":/);
    expect(errs.join()).toMatch(/mask\.source\.kind "file"/);
    expect(errs.join()).toMatch(/not supported/i);
  });

  // Carried from Task 6's review: `layersAt`'s adjustment branch (§11b) pushes only
  // id/z/source:null/adjust and `continue`s before any other DeclaredLayer field is read, so a
  // schema-valid layer combining `adjust` with one of these would validate clean and then be
  // silently ignored at render time. One test per field the emission branch drops.
  describe("rejects fields the adjustment branch silently ignores", () => {
    const grade = { id: "grade", z: 650, adjust: [{ kind: "grade" as const, params: { contrast: 1.2 } }] };

    it("accepts a plain adjustment layer with none of them", () => {
      expect(validateLayers([grade], 1)).toEqual([]);
    });

    it("rejects fromSec", () => {
      expect(validateLayers([{ ...grade, fromSec: 1 }], 1).join()).toMatch(/adjust cannot be combined with fromSec/);
    });

    it("rejects toSec", () => {
      expect(validateLayers([{ ...grade, toSec: 2 }], 1).join()).toMatch(/adjust cannot be combined with toSec/);
    });

    it("rejects segment", () => {
      expect(validateLayers([{ ...grade, segment: 0 }], 1).join()).toMatch(/adjust cannot be combined with segment/);
    });

    it("rejects hold", () => {
      expect(validateLayers([{ ...grade, hold: true }], 1).join()).toMatch(/adjust cannot be combined with hold/);
    });

    // Not named in the brief's list, but read straight off the same emission branch: `d.rect` is
    // never consulted for an adjust entry — `layersAt` hardcodes `rect: full` instead.
    it("rejects rect", () => {
      const errs = validateLayers([{ ...grade, rect: { x: 0, y: 0, w: 50, h: 50 } }], 1);
      expect(errs.join()).toMatch(/adjust cannot be combined with rect/);
    });

    it("rejects opacity", () => {
      expect(validateLayers([{ ...grade, opacity: 0.5 }], 1).join()).toMatch(/adjust cannot be combined with opacity/);
    });

    it("rejects mask", () => {
      const errs = validateLayers(
        [{ ...grade, mask: { source: { kind: "shape", shape: { kind: "circle", x: 0, y: 0, w: 10, h: 10 } } } }],
        1,
      );
      expect(errs.join()).toMatch(/adjust cannot be combined with mask/);
    });

    it("rejects effects", () => {
      const errs = validateLayers([{ ...grade, effects: [{ kind: "blur" as const, params: { radius: 4 } }] }], 1);
      expect(errs.join()).toMatch(/adjust cannot be combined with effects/);
    });

    it("rejects keyframes", () => {
      const errs = validateLayers([{ ...grade, keyframes: [{ at: 0, params: { opacity: 1 } }] }], 1);
      expect(errs.join()).toMatch(/adjust cannot be combined with keyframes/);
    });

    // Also not named in the brief's list: `blend` is likewise never set on the LayerDraw pushed
    // for an adjust entry, so it is exactly as silently dropped as the four named fields.
    it("rejects blend", () => {
      expect(validateLayers([{ ...grade, blend: "screen" as const }], 1).join()).toMatch(/adjust cannot be combined with blend/);
    });

    it("reports one error per offending field when several are combined", () => {
      const errs = validateLayers([{ ...grade, fromSec: 1, segment: 0 }], 1);
      expect(errs.filter((e) => /adjust cannot be combined with/.test(e))).toHaveLength(2);
    });
  });
});

describe("effect keyframe validation on declared layers", () => {
  // An adjustment layer carries no source — ADJUST_INCOMPATIBLE_FIELDS rejects the combination.
  const adjustLayer = (adjust: unknown[]) => ({ id: "grade", z: 650, adjust });

  it("names the layer and the effect index", () => {
    const errs = validateLayers(
      [{ ...ok, effects: [{ kind: "blur", params: {}, keyframes: [{ at: -3, params: { radius: 1 } }] }] }],
      1,
    );
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("effects[0].keyframes[0].at");
  });

  it("validates an adjust track too", () => {
    const errs = validateLayers(
      [adjustLayer([{ kind: "grade", params: {}, keyframes: [{ at: 1, params: "nope" }] }])],
      1,
    );
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("adjust[0].keyframes[0].params");
  });

  it("still accepts a film adjust entry with a keyframe track", () => {
    expect(
      validateLayers(
        [adjustLayer([{ kind: "film", params: { intensity: 1 }, keyframes: [{ at: 1, params: { intensity: 0.5 } }] }])],
        1,
      ),
    ).toEqual([]);
  });
});
