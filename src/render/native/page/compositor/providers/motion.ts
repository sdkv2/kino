// Motion-graphic layers: beat-relative vars, Tier-2 proc, post-raster backdrop lenses.
import type { MotionEnv, MotionGraphicProps, Theme } from "../../../../props.js";
import { paramsAt, pulseAt, progressCurves } from "../../../../bgparams.js";
import { buildMotionVars, cameraBlurVars } from "../../../../motionVars.js";
import { sanitizeMotionHtml } from "../../../../sanitizeMotion.js";
import { motionNeedsLensLayers, rasterMotionFull, rasterMotionLayers } from "../../motionRaster.js";
import { applyMotionPostEffects, isGpuMotionPostResult, motionNeedsCompositorBackdrop } from "../../motionPostEffects/index.js";
import type { TextureSource } from "../graph.js";
import { uploadCanvasOrImage } from "./upload.js";

const CACHE_MAX = 24;

async function rasterMotion(
  html: string,
  vars: Record<string, string>,
  theme: Theme,
  width: number,
  height: number,
  scale: number,
): Promise<{ full: HTMLCanvasElement; field: HTMLCanvasElement; chrome: HTMLCanvasElement } | null> {
  if (motionNeedsLensLayers(html)) {
    const layers = await rasterMotionLayers(html, vars, theme, width, height, scale);
    return layers;
  }
  const full = await rasterMotionFull(html, vars, theme, width, height, scale);
  if (!full) return null;
  return { full, field: full, chrome: full };
}

export function createMotionSource(opts: {
  data: MotionGraphicProps;
  theme: Theme;
  width: number;
  height: number;
  fps: number;
  scale: number;
  beatFrom: number;
  beatDur: number;
  captionBottom?: number;
}): TextureSource {
  const cache = new Map<
    string,
    { full: HTMLCanvasElement; field: HTMLCanvasElement; chrome: HTMLCanvasElement; html: string; vars: Record<string, string> }
  >();
  const procFn =
    opts.data.proc && !opts.data.lottie
      ? // eslint-disable-next-line @typescript-eslint/no-implied-eval
        (new Function("env", opts.data.proc) as (env: MotionEnv) => unknown)
      : null;
  let tex: WebGLTexture | null = null;
  let uploaded: string | null = null;
  let current: string | null = null;
  let gpuRendered = false;

  return {
    async prepare(frame: number, key?: string): Promise<void> {
      const local = frame - opts.beatFrom;
      const cacheKey = key ?? `f:${local}`;
      current = cacheKey;
      if (cache.has(cacheKey)) return;

      const tt = opts.fps > 0 ? local / opts.fps : 0;
      const durationFrames = opts.beatDur;
      const resolved = paramsAt(opts.data.params, opts.data.keyframes, tt, { implicitBase: true });
      const prevResolved =
        local > 0 ? paramsAt(opts.data.params, opts.data.keyframes, tt - 1 / opts.fps, { implicitBase: true }) : undefined;
      const nextResolved =
        local < durationFrames - 1
          ? paramsAt(opts.data.params, opts.data.keyframes, tt + 1 / opts.fps, { implicitBase: true })
          : undefined;
      const hasCam = "cam" in opts.data.params || opts.data.keyframes.some((k: { params: Record<string, unknown> }) => "cam" in k.params);
      const pulse = pulseAt(opts.data.triggers, tt);
      const progress = durationFrames > 0 ? Math.min(1, Math.max(0, local / durationFrames)) : 0;
      const curves = progressCurves(progress);
      const { camVel, camBlur } = cameraBlurVars(resolved, prevResolved, nextResolved, opts.fps, hasCam);
      const vars = buildMotionVars(opts.theme, {
        frame: local,
        t: tt,
        progress,
        pulse,
        params: resolved,
        fps: opts.fps,
        prevParams: prevResolved,
        nextParams: nextResolved,
        hasCam,
        captionBottom: opts.captionBottom,
        wordsShown: 0,
        wordCount: opts.data.words?.length ?? 0,
        width: opts.width,
        height: opts.height,
      });

      let html = opts.data.html;
      if (procFn) {
        const env: MotionEnv = {
          frame: local,
          t: tt,
          progress,
          in: curves.in,
          out: curves.out,
          inout: curves.inout,
          overshoot: curves.overshoot,
          spring: curves.spring,
          edge: curves.edge,
          pulse,
          params: resolved,
          camVel,
          camBlur,
          palette: {
            mint: opts.theme.mint,
            green: opts.theme.green,
            night: opts.theme.night,
            white: opts.theme.white,
            gold: opts.theme.gold,
            font: opts.theme.font,
          },
          width: opts.width,
          height: opts.height,
          words: opts.data.words ?? [],
          durationFrames,
          duration: opts.fps > 0 ? durationFrames / opts.fps : 0,
        };
        try {
          html = sanitizeMotionHtml(String(procFn(env) ?? ""));
        } catch {
          html = "";
        }
      }

      const raster = await rasterMotion(html, vars, opts.theme, opts.width, opts.height, opts.scale);
      if (!raster) return;
      cache.set(cacheKey, { ...raster, html, vars });
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    },
    needsCompositorBackdrop(frame?: number, key?: string): boolean {
      const local = frame !== undefined ? frame - opts.beatFrom : undefined;
      const cacheKey = key ?? current ?? (local !== undefined ? `f:${local}` : null);
      if (!cacheKey) return false;
      const entry = cache.get(cacheKey);
      return entry ? motionNeedsCompositorBackdrop(entry.html) : false;
    },
    texture(gl: WebGL2RenderingContext, frame?: number, key?: string): WebGLTexture | null {
      const local = frame !== undefined ? frame - opts.beatFrom : undefined;
      const cacheKey = key ?? current ?? (local !== undefined ? `f:${local}` : null);
      if (!cacheKey) return null;
      const entry = cache.get(cacheKey);
      if (!entry) return null;
      if (uploaded !== cacheKey || !tex) {
        const result = applyMotionPostEffects({
          base: entry.full,
          field: entry.field,
          chrome: entry.chrome,
          html: entry.html,
          vars: entry.vars,
          width: opts.width,
          height: opts.height,
          gl,
          lensShaders: opts.data.lensShaders,
        });
        if (isGpuMotionPostResult(result)) {
          tex = result.tex;
          uploaded = cacheKey;
          // blit-dst FBO stores visual top at v=1 (RENDERED), same as compositor targets.
          gpuRendered = true;
          return tex;
        }
        tex = uploadCanvasOrImage(gl, tex, result);
        uploaded = cacheKey;
        gpuRendered = false;
      }
      return tex;
    },
    textureIsRendered(_frame?: number, _key?: string): boolean {
      return gpuRendered;
    },
    size(): { w: number; h: number } {
      return { w: opts.width, h: opts.height };
    },
    dispose(): void {
      cache.clear();
      gpuRendered = false;
    },
  };
}
