// GPU-resident kino-glass compositing: layer FBO out, no card readPixels or final canvas upload.
import type { BackdropTexture } from "../backdrop.js";
import { acquireGpuFbo, blitTexture, uploadCanvas, type GpuFbo } from "../gpuBlit.js";
import { renderGlassMirrorFbo } from "../liquidGlass.js";
import { SHAPE_CLASS } from "../glassShape.js";

export interface GpuGlassLayer {
  kind: "gpu";
  tex: WebGLTexture;
  w: number;
  h: number;
}

function blitRegion(
  gl: WebGL2RenderingContext,
  dst: GpuFbo,
  srcTex: WebGLTexture,
  flipY: 0 | 1,
  texW: number,
  texH: number,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): void {
  blitTexture(gl, dst, srcTex, flipY, sx, sy, sw, sh, sx, sy, sw, sh, texW, texH);
}

function isGlassChromeChild(child: Element): boolean {
  return child.classList.contains("kino-glass-mirror") || child.classList.contains(SHAPE_CLASS);
}

function isTextLeaf(el: Element): boolean {
  return el.childElementCount === 0 && (el.textContent?.trim().length ?? 0) > 0;
}

function visibleText(el: HTMLElement, cs: CSSStyleDeclaration): string {
  let t = (el.textContent ?? "").trim();
  const tt = cs.textTransform;
  if (tt === "uppercase") t = t.toUpperCase();
  else if (tt === "lowercase") t = t.toLowerCase();
  else if (tt === "capitalize") t = t.replace(/\b\w/g, (c) => c.toUpperCase());
  return t;
}

let textScratch: HTMLCanvasElement | null = null;

function blitGlassChromeGpu(
  gl: WebGL2RenderingContext,
  dst: GpuFbo,
  base: HTMLCanvasElement,
  baseTex: WebGLTexture,
  el: HTMLElement,
  hr: DOMRect,
  s: number,
): void {
  const r = el.getBoundingClientRect();
  const x = Math.round((r.left - hr.left) * s);
  const y = Math.round((r.top - hr.top) * s);
  const w = Math.round(r.width * s);
  const h = Math.round(r.height * s);
  const cs = getComputedStyle(el);
  const bt = Math.round((parseFloat(cs.borderTopWidth) || 0) * s);
  const br = Math.round((parseFloat(cs.borderRightWidth) || 0) * s);
  const bb = Math.round((parseFloat(cs.borderBottomWidth) || 0) * s);
  const bl = Math.round((parseFloat(cs.borderLeftWidth) || 0) * s);
  const bw = base.width;
  const bh = base.height;

  const blitFromBase = (dx: number, dy: number, dw: number, dh: number) => {
    if (dw < 1 || dh < 1) return;
    blitRegion(gl, dst, baseTex, 0, bw, bh, dx, dy, dw, dh);
  };

  if (bt > 0) blitFromBase(x, y, w, bt);
  if (bb > 0) blitFromBase(x, y + h - bb, w, bb);
  if (bl > 0) blitFromBase(x, y, bl, h);
  if (br > 0) blitFromBase(x + w - br, y, br, h);

  for (const child of Array.from(el.children)) {
    if (isGlassChromeChild(child)) continue;
    if (isTextLeaf(child)) {
      const leaf = child as HTMLElement;
      const lcs = getComputedStyle(leaf);
      const lr = leaf.getBoundingClientRect();
      const tw = Math.max(1, Math.round(lr.width * s));
      const th = Math.max(1, Math.round(lr.height * s));
      if (!textScratch) textScratch = document.createElement("canvas");
      textScratch.width = tw;
      textScratch.height = th;
      const tctx = textScratch.getContext("2d")!;
      tctx.clearRect(0, 0, tw, th);
      tctx.save();
      tctx.font = lcs.font;
      tctx.textAlign = "center";
      tctx.textBaseline = "middle";
      if ("letterSpacing" in tctx) (tctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = lcs.letterSpacing;
      tctx.fillStyle = lcs.color;
      tctx.fillText(visibleText(leaf, lcs), tw / 2, th / 2);
      tctx.restore();
      const textTex = uploadCanvas(gl, textScratch);
      const dx = Math.round((lr.left - hr.left) * s);
      const dy = Math.round((lr.top - hr.top) * s);
      blitRegion(gl, dst, textTex, 0, tw, th, dx, dy, tw, th);
      continue;
    }
    const cr = child.getBoundingClientRect();
    const cx = Math.round((cr.left - hr.left) * s);
    const cy = Math.round((cr.top - hr.top) * s);
    const cw = Math.round(cr.width * s);
    const ch = Math.round(cr.height * s);
    blitFromBase(cx, cy, cw, ch);
  }
}

/** Compose base raster + GPU glass mirror + chrome on the compositor GL context (one canvas upload). */
export function compositeGlassLayerGpu(opts: {
  gl: WebGL2RenderingContext;
  base: HTMLCanvasElement;
  backdrop: Readonly<BackdropTexture>;
  el: HTMLElement;
  pageW: number;
  pageH: number;
  hostRect: DOMRect;
  stack: HTMLElement[];
}): GpuGlassLayer | null {
  const { gl, base, backdrop, el, pageW, pageH, hostRect, stack } = opts;
  const layerW = base.width;
  const layerH = base.height;
  if (layerW < 1 || layerH < 1) return null;

  const layer = acquireGpuFbo(gl, layerW, layerH, "glass-layer");
  const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  gl.bindFramebuffer(gl.FRAMEBUFFER, layer.fbo);
  gl.viewport(0, 0, layerW, layerH);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);

  const baseTex = uploadCanvas(gl, base);
  blitRegion(gl, layer, baseTex, 0, layerW, layerH, 0, 0, layerW, layerH);

  const mirror = renderGlassMirrorFbo(gl, backdrop, el, pageW, pageH, hostRect);
  if (!mirror) return null;

  const rect = el.getBoundingClientRect();
  const s = pageW > 0 ? layerW / pageW : 1;
  const dx = Math.round((rect.left - hostRect.left) * s);
  const dy = Math.round((rect.top - hostRect.top) * s);
  const dw = Math.round(rect.width * s);
  const dh = Math.round(rect.height * s);
  blitTexture(gl, layer, mirror.tex, 1, dx, dy, dw, dh, 0, 0, mirror.w, mirror.h, mirror.w, mirror.h);

  for (const chromeEl of stack) blitGlassChromeGpu(gl, layer, base, baseTex, chromeEl, hostRect, s);

  return { kind: "gpu", tex: layer.tex, w: layerW, h: layerH };
}
