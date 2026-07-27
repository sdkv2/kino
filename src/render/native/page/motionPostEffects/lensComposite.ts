// GPU backdrop-sampling lens compositor: field plate + stacked mirrors + chrome plate.
import type { BackdropTexture } from "../backdrop.js";
import { acquireGpuFbo, blitTexture, uploadCanvas, type GpuFbo } from "../gpuBlit.js";
import { renderLensMirrorFbo } from "../lensMirror.js";

export interface GpuLensLayer {
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
  alphaCut = 0,
): void {
  blitTexture(gl, dst, srcTex, flipY, sx, sy, sw, sh, sx, sy, sw, sh, texW, texH, 1, alphaCut);
}

function mergeBackdropWithBase(
  gl: WebGL2RenderingContext,
  backdrop: Readonly<BackdropTexture>,
  fieldTex: WebGLTexture,
  layerW: number,
  layerH: number,
): BackdropTexture {
  const merged = acquireGpuFbo(gl, layerW, layerH, "backdrop-merged");
  const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  gl.bindFramebuffer(gl.FRAMEBUFFER, merged.fbo);
  gl.viewport(0, 0, layerW, layerH);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);

  blitTexture(
    gl,
    merged,
    backdrop.tex,
    1,
    0,
    0,
    layerW,
    layerH,
    0,
    0,
    backdrop.width,
    backdrop.height,
    backdrop.width,
    backdrop.height,
  );
  blitTexture(gl, merged, fieldTex, 0, 0, 0, layerW, layerH, 0, 0, layerW, layerH, layerW, layerH);
  return { tex: merged.tex, width: layerW, height: layerH };
}

function snapshotRendered(gl: WebGL2RenderingContext, src: GpuFbo, key: string): BackdropTexture {
  const copy = acquireGpuFbo(gl, src.w, src.h, key);
  blitTexture(gl, copy, src.tex, 1, 0, 0, copy.w, copy.h, 0, 0, src.w, src.h, src.w, src.h);
  return { tex: copy.tex, width: copy.w, height: copy.h };
}

export function lensStackOrder(els: HTMLElement[]): HTMLElement[] {
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

/** Compose field raster + GPU lens mirrors + chrome raster on the compositor GL context. */
export function compositeLensLayer(opts: {
  gl: WebGL2RenderingContext;
  field: HTMLCanvasElement;
  chrome: HTMLCanvasElement;
  backdrop: Readonly<BackdropTexture>;
  pageW: number;
  pageH: number;
  hostRect: DOMRect;
  stack: HTMLElement[];
  lensShaders: Record<string, string>;
}): GpuLensLayer | null {
  const { gl, field, chrome, backdrop, pageW, pageH, hostRect, stack, lensShaders } = opts;
  const layerW = field.width;
  const layerH = field.height;
  if (layerW < 1 || layerH < 1 || stack.length === 0) return null;

  const layer = acquireGpuFbo(gl, layerW, layerH, "lens-layer");
  const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  gl.bindFramebuffer(gl.FRAMEBUFFER, layer.fbo);
  gl.viewport(0, 0, layerW, layerH);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);

  const fieldTex = uploadCanvas(gl, field);
  blitRegion(gl, layer, fieldTex, 0, layerW, layerH, 0, 0, layerW, layerH);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.activeTexture(gl.TEXTURE0);

  let currentBackdrop = mergeBackdropWithBase(gl, backdrop, fieldTex, layerW, layerH);
  const s = pageW > 0 ? layerW / pageW : 1;
  let drew = 0;

  for (let n = 0; n < stack.length; n++) {
    const el = stack[n];
    if (n > 0) currentBackdrop = snapshotRendered(gl, layer, "lens-stack-snap");

    const mirror = renderLensMirrorFbo(gl, currentBackdrop, el, pageW, pageH, hostRect, lensShaders);
    if (!mirror) continue;

    const rect = el.getBoundingClientRect();
    const dw = Math.max(1, Math.round(rect.width * s));
    const dh = Math.max(1, Math.round(rect.height * s));
    const dx = Math.round((rect.left - hostRect.left) * s);
    const dy = Math.round((rect.top - hostRect.top) * s);
    const cw = Math.min(dw, layerW - dx);
    const ch = Math.min(dh, layerH - dy);
    if (cw < 1 || ch < 1 || dx >= layerW || dy >= layerH) continue;
    const srcW = Math.max(1, Math.round((cw / dw) * mirror.w));
    const srcH = Math.max(1, Math.round((ch / dh) * mirror.h));
    blitTexture(gl, layer, mirror.tex, 1, dx, dy, cw, ch, 0, 0, srcW, srcH, mirror.w, mirror.h);
    drew++;
  }

  if (drew === 0) return null;

  const chromeTex = uploadCanvas(gl, chrome);
  blitRegion(gl, layer, chromeTex, 0, layerW, layerH, 0, 0, layerW, layerH);

  return { kind: "gpu", tex: layer.tex, w: layerW, h: layerH };
}
