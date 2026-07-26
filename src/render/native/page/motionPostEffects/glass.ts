// kino-glass: per-element refraction mirrors after the base motion raster.
import { applyLiquidGlass } from "../liquidGlass.js";
import { SHAPE_CLASS } from "../glassShape.js";
import { peekBackdrop, peekBackdropTexture, registerBackdrop, registerMergedBackdrop } from "../backdrop.js";
import { KINO_DEFS, motionScrubCss } from "../motionCss.js";
import { compositeGlassLayerGpu } from "./glassGpu.js";
import type { MotionPostEffect, MotionPostResult } from "./types.js";

const GLASS_RE = /\bkino-glass\b/;
const SELECTOR = ".kino-glass";

function glassStackOrder(els: HTMLElement[]): HTMLElement[] {
  return [...els].sort((a, b) => {
    const za = parseInt(getComputedStyle(a).zIndex, 10);
    const zb = parseInt(getComputedStyle(b).zIndex, 10);
    const nza = Number.isFinite(za) ? za : 0;
    const nzb = Number.isFinite(zb) ? zb : 0;
    if (nza !== nzb) return nza - nzb;
    if (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) return 1;
    return 0;
  });
}

function blitRect(
  ctx: CanvasRenderingContext2D,
  base: HTMLCanvasElement,
  r: DOMRect,
  hr: DOMRect,
  s: number,
): void {
  const x = Math.round((r.left - hr.left) * s);
  const y = Math.round((r.top - hr.top) * s);
  const w = Math.round(r.width * s);
  const h = Math.round(r.height * s);
  if (w < 1 || h < 1) return;
  ctx.drawImage(base, x, y, w, h, x, y, w, h);
}

function visibleText(el: HTMLElement, cs: CSSStyleDeclaration): string {
  let t = (el.textContent ?? "").trim();
  const tt = cs.textTransform;
  if (tt === "uppercase") t = t.toUpperCase();
  else if (tt === "lowercase") t = t.toLowerCase();
  else if (tt === "capitalize") t = t.replace(/\b\w/g, (c) => c.toUpperCase());
  return t;
}

function paintTextLeaf(
  ctx: CanvasRenderingContext2D,
  el: HTMLElement,
  hr: DOMRect,
  s: number,
): void {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const x = (r.left - hr.left) * s + (r.width * s) / 2;
  const y = (r.top - hr.top) * s + (r.height * s) / 2;
  const text = visibleText(el, cs);
  if (!text) return;

  ctx.save();
  ctx.font = cs.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = cs.letterSpacing;
  // Solid fill only — drop-shadow from the base raster was baked against unrefracted
  // backdrop and reads as a boxy halo once composited over the mirror.
  ctx.fillStyle = cs.color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function isGlassChromeChild(child: Element): boolean {
  return child.classList.contains("kino-glass-mirror") || child.classList.contains(SHAPE_CLASS);
}

function isTextLeaf(el: Element): boolean {
  return el.childElementCount === 0 && (el.textContent?.trim().length ?? 0) > 0;
}

/** Base raster with glass labels punched back to the field beneath (mirror must not sample text). */
function stripGlassLabelsFromBase(
  base: HTMLCanvasElement,
  stack: HTMLElement[],
  hr: DOMRect,
  s: number,
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = base.width;
  c.height = base.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(base, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const data = img.data;
  const stride = c.width;
  for (const el of stack) {
    for (const child of Array.from(el.children)) {
      if (isGlassChromeChild(child)) continue;
      const cr = child.getBoundingClientRect();
      const x0 = Math.round((cr.left - hr.left) * s);
      const y0 = Math.round((cr.top - hr.top) * s);
      const w = Math.round(cr.width * s);
      const h = Math.round(cr.height * s);
      const refY = Math.max(0, y0 - 1);
      for (let row = 0; row < h; row++) {
        const gy = y0 + row;
        for (let col = 0; col < w; col++) {
          const gx = x0 + col;
          const i = (gy * stride + gx) * 4;
          if (data[i + 3] < 40) continue;
          const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          if (luma < 160) continue;
          const ri = (refY * stride + gx) * 4;
          data[i] = data[ri];
          data[i + 1] = data[ri + 1];
          data[i + 2] = data[ri + 2];
          data[i + 3] = data[ri + 3];
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Re-paint chrome above the mirror without restoring the unrefracted backdrop in the glass body. */
function blitGlassChrome(
  ctx: CanvasRenderingContext2D,
  base: HTMLCanvasElement,
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
  if (bt > 0) ctx.drawImage(base, x, y, w, bt, x, y, w, bt);
  if (bb > 0) ctx.drawImage(base, x, y + h - bb, w, bb, x, y + h - bb, w, bb);
  if (bl > 0) ctx.drawImage(base, x, y, bl, h, x, y, bl, h);
  if (br > 0) ctx.drawImage(base, x + w - br, y, br, h, x + w - br, y, br, h);
  for (const child of Array.from(el.children)) {
    if (isGlassChromeChild(child)) continue;
    if (isTextLeaf(child)) paintTextLeaf(ctx, child as HTMLElement, hr, s);
    else blitRect(ctx, base, child.getBoundingClientRect(), hr, s);
  }
}

export const glassPostEffect: MotionPostEffect = {
  test: (html) => GLASS_RE.test(html),
  apply({ base, html, vars, width, height, gl }): MotionPostResult {
    const host = document.createElement("div");
    host.style.cssText = `position:absolute;left:-99999px;top:0;width:${width}px;height:${height}px;visibility:hidden`;
    for (const [k, v] of Object.entries(vars)) host.style.setProperty(k, v);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${motionScrubCss(":host")}</style>${KINO_DEFS}${html}`;
    document.body.appendChild(host);

    const s = width > 0 ? base.width / width : 1;
    const hr = host.getBoundingClientRect();
    const stack = glassStackOrder(Array.from(shadow.querySelectorAll<HTMLElement>(SELECTOR)));
    const underCompositor = peekBackdrop();
    const underCompositorTex = peekBackdropTexture();
    const gpuBackdrop = Boolean(gl && underCompositorTex && stack.length === 1);
    if (gpuBackdrop) {
      // Mirror samples the compositor backdrop texture, not the motion raster — no label punch
      // or second canvas upload. One base upload + GPU mirror + chrome blits from the same tex.
      const gpu = compositeGlassLayerGpu({
        gl: gl!,
        base,
        backdrop: underCompositorTex!,
        el: stack[0],
        pageW: width,
        pageH: height,
        hostRect: hr,
        stack,
      });
      host.remove();
      if (gpu) return gpu;
    }

    const labelFree = stripGlassLabelsFromBase(base, stack, hr, s);
    const out = document.createElement("canvas");
    out.width = base.width;
    out.height = base.height;
    const ctx = out.getContext("2d");
    if (!ctx) {
      host.remove();
      return base;
    }
    ctx.drawImage(labelFree, 0, 0);
    let stackBackdrop: HTMLCanvasElement | null = null;
    for (let n = 0; n < stack.length; n++) {
      if (n > 0) {
        if (!stackBackdrop) {
          stackBackdrop = document.createElement("canvas");
          stackBackdrop.width = out.width;
          stackBackdrop.height = out.height;
        }
        const sb = stackBackdrop.getContext("2d")!;
        sb.clearRect(0, 0, out.width, out.height);
        sb.drawImage(out, 0, 0);
        registerBackdrop(stackBackdrop, out.width, out.height);
      } else {
        registerMergedBackdrop(out, underCompositor);
      }
      const el = stack[n];
      applyLiquidGlass(shadow, { elements: [el] });
      const mirror = el.querySelector("canvas");
      if (!mirror) continue;
      const r = el.getBoundingClientRect();
      const x = (r.left - hr.left) * s;
      const y = (r.top - hr.top) * s;
      const w = r.width * s;
      const h = r.height * s;
      ctx.drawImage(mirror, x, y, w, h);
    }
    for (const el of stack) blitGlassChrome(ctx, base, el, hr, s);
    host.remove();
    return out;
  },
};
