// Rasterize SVG / clip-path silhouettes for kino-glass (alpha mask → lens SDF in the mirror shader).

export const SHAPE_CLASS = "kino-glass-shape";

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
export function resolveGlassShapePlan(el: HTMLElement, w: number, h: number): ShapePlan | null {
  const svg = el.querySelector<SVGSVGElement>(`:scope > svg.${SHAPE_CLASS}`);
  if (svg) return planFromSvg(svg, el, w, h);
  const cssPaths = planFromCssPaths(el, w, h);
  if (cssPaths) return cssPaths;
  const clip = planFromClipPathCss(el, w, h);
  if (clip) return clip;
  return null;
}

export function findGlassShapeSvg(el: HTMLElement): SVGSVGElement | null {
  return el.querySelector<SVGSVGElement>(`:scope > svg.${SHAPE_CLASS}`);
}

/** White-filled alpha mask at mirror resolution (SS included). Reads live DOM (SMIL / CSS morph). */
export function rasterGlassShapeMask(
  el: HTMLElement,
  w: number,
  h: number,
  ss: number,
): HTMLCanvasElement | null {
  const plan = resolveGlassShapePlan(el, w, h);
  if (!plan) return null;

  plan.scrub?.();

  const pw = w * ss;
  const ph = h * ss;
  const canvas = document.createElement("canvas");
  canvas.width = pw;
  canvas.height = ph;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const { vb } = plan;
  ctx.clearRect(0, 0, pw, ph);
  ctx.fillStyle = "#ffffff";
  ctx.setTransform(pw / vb.w, 0, 0, ph / vb.h, (-vb.x * pw) / vb.w, (-vb.y * ph) / vb.h);
  return plan.draw(ctx) ? canvas : null;
}
