// Analytic signed distance for shape masks. Negative inside, zero on the boundary, positive
// outside, in frame pixels.
//
// This is the reference implementation. The GLSL in masks.ts is a port of it, and
// tests/compositor-shape-mask.test.ts asserts the two agree — a divergence would show up as a
// mask whose feather does not match its authored radius.
export type ShapeKind = "rect" | "circle" | "ellipse";

export interface ShapeMask {
  kind: ShapeKind;
  /** Top-left of the shape's bounding box, in frame px. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corner radius for "rect", in px. Ignored by circle/ellipse. */
  radius?: number;
  /** Degrees, about the shape's own center. */
  rotate?: number;
}

/** Rotate (px,py) into the shape's local frame, centered on the shape. */
function toLocal(shape: ShapeMask, px: number, py: number): [number, number] {
  const cx = shape.x + shape.w / 2;
  const cy = shape.y + shape.h / 2;
  const dx = px - cx;
  const dy = py - cy;
  const deg = shape.rotate ?? 0;
  if (!deg) return [dx, dy];
  const rad = (-deg * Math.PI) / 180; // inverse rotation: shape rotates, sample does not
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [dx * cos - dy * sin, dx * sin + dy * cos];
}

/** Inigo Quilez's rounded-box SDF. */
function roundedBox(px: number, py: number, hw: number, hh: number, r: number): number {
  const rr = Math.min(r, Math.min(hw, hh));
  const qx = Math.abs(px) - hw + rr;
  const qy = Math.abs(py) - hh + rr;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - rr;
}

export function shapeDistance(shape: ShapeMask, px: number, py: number): number {
  const [lx, ly] = toLocal(shape, px, py);
  const hw = shape.w / 2;
  const hh = shape.h / 2;

  if (shape.kind === "rect") return roundedBox(lx, ly, hw, hh, shape.radius ?? 0);
  if (shape.kind === "circle") return Math.hypot(lx, ly) - Math.min(hw, hh);

  // Ellipse: no closed form. One Newton step on the scaled-circle approximation, which is
  // exact on the axes and within a fraction of a pixel elsewhere — well inside what an 8-bit
  // feather resolves.
  const k1 = Math.hypot(lx / hw, ly / hh);
  if (k1 === 0) return -Math.min(hw, hh);
  const k2 = Math.hypot(lx / (hw * hw), ly / (hh * hh));
  return (k1 * (k1 - 1)) / k2;
}
