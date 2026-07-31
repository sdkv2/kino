// `spec.layers` was `z.unknown()` — every structural mistake in a declared layer (a misspelled
// field, a typo'd tween channel, a source with no `src`) reached the renderer and did nothing
// visible. The Zod schema now owns SHAPE; validateLayers still owns SEMANTICS. These tests pin the
// split as much as the checks: neither validator should start answering the other's question.
import { describe, it, expect } from "vitest";
import { parseSpec } from "../src/spec/schema.js";
import { validateLayers } from "../src/render/layerSpec.js";

const withLayers = (layers: unknown[]) => ({
  title: "probe",
  format: ["9:16"],
  segments: [{ text: "hi", dur: 2 }],
  layers,
});
const layer = (extra: Record<string, unknown> = {}) => ({
  id: "card",
  z: 950,
  source: { kind: "motion", src: "motion/card.html" },
  ...extra,
});

describe("declared layer shape", () => {
  it("accepts the real-world shape", () => {
    // Taken from projects/render-primitives-demo — beat-bound, with a transform tween.
    expect(() =>
      parseSpec(
        withLayers([
          layer({
            segment: 3,
            keyframes: [
              { at: 0, params: { scale: 0.18, rotate: -14, anchorX: 0.88, anchorY: 0.46, opacity: 0 } },
              { at: 2.1, params: { scale: 1, rotate: 0, opacity: 1 }, ease: "easeOutQuart" },
            ],
          }),
        ]),
      ),
    ).not.toThrow();
  });

  it("rejects a misspelled layer field instead of ignoring it", () => {
    expect(() => parseSpec(withLayers([layer({ fromsec: 1 })]))).toThrow(
      /layers\[0\]: unrecognized key 'fromsec' — did you mean 'fromSec'\?/,
    );
  });

  it("catches a transposed field name", () => {
    expect(() => parseSpec(withLayers([layer({ opactiy: 0.5 })]))).toThrow(/did you mean 'opacity'\?/);
  });

  it("rejects a misspelled source field", () => {
    expect(() => parseSpec(withLayers([{ id: "c", z: 950, source: { kind: "motion", srcs: "a.html" } }]))).toThrow(
      /layers\[0\]\.source: unrecognized key 'srcs' — did you mean 'src'\?/,
    );
  });

  it("requires id and z", () => {
    expect(() => parseSpec(withLayers([{ source: { kind: "motion", src: "a.html" } }]))).toThrow(/id/);
    expect(() => parseSpec(withLayers([{ id: "c", source: { kind: "motion", src: "a.html" } }]))).toThrow(/z/);
  });

  it("rejects an unknown source kind", () => {
    expect(() => parseSpec(withLayers([{ id: "c", z: 950, source: { kind: "gif", src: "a.gif" } }]))).toThrow();
  });

  it("closes the rect", () => {
    expect(() => parseSpec(withLayers([layer({ rect: { x: 0, y: 0, w: 10, hh: 10 } })]))).toThrow();
  });
});

describe("declared layer tween channels", () => {
  it("rejects a typo'd channel on the layer's own track", () => {
    expect(() => parseSpec(withLayers([layer({ keyframes: [{ at: 0, params: { rotat: 4 } }] })]))).toThrow(
      /unrecognized tween param 'rotat' — did you mean 'rotate'\?/,
    );
  });

  it("leaves the SOURCE's params open — those are the provider's own knobs", () => {
    const src = { kind: "shader", src: "s.frag", params: { myKnob: 3 }, keyframes: [{ at: 0, params: { myKnob: 9 } }] };
    expect(() => parseSpec(withLayers([{ id: "c", z: 950, source: src }]))).not.toThrow();
  });
});

describe("the shape/semantics split holds", () => {
  const reservedZ = withLayers([layer({ z: 0 })]); // 0 is Z.backdrop — a built-in slot

  it("Zod does not answer the semantic questions", () => {
    // A reserved z is structurally fine: a number where a number belongs.
    expect(() => parseSpec(reservedZ)).not.toThrow();
  });

  it("validateLayers still does", () => {
    expect(validateLayers(reservedZ.layers, 1).join("\n")).toMatch(/reserved for a built-in layer/);
  });

  it("mask, effects and adjust still reach their own validator untouched", () => {
    // Shape-valid here, so Zod passes them through; maskSpec.ts is what judges their contents.
    expect(() =>
      parseSpec(withLayers([layer({ mask: { source: { kind: "shape", shape: "circle" } }, effects: [{ kind: "blur", params: {} }] })])),
    ).not.toThrow();
    expect(validateLayers([{ id: "c", z: 950, adjust: [{ kind: "nonsense" }] }], 1).join("\n")).toMatch(
      /unknown adjust kind/,
    );
  });
});
