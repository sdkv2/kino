// Motion-graphic layers: beat-relative vars, Tier-2 proc, post-raster backdrop lenses.
import type { MotionEnv, MotionGraphicProps, Theme } from "../../../../props.js";
import { paramsAt, pulseAt, progressCurves } from "../../../../bgparams.js";
import { buildMotionVars, cameraBlurVars } from "../../../../motionVars.js";
import { sanitizeMotionHtml } from "../../../../sanitizeMotion.js";
import {
  disposeMotionFrameBundle,
  motionNeedsLensLayers,
  prepareMotionFrameBundle,
  rasterMotionFull,
  type MotionFrameBundle,
} from "../../motionRaster.js";
import { applyMotionPostEffects, isGpuMotionPostResult } from "../../motionPostEffects/index.js";
import { fetchAsDataUrl, inlineExternalRefs } from "../inline.js";
import type { TextureSource } from "../graph.js";
import { uploadCanvasOrImage } from "./upload.js";

/** Lens motion at SS≥2 holds 4 full plates per entry — keep cache shallow on finals. */
function motionCacheMax(scale: number, hasLenses: boolean): number {
  if (!hasLenses) return 24;
  return scale >= 2 ? 8 : 16;
}

async function rasterMotion(
  html: string,
  vars: Record<string, string>,
  theme: Theme,
  width: number,
  height: number,
  scale: number,
): Promise<MotionFrameBundle | null> {
  if (motionNeedsLensLayers(html)) {
    return prepareMotionFrameBundle(html, vars, theme, width, height, scale);
  }
  const full = await rasterMotionFull(html, vars, theme, width, height, scale);
  if (!full) return null;
  return {
    manifest: { pageW: width, pageH: height, rasterScale: scale, lenses: [] },
    plates: { full, sample: full, chrome: full },
    needsLensPost: false,
    vars,
  };
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
  const hasLenses = motionNeedsLensLayers(opts.data.html);
  const cacheMax = motionCacheMax(opts.scale, hasLenses);
  const cache = new Map<string, MotionFrameBundle>();
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
      if (cache.has(cacheKey)) {
        // Lens samples compositor backdrop published per draw. Invalidate from the baked
        // manifest — proc tiers emit kino-lens in generated html, not opts.data.html.
        const entry = cache.get(cacheKey)!;
        if (entry.manifest.lenses.length > 0) {
          uploaded = null;
          gpuRendered = false;
        }
        return;
      }

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
        durationFrames,
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

      html = await inlineExternalRefs(html, fetchAsDataUrl);

      const bundle = await rasterMotion(html, vars, opts.theme, opts.width, opts.height, opts.scale);
      if (!bundle) return;
      cache.set(cacheKey, bundle);
      if (bundle.manifest.lenses.length > 0) {
        uploaded = null;
        gpuRendered = false;
      }
      if (cache.size > cacheMax) {
        const oldest = cache.keys().next().value!;
        disposeMotionFrameBundle(cache.get(oldest)!);
        cache.delete(oldest);
      }
    },
    needsCompositorBackdrop(frame?: number, key?: string): boolean {
      const local = frame !== undefined ? frame - opts.beatFrom : undefined;
      const cacheKey = key ?? current ?? (local !== undefined ? `f:${local}` : null);
      if (!cacheKey) return false;
      const entry = cache.get(cacheKey);
      return entry?.needsLensPost ?? false;
    },
    texture(gl: WebGL2RenderingContext, frame?: number, key?: string): WebGLTexture | null {
      const local = frame !== undefined ? frame - opts.beatFrom : undefined;
      const cacheKey = key ?? current ?? (local !== undefined ? `f:${local}` : null);
      if (!cacheKey) return null;
      const entry = cache.get(cacheKey);
      if (!entry) return null;
      if (uploaded !== cacheKey || !tex) {
        const { plates, manifest } = entry;
        const result = applyMotionPostEffects({
          base: plates.full,
          sample: plates.sample,
          manifest,
          plates,
          lensHost: entry.lensHost,
          chrome: plates.chrome,
          html: entry.needsLensPost ? '<span class="kino-lens"></span>' : "",
          vars: entry.vars,
          width: opts.width,
          height: opts.height,
          theme: opts.theme,
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
      for (const bundle of cache.values()) disposeMotionFrameBundle(bundle);
      cache.clear();
      gpuRendered = false;
    },
  };
}
