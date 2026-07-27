// GPU lens composite node — sample base + full-layer manifest passes + chrome.
import type { BackdropTexture } from "./backdrop.js";
import { drawLensLayerPassEntry } from "./lensMirror.js";
import type { MotionLayoutManifest, MotionPaintPlates } from "./lensLayout.js";
import { acquireGpuFbo, blitTexture, uploadCanvas, type GpuFbo } from "./gpuBlit.js";

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
  sampleTex: WebGLTexture,
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
  blitTexture(gl, merged, sampleTex, 0, 0, 0, layerW, layerH, 0, 0, layerW, layerH, layerW, layerH);
  return { tex: merged.tex, width: layerW, height: layerH };
}

function snapshotRendered(gl: WebGL2RenderingContext, src: GpuFbo, key: string): BackdropTexture {
  const copy = acquireGpuFbo(gl, src.w, src.h, key);
  blitTexture(gl, copy, src.tex, 1, 0, 0, copy.w, copy.h, 0, 0, src.w, src.h, src.w, src.h);
  return { tex: copy.tex, width: copy.w, height: copy.h };
}

/** Compose sample raster + baked-manifest lens passes + chrome on the compositor GL context. */
export function executeLensCompositeNode(opts: {
  gl: WebGL2RenderingContext;
  manifest: MotionLayoutManifest;
  plates: MotionPaintPlates;
  backdrop: Readonly<BackdropTexture>;
  lensShaders: Record<string, string>;
}): GpuLensLayer | null {
  const { gl, manifest, plates, backdrop, lensShaders } = opts;
  const { sample, chrome } = plates;
  const { pageW, pageH, lenses } = manifest;
  const layerW = sample.width;
  const layerH = sample.height;
  if (layerW < 1 || layerH < 1 || lenses.length === 0) return null;

  const layer = acquireGpuFbo(gl, layerW, layerH, "lens-layer");
  const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  gl.bindFramebuffer(gl.FRAMEBUFFER, layer.fbo);
  gl.viewport(0, 0, layerW, layerH);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);

  const sampleTex = uploadCanvas(gl, sample);
  blitRegion(gl, layer, sampleTex, 0, layerW, layerH, 0, 0, layerW, layerH);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.activeTexture(gl.TEXTURE0);

  let currentBackdrop = mergeBackdropWithBase(gl, backdrop, sampleTex, layerW, layerH);
  let drew = 0;

  gl.bindFramebuffer(gl.FRAMEBUFFER, layer.fbo);
  for (let n = 0; n < lenses.length; n++) {
    if (n > 0) currentBackdrop = snapshotRendered(gl, layer, "lens-stack-snap");
    if (drawLensLayerPassEntry(gl, currentBackdrop, lenses[n]!, pageW, pageH, layerW, layerH, lensShaders)) {
      drew++;
    }
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);

  if (drew === 0) return null;

  const chromeTex = uploadCanvas(gl, chrome);
  blitRegion(gl, layer, chromeTex, 0, layerW, layerH, 0, 0, layerW, layerH);

  const fg = plates.foreground;
  if (fg) {
    const fgTex = uploadCanvas(gl, fg);
    blitRegion(gl, layer, fgTex, 0, layerW, layerH, 0, 0, layerW, layerH);
  }

  return { kind: "gpu", tex: layer.tex, w: layerW, h: layerH };
}
