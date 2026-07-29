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
    expect(validateLayers([{ ...ok, id: "logo" }], 1).join()).toMatch(/reserved/);
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
});
