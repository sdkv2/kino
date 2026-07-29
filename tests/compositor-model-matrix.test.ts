import { describe, it, expect } from "vitest";
import { modelMatrix } from "../src/render/native/page/compositor/renderer.js";
import { IDENTITY_TRANSFORM, type LayerTransform } from "../src/render/native/page/compositor/graph.js";

const rect = { x: 100, y: 200, w: 400, h: 300 };
const m = (transform: LayerTransform) => Array.from(modelMatrix({ rect, transform } as never));

/** The pre-change implementation, kept verbatim as the oracle for the identity claim. */
function legacyMatrix(t: LayerTransform): number[] {
  const { x, y, w, h } = rect;
  const rad = (t.rotate * Math.PI) / 180;
  const cos = Math.cos(rad) * t.scale;
  const sin = Math.sin(rad) * t.scale;
  const cx = x + w / 2 + t.translate[0];
  const cy = y + h / 2 + t.translate[1];
  const a = cos * w, b = sin * w;
  const c = -sin * h, d = cos * h;
  return [a, b, 0, c, d, 0, cx - (a + c) / 2, cy - (b + d) / 2, 1];
}

describe("modelMatrix is unchanged when the new channels are absent", () => {
  const cases: LayerTransform[] = [
    IDENTITY_TRANSFORM,
    { scale: 1.4, rotate: 0, translate: [0, 0] },
    { scale: 1, rotate: 30, translate: [0, 0] },
    { scale: 0.6, rotate: -12.5, translate: [40, -90] },
    { scale: 2, rotate: 180, translate: [-15, 15] },
  ];
  // modelMatrix returns a Float32Array and the oracle computes in float64, so the two agree only
  // to float32 precision (~7 significant digits — an ULP of ~3e-5 at a magnitude of a few hundred).
  // A relative bound is the honest comparison: an absolute toBeCloseTo(_, 6) would be asserting
  // below the storage precision and would fail on rotations for that reason alone.
  const agrees = (got: number, want: number) =>
    expect(Math.abs(got - want)).toBeLessThanOrEqual(Math.max(1e-9, Math.abs(want) * 1e-6));

  for (const t of cases) {
    it(`matches the legacy matrix for ${JSON.stringify(t)}`, () => {
      const got = m(t);
      const want = legacyMatrix(t);
      for (let i = 0; i < 9; i++) agrees(got[i], want[i]);
    });
  }
});

/** Map a point in unit-quad space (0..1 across the rect) through the matrix. */
const apply = (mat: number[], u: number, v: number): [number, number] => [
  mat[0] * u + mat[3] * v + mat[6],
  mat[1] * u + mat[4] * v + mat[7],
];

describe("anchor is the fixed point of scale and rotation", () => {
  it("scaling about the top-left leaves the top-left corner where it was", () => {
    const scaled = m({ scale: 2, rotate: 0, translate: [0, 0], anchor: [0, 0] });
    expect(apply(scaled, 0, 0)[0]).toBeCloseTo(rect.x, 5);
    expect(apply(scaled, 0, 0)[1]).toBeCloseTo(rect.y, 5);
  });

  it("scaling about the top-left pushes the bottom-right out by the scale factor", () => {
    const scaled = m({ scale: 2, rotate: 0, translate: [0, 0], anchor: [0, 0] });
    expect(apply(scaled, 1, 1)[0]).toBeCloseTo(rect.x + rect.w * 2, 5);
    expect(apply(scaled, 1, 1)[1]).toBeCloseTo(rect.y + rect.h * 2, 5);
  });

  it("rotating 90° about the rect centre keeps the centre fixed", () => {
    const rotated = m({ scale: 1, rotate: 90, translate: [0, 0], anchor: [0.5, 0.5] });
    expect(apply(rotated, 0.5, 0.5)[0]).toBeCloseTo(rect.x + rect.w / 2, 5);
    expect(apply(rotated, 0.5, 0.5)[1]).toBeCloseTo(rect.y + rect.h / 2, 5);
  });

  it("translate still offsets the anchor position", () => {
    const moved = m({ scale: 1, rotate: 0, translate: [25, -40], anchor: [0, 0] });
    expect(apply(moved, 0, 0)[0]).toBeCloseTo(rect.x + 25, 5);
    expect(apply(moved, 0, 0)[1]).toBeCloseTo(rect.y - 40, 5);
  });
});

describe("per-axis scale", () => {
  it("scaleX stretches width only", () => {
    const wide = m({ scale: 1, rotate: 0, translate: [0, 0], scaleX: 3, anchor: [0, 0] });
    expect(apply(wide, 1, 1)[0]).toBeCloseTo(rect.x + rect.w * 3, 5);
    expect(apply(wide, 1, 1)[1]).toBeCloseTo(rect.y + rect.h, 5);
  });

  it("scaleY multiplies on top of the uniform scale", () => {
    const tall = m({ scale: 2, rotate: 0, translate: [0, 0], scaleY: 1.5, anchor: [0, 0] });
    expect(apply(tall, 1, 1)[1]).toBeCloseTo(rect.y + rect.h * 3, 5);
  });
});
