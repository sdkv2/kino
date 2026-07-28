// Rasterize SVG / clip-path silhouettes for kino-lens → chamfer SDF in R (opaque RGBA).

import { LENS_SHAPE_CLASS } from "../../lensContract.js";

export const SHAPE_CLASS = LENS_SHAPE_CLASS;

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ShapePlan {
  vb: ViewBox;
  draw: (ctx: CanvasRenderingContext2D) => boolean;
  scrub?: () => void;
}


function cssVar(el: HTMLElement, name: string, fallback: number): number {
  const v = parseFloat(getComputedStyle(el).getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
}

/** Numeric lerp between two SVG path `d` strings (same command count). */
export function lerpPathD(d0: string, d1: string, t: number): string {
  const re = /-?[\d.]+(?:e[-+]?\d+)?/gi;
  const n0 = [...d0.matchAll(re)].map((m) => parseFloat(m[0]));
  const n1 = [...d1.matchAll(re)].map((m) => parseFloat(m[0]));
  if (n0.length !== n1.length || n0.length === 0) return t < 0.5 ? d0 : d1;
  let i = 0;
  return d0.replace(re, () => {
    const v = n0[i] + (n1[i] - n0[i]) * t;
    i++;
    return String(v);
  });
}

/** Sample `<animate attributeName="d">` at normalized time 0..1 (Chromium SMIL setCurrentTime is inert). */
export function samplePathAnimate(path: Element, t: number): string | null {
  const anim = path.querySelector("animate[attributeName='d'], animate[attributeName=\"d\"]");
  if (!anim) return null;
  const values = anim.getAttribute("values")?.split(";").map((s) => s.trim()).filter(Boolean);
  if (!values?.length) return null;
  if (values.length === 1) return values[0];

  const clamp = Math.min(1, Math.max(0, t));
  const kt = anim.getAttribute("keyTimes")?.split(";").map(parseFloat).filter(Number.isFinite);
  const times = kt && kt.length === values.length
    ? kt
    : values.map((_, i) => i / (values.length - 1));

  let seg = 0;
  while (seg < times.length - 2 && clamp > times[seg + 1]) seg++;
  const t0 = times[seg];
  const t1 = times[seg + 1] ?? 1;
  const local = t1 > t0 ? (clamp - t0) / (t1 - t0) : 0;
  return lerpPathD(values[seg], values[seg + 1] ?? values[seg], local);
}

function shapeHost(el: HTMLElement): HTMLElement {
  return el.getRootNode() instanceof ShadowRoot ? ((el.getRootNode() as ShadowRoot).host as HTMLElement) : el;
}

function shapeMorphProgress(el: HTMLElement): number {
  return Math.min(1, Math.max(0, cssVar(shapeHost(el), "--progress", 0)));
}

function resolveMorphT(el: HTMLElement): number {
  const morph = cssVar(el, "--glass-morph", -1);
  if (morph >= 0) return Math.min(1, Math.max(0, morph));
  return shapeMorphProgress(el);
}

function resolveId(root: Node, id: string): Element | null {
  const tree = root instanceof ShadowRoot ? root : root.getRootNode();
  if (tree instanceof ShadowRoot || tree instanceof Document) {
    return tree.getElementById(id);
  }
  return document.getElementById(id);
}

function parseViewBox(raw: string | null, fallbackW: number, fallbackH: number): ViewBox {
  if (!raw) return { x: 0, y: 0, w: fallbackW, h: fallbackH };
  const p = raw.trim().split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
  if (p.length === 4) return { x: p[0], y: p[1], w: p[2], h: p[3] };
  return { x: 0, y: 0, w: fallbackW, h: fallbackH };
}

function strokeW(node: Element): number {
  const sw = node.getAttribute("stroke-width") || getComputedStyle(node).strokeWidth;
  const n = parseFloat(sw);
  return Number.isFinite(n) ? n : 0;
}

function paintPath(ctx: CanvasRenderingContext2D, d: string, node?: Element): boolean {
  let path: Path2D;
  try {
    path = new Path2D(d);
  } catch {
    return false;
  }
  const fill = node?.getAttribute("fill") ?? (node ? getComputedStyle(node as Element).fill : "none");
  const stroke = node?.getAttribute("stroke") ?? (node ? getComputedStyle(node as Element).stroke : "none");
  const sw = node ? strokeW(node) : 0;
  let drew = false;
  if (fill && fill !== "none") {
    ctx.fill(path);
    drew = true;
  }
  if ((!drew || sw > 0) && stroke && stroke !== "none" && sw > 0) {
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = sw;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke(path);
    ctx.restore();
    drew = true;
  }
  if (!drew) {
    ctx.fill(path);
    drew = true;
  }
  return drew;
}

function drawShapeNodes(ctx: CanvasRenderingContext2D, root: ParentNode, morphT?: number): boolean {
  let drew = false;
  for (const path of Array.from(root.querySelectorAll("path"))) {
    const d = (morphT != null ? samplePathAnimate(path, morphT) : null) ?? path.getAttribute("d");
    if (d && paintPath(ctx, d, path)) drew = true;
  }
  for (const circle of Array.from(root.querySelectorAll("circle"))) {
    const cx = parseFloat(circle.getAttribute("cx") || "0");
    const cy = parseFloat(circle.getAttribute("cy") || "0");
    const r = parseFloat(circle.getAttribute("r") || "0");
    if (r <= 0) continue;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    drew = true;
  }
  for (const rect of Array.from(root.querySelectorAll("rect"))) {
    const x = parseFloat(rect.getAttribute("x") || "0");
    const y = parseFloat(rect.getAttribute("y") || "0");
    const rw = parseFloat(rect.getAttribute("width") || "0");
    const rh = parseFloat(rect.getAttribute("height") || "0");
    if (rw <= 0 || rh <= 0) continue;
    ctx.fillRect(x, y, rw, rh);
    drew = true;
  }
  for (const ellipse of Array.from(root.querySelectorAll("ellipse"))) {
    const cx = parseFloat(ellipse.getAttribute("cx") || "0");
    const cy = parseFloat(ellipse.getAttribute("cy") || "0");
    const rx = parseFloat(ellipse.getAttribute("rx") || "0");
    const ry = parseFloat(ellipse.getAttribute("ry") || "0");
    if (rx <= 0 || ry <= 0) continue;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    drew = true;
  }
  for (const poly of Array.from(root.querySelectorAll("polygon,polyline"))) {
    const pts = poly.getAttribute("points");
    if (!pts) continue;
    const nums = pts.trim().split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
    if (nums.length < 4) continue;
    ctx.beginPath();
    ctx.moveTo(nums[0], nums[1]);
    for (let i = 2; i + 1 < nums.length; i += 2) ctx.lineTo(nums[i], nums[i + 1]);
    if (poly.tagName.toLowerCase() === "polygon") ctx.closePath();
    const sw = strokeW(poly);
    if (poly.getAttribute("fill") === "none" && sw > 0) {
      ctx.lineWidth = sw;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    } else {
      ctx.fill();
    }
    drew = true;
  }
  return drew;
}

function planFromSvg(svg: SVGSVGElement, el: HTMLElement, w: number, h: number): ShapePlan {
  const vb = parseViewBox(svg.getAttribute("viewBox"), w, h);
  let morphT = 0;
  return {
    vb,
    scrub: () => { morphT = shapeMorphProgress(el); },
    draw: (ctx) => drawShapeNodes(ctx, svg, morphT),
  };
}

function planFromClipPath(clip: SVGClipPathElement, el: HTMLElement, w: number, h: number): ShapePlan {
  const units = clip.getAttribute("clipPathUnits") || "userSpaceOnUse";
  const objectBox = units === "objectBoundingBox";
  const vb: ViewBox = objectBox ? { x: 0, y: 0, w: 1, h: 1 } : { x: 0, y: 0, w, h };
  return {
    vb,
    draw: (ctx) => drawShapeNodes(ctx, clip),
  };
}

function planFromClipPathCss(el: HTMLElement, w: number, h: number): ShapePlan | null {
  const cs = getComputedStyle(el);
  const cp = cs.clipPath || (cs as CSSStyleDeclaration & { webkitClipPath?: string }).webkitClipPath || "";
  if (!cp || cp === "none") return null;

  const url = cp.match(/url\(["']?#([^"')]+)["']?\)/);
  if (url) {
    const ref = resolveId(el, url[1]);
    if (ref instanceof SVGClipPathElement) return planFromClipPath(ref, el, w, h);
  }

  const pathFn = cp.match(/path\(["']([^"']+)["']\)/);
  if (pathFn) {
    const d = pathFn[1];
    return {
      vb: { x: 0, y: 0, w, h },
      draw: (ctx) => paintPath(ctx, d),
    };
  }

  return null;
}

function unquoteCssPath(raw: string): string {
  const s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}

function planFromCssPaths(el: HTMLElement, w: number, h: number): ShapePlan | null {
  const cs = getComputedStyle(el);
  const from = unquoteCssPath(cs.getPropertyValue("--glass-path-from"));
  const to = unquoteCssPath(cs.getPropertyValue("--glass-path-to"));
  if (from && to) {
    let morphT = 0;
    return {
      vb: parseViewBox(cs.getPropertyValue("--glass-viewbox"), 100, 100),
      scrub: () => { morphT = resolveMorphT(el); },
      draw: (ctx) => paintPath(ctx, lerpPathD(from, to, morphT)),
    };
  }
  const single = unquoteCssPath(cs.getPropertyValue("--glass-path"));
  if (single) {
    const vb = parseViewBox(cs.getPropertyValue("--glass-viewbox"), 100, 100);
    return { vb, draw: (ctx) => paintPath(ctx, single) };
  }
  return null;
}

/** Resolve silhouette source: child svg → CSS path morph → clip-path url/path → --glass-path. */
export function resolveLensShapePlan(el: HTMLElement, w: number, h: number): ShapePlan | null {
  const svg = el.querySelector<SVGSVGElement>(`:scope > svg.${SHAPE_CLASS}`);
  if (svg) return planFromSvg(svg, el, w, h);
  const cssPaths = planFromCssPaths(el, w, h);
  if (cssPaths) return cssPaths;
  const clip = planFromClipPathCss(el, w, h);
  if (clip) return clip;
  // ponytail: no analytic asymmetric border-radius bake — 8-bit chamfer SDF fans
  // refraction into wedges. Authors use uniform radius; outer-only look via plate overlap.
  return null;
}

export function findLensShapeSvg(el: HTMLElement): SVGSVGElement | null {
  return el.querySelector<SVGSVGElement>(`:scope > svg.${SHAPE_CLASS}`);
}

/** Decode scale for R-channel SDF. Sized to the lens, not the diagonal (keeps 8-bit precision). */
export function shapeSdfMax(cssW: number, cssH: number): number {
  return Math.max(64, Math.min(cssW, cssH) * 0.55);
}

/** 2-pass chamfer DT. `seedZero[i]` true → distance 0. Returns dist in cells. */
export function chamferDistance(seedZero: Uint8Array, w: number, h: number): Float32Array {
  const d = new Float32Array(w * h);
  const INF = w + h;
  for (let i = 0; i < d.length; i++) d[i] = seedZero[i] ? 0 : INF;
  const ortho = 1;
  const diag = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + ortho);
      if (y > 0) v = Math.min(v, d[i - w] + ortho);
      if (x > 0 && y > 0) v = Math.min(v, d[i - w - 1] + diag);
      if (x < w - 1 && y > 0) v = Math.min(v, d[i - w + 1] + diag);
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + ortho);
      if (y < h - 1) v = Math.min(v, d[i + w] + ortho);
      if (x < w - 1 && y < h - 1) v = Math.min(v, d[i + w + 1] + diag);
      if (x > 0 && y < h - 1) v = Math.min(v, d[i + w - 1] + diag);
      d[i] = v;
    }
  }
  return d;
}

/**
 * Pack signed distance into R (IQ: sd>0 outside, <0 inside; 0.5 = edge,
 * >0.5 outside, <0.5 inside). A keeps binary silhouette. Units: CSS px.
 */
export function encodeShapeSdf(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  ss: number,
  maxDistCss: number,
): void {
  const n = w * h;
  const outside = new Uint8Array(n);
  const inside = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const on = rgba[i * 4 + 3] > 128 ? 1 : 0;
    outside[i] = on ? 0 : 1;
    inside[i] = on;
  }
  const dout = chamferDistance(outside, w, h); // dist → outside (0 outside)
  const din = chamferDistance(inside, w, h); // dist → inside (0 inside)
  const inv = maxDistCss > 1e-6 ? 0.5 / maxDistCss : 0;
  const cell = ss > 0 ? 1 / ss : 1;
  for (let i = 0; i < n; i++) {
    const sdCss = (din[i] - dout[i]) * cell;
    const e = 0.5 + Math.max(-0.5, Math.min(0.5, sdCss * inv));
    const o = i * 4;
    const r = Math.round(e * 255);
    rgba[o] = r;
    rgba[o + 1] = r;
    rgba[o + 2] = r;
    // Opaque — canvas→WebGL premultiply zeroes RGB when A=0 and kills exterior SDF.
    rgba[o + 3] = 255;
  }
}

/** White-filled alpha mask at mirror resolution (SS included). Reads live DOM (SMIL / CSS morph). */
export function rasterLensShapeMask(
  el: HTMLElement,
  w: number,
  h: number,
  ss: number,
): HTMLCanvasElement | null {
  const plan = resolveLensShapePlan(el, w, h);
  if (!plan) return null;

  plan.scrub?.();

  const pw = Math.max(1, Math.round(w * ss));
  const ph = Math.max(1, Math.round(h * ss));
  const canvas = document.createElement("canvas");
  canvas.width = pw;
  canvas.height = ph;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  const { vb } = plan;
  ctx.clearRect(0, 0, pw, ph);
  ctx.fillStyle = "#ffffff";
  ctx.setTransform(pw / vb.w, 0, 0, ph / vb.h, (-vb.x * pw) / vb.w, (-vb.y * ph) / vb.h);
  if (!plan.draw(ctx)) return null;

  // Binary alpha is flat inside → gradient SDF ≈ 0 → no bend. Bake chamfer SDF into R.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const img = ctx.getImageData(0, 0, pw, ph);
  encodeShapeSdf(img.data, pw, ph, ss, shapeSdfMax(w, h));
  ctx.putImageData(img, 0, 0);
  return canvas;
}
