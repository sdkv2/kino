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

/**
 * Blit hoisted imagery at its measured rect. Manifest rects are composition px against a
 * pageW×pageH root; the layer is that times the compositor scale, so one factor converts both axes.
 */
function blitQuads(
  gl: WebGL2RenderingContext,
  dst: GpuFbo,
  manifest: MotionLayoutManifest,
  layerW: number,
  layerH: number,
  quadTex?: (src: string) => Readonly<BackdropTexture> | null,
): void {
  if (!quadTex || !manifest.quads?.length || manifest.pageW < 1) return;
  const s = layerW / manifest.pageW;
  for (const q of manifest.quads) {
    const tex = quadTex(q.src);
    if (!tex) continue;
    // No cell → the whole bitmap; a cell selects one tile of a sprite sheet as the source rect.
    const cw = q.cell ? tex.width / q.cell.cols : tex.width;
    const ch = q.cell ? tex.height / q.cell.rows : tex.height;
    const sx = q.cell ? q.cell.col * cw : 0;
    const sy = q.cell ? q.cell.row * ch : 0;
    blitTexture(
      gl,
      dst,
      tex.tex,
      0,
      q.relLeft * s,
      q.relTop * s,
      q.w * s,
      q.h * s,
      sx,
      sy,
      cw,
      ch,
      tex.width,
      tex.height,
    );
  }
}

/** Full-layer blit of an uploaded texture, stretching its whole src rect over the layer. */
function blitFull(
  gl: WebGL2RenderingContext,
  dst: GpuFbo,
  src: Readonly<BackdropTexture>,
  flipY: 0 | 1,
  layerW: number,
  layerH: number,
): void {
  blitTexture(gl, dst, src.tex, flipY, 0, 0, layerW, layerH, 0, 0, src.width, src.height, src.width, src.height);
}

function mergeBackdropWithBase(
  gl: WebGL2RenderingContext,
  backdrop: Readonly<BackdropTexture>,
  sampleTex: WebGLTexture,
  layerW: number,
  layerH: number,
  underlay?: Readonly<BackdropTexture>,
  quads?: { manifest: MotionLayoutManifest; quadTex?: (src: string) => Readonly<BackdropTexture> | null },
): BackdropTexture {
  const merged = acquireGpuFbo(gl, layerW, layerH, "backdrop-merged");
  const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  gl.bindFramebuffer(gl.FRAMEBUFFER, merged.fbo);
  gl.viewport(0, 0, layerW, layerH);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);

  blitFull(gl, merged, backdrop, 1, layerW, layerH);
  // Between compositor backdrop and sample: the underlay used to be painted INTO the raster, so
  // it has to reach the lens sample the same way or the glass refracts an empty desktop.
  if (underlay) blitFull(gl, merged, underlay, 0, layerW, layerH);
  blitTexture(gl, merged, sampleTex, 0, 0, 0, layerW, layerH, 0, 0, layerW, layerH, layerW, layerH);
  // Same order as the visible layer: hoisted quads were part of `sample` before they left the
  // raster, so the glass has to keep refracting them or a lens crossing the video shows stale page.
  if (quads) blitQuads(gl, merged, quads.manifest, layerW, layerH, quads.quadTex);
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
  underlay?: Readonly<BackdropTexture> | null;
  quadTex?: (src: string) => Readonly<BackdropTexture> | null;
  lensShaders: Record<string, string>;
}): GpuLensLayer | null {
  const { gl, manifest, plates, backdrop, underlay, quadTex, lensShaders } = opts;
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

  // Underlay first: the plates are transparent where it used to be painted, and the blit is
  // alpha-over (ONE, ONE_MINUS_SRC_ALPHA), so `sample` composites on top of it rather than
  // punching it out.
  if (underlay) blitFull(gl, layer, underlay, 0, layerW, layerH);
  const sampleTex = uploadCanvas(gl, sample);
  blitRegion(gl, layer, sampleTex, 0, layerW, layerH, 0, 0, layerW, layerH);
  // ABOVE the plate, not beneath it. A quad nested inside an opaque page (a video in a browser
  // window) can never show through from below — the page's own background is an ancestor in the
  // same raster. Tradeoff: plate content overlapping the quad rect is covered, so anything that
  // must paint over it belongs in the chrome/foreground plate.
  blitQuads(gl, layer, manifest, layerW, layerH, quadTex);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.activeTexture(gl.TEXTURE0);

  let currentBackdrop = mergeBackdropWithBase(gl, backdrop, sampleTex, layerW, layerH, underlay ?? undefined, {
    manifest,
    quadTex,
  });
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
