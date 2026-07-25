import { describe, it, expect } from "vitest";
import { shapeDistance, type ShapeMask } from "../src/render/shapes.js";

const rect: ShapeMask = { kind: "rect", x: 100, y: 100, w: 200, h: 100 };
const rounded: ShapeMask = { ...rect, radius: 20 };
const circle: ShapeMask = { kind: "circle", x: 100, y: 100, w: 200, h: 200 };

describe("shapeDistance — rect", () => {
  it("is negative at the center", () => {
    expect(shapeDistance(rect, 200, 150)).toBeLessThan(0);
  });

  it("is zero on the edge", () => {
    expect(shapeDistance(rect, 100, 150)).toBeCloseTo(0, 5);
  });

  it("equals the perpendicular gap outside an edge", () => {
    expect(shapeDistance(rect, 70, 150)).toBeCloseTo(30, 5);
  });

  it("equals the diagonal gap outside a corner", () => {
    // 30 left and 40 above the top-left corner → 50 by Pythagoras.
    expect(shapeDistance(rect, 70, 60)).toBeCloseTo(50, 5);
  });

  it("rounds the corner when radius is set", () => {
    // A rounded corner pushes the boundary inward toward the center, so a point inside near the corner is closer to the boundary.
    expect(shapeDistance(rounded, 110, 110)).toBeGreaterThan(shapeDistance(rect, 110, 110));
  });
});

describe("shapeDistance — circle", () => {
  it("is -r at the center", () => {
    expect(shapeDistance(circle, 200, 200)).toBeCloseTo(-100, 5);
  });

  it("is zero on the rim", () => {
    expect(shapeDistance(circle, 300, 200)).toBeCloseTo(0, 5);
  });

  it("is the radial gap outside", () => {
    expect(shapeDistance(circle, 350, 200)).toBeCloseTo(50, 5);
  });
});

describe("shapeDistance — ellipse", () => {
  it("is zero on both axes' extremes", () => {
    const e: ShapeMask = { kind: "ellipse", x: 0, y: 0, w: 200, h: 100 };
    expect(shapeDistance(e, 200, 50)).toBeCloseTo(0, 1);
    expect(shapeDistance(e, 100, 100)).toBeCloseTo(0, 1);
  });
});

describe("shapeDistance — rotation", () => {
  it("rotates the shape, not the sample point's frame", () => {
    const r: ShapeMask = { kind: "rect", x: 100, y: 150, w: 200, h: 20, rotate: 90 };
    // Rotated 90°, the thin bar runs vertically through the center.
    expect(shapeDistance(r, 200, 160)).toBeLessThan(0);
    expect(shapeDistance(r, 260, 160)).toBeGreaterThan(0);
  });
});
