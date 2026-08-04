// Motion-graphic layers: beat-relative vars, Tier-2 proc, post-raster backdrop lenses.
import type { MotionEnv, MotionGraphicProps, Theme } from "../../../../props.js";
import { motionFrameState } from "../../../../motionVars.js";
import { annotateVelocityTargets, hasVelocityTargets, implySmearOptIn } from "../../../../motionVelocity.js";
import { applyPathMorphs, hasPathMorph } from "../../../../pathMorph.js";
import { sanitizeMotionHtml } from "../../../../sanitizeMotion.js";
import { measureVelocity } from "../../velocityProbe.js";
import { reportFatal } from "../../fatal.js";
import {
  disposeMotionFrameBundle,
  motionNeedsLensLayers,
  prepareMotionFrameBundle,
  rasterMotionFull,
  type MotionFrameBundle,
} from "../../motionRaster.js";
import { applyMotionPostEffects, isGpuMotionPostResult } from "../../motionPostEffects/index.js";
import { extractUnderlay, loadUnderlay, type UnderlayPlate } from "../../underlay.js";
import { fetchAsDataUrl, inlineExternalRefs } from "../inline.js";
import type { TextureSource } from "../graph.js";
import { uploadCanvasOrImage } from "./upload.js";
import * as prof from "../profile.js";

/** Lens motion at SS≥2 holds 4 full plates per entry — keep cache shallow on finals. */
function motionCacheMax(scale: number, hasLenses: boolean): number {
  if (!hasLenses) return 24;
  return scale >= 2 ? 8 : 16;
}

const inlineForFo = (html: string): Promise<string> => inlineExternalRefs(html, fetchAsDataUrl);

async function rasterMotion(
  html: string,
  vars: Record<string, string>,
  theme: Theme,
  width: number,
  height: number,
  scale: number,
): Promise<MotionFrameBundle | null> {
  if (motionNeedsLensLayers(html)) {
    return prepareMotionFrameBundle(html, vars, theme, width, height, scale, inlineForFo);
  }
  const full = await rasterMotionFull(html, vars, theme, width, height, scale, inlineForFo);
  if (!full) return null;
  return {
    manifest: { pageW: width, pageH: height, rasterScale: scale, lenses: [], quads: [] },
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
  /** Per-composition-frame audio envelope (0..1) — env.audio/--kino-audio. Absent → 0. */
  audio?: number[];
  captionBottom?: number;
  /** Spec-level shared constants — see KinoProps.data. */
  specData?: Record<string, string | number>;
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
  // Hoisted static backplate: same src every frame, so decoded and uploaded exactly once.
  let underlay: UnderlayPlate | null = null;
  const quadPlates = new Map<string, UnderlayPlate>();
  const contentKeys = new Set<string>(); // profile-only; see the cacheHit probe in prepare()

  /**
   * Everything one frame of this beat resolves to: its variables and its final markup.
   *
   * Split out of prepare() because the per-element velocity pass needs a SECOND frame's variables and
   * markup — the one before this frame — and must re-derive them rather than remember them (frames are
   * seeked out of order across workers and served from a persistent cache, so the previous frame may
   * never have been rendered here). Every input is a pure function of `local`, so calling it twice is
   * free of order effects.
   */
  function motionFrame(local: number): { vars: Record<string, string>; html: string; velCount: number } {
    const durationFrames = opts.beatDur;
    // Shared with `kino still --dump-html` (motionVars.ts) so a dumped frame is byte-identical to
    // the one that rendered — two definitions of `env` would make the dump a fiction.
    const { env, vars } = motionFrameState(opts.data, {
      local,
      fps: opts.fps,
      durationFrames,
      theme: opts.theme,
      width: opts.width,
      height: opts.height,
      captionBottom: opts.captionBottom,
      audio: opts.audio,
      audioFrom: opts.beatFrom,
      specData: opts.specData,
    });

    let html = opts.data.html;
    if (procFn) {
      prof.sync("motion:proc", () => {
        try {
          html = sanitizeMotionHtml(String(procFn(env) ?? ""));
        } catch {
          html = "";
        }
      });
    }

    // Declarative path morphs resolve here, before anything measures or rasterises the tree: the
    // interpolated `d` changes the element's geometry, so a velocity measurement taken first would
    // be measuring last frame's shape. Pure string → string from this frame's variables.
    if (hasPathMorph(html)) {
      const morphed = prof.sync("motion:morph", () => applyPathMorphs(html, vars));
      html = morphed.html;
      // An unshippable frame, not a degraded one: a structural mismatch silently renders as the
      // authored static `d` (a morph that never morphs), which is precisely the "it looked like it
      // worked" failure this feature replaces. reportFatal makes the render exit naming the element.
      if (morphed.errors.length > 0) reportFatal("motion path morph", morphed.errors.join("\n"));
    }

    // Stamp the opted-in elements with indices so the caller's measurement pass can pair them up.
    // .kino-smear is expanded to the measurement attribute first, so the class alone opts in.
    const vel = hasVelocityTargets(html)
      ? annotateVelocityTargets(implySmearOptIn(html))
      : { html, count: 0 };
    return { vars, html: vel.html, velCount: vel.count };
  }

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

      const durationFrames = opts.beatDur;
      const frameState = motionFrame(local);
      const vars = frameState.vars;
      let html = frameState.html;

      // Per-element velocity. Two layout passes, and only for a page that asked. The pair straddles
      // this frame — N-1 and N+1, a central difference — so an easing that decelerates into a
      // keyframe does not blink every velocity-driven effect off for a frame. At a beat edge only one
      // neighbour exists, so it falls back to the one-frame difference on whichever side is there.
      if (frameState.velCount > 0 && durationFrames > 1) {
        const last = durationFrames - 1;
        const aLocal = Math.max(0, local - 1);
        const bLocal = Math.min(last, local + 1);
        const span = bLocal - aLocal;
        const a = aLocal === local ? frameState : motionFrame(aLocal);
        const b = bLocal === local ? frameState : motionFrame(bLocal);
        // A Tier-2 proc whose element count changes between frames has no stable element identity, so
        // there is nothing to diff; the markup keeps its indices and the resting zeros apply.
        if (span > 0 && a.velCount === frameState.velCount && b.velCount === frameState.velCount) {
          html = prof.sync("motion:vel", () =>
            measureVelocity({
              html,
              aHtml: a.html,
              aVars: a.vars,
              bHtml: b.html,
              bVars: b.vars,
              span,
              theme: opts.theme,
              width: opts.width,
              height: opts.height,
              count: frameState.velCount,
            }),
          );
        }
      }

      // Strip the underlay marker BEFORE inlining: the whole point is that this asset never
      // reaches the foreignObject, so it is never re-resampled per plate per frame.
      const hoisted = extractUnderlay(html);
      html = hoisted.html;
      if (hoisted.src && !underlay) underlay = await loadUnderlay(hoisted.src);

      // MEASUREMENT ONLY (KINO_PROFILE=1): what a content-addressed cache key WOULD hit. The
      // cache is keyed `f:${local}` today, so it never hits on a long beat even though most of
      // the scene is identical frame to frame. `motion:cacheHit` mean = the hit rate a content
      // key would achieve; `motion:cacheDistinct` counts unique rasters. Nothing is cached here.
      //
      // Measured 2026-07-28 on macos-desktop-youtube: the EXACT key is distinct on all 1094
      // frames — vars carry `frame`/`t` and the proc bakes toFixed(4) cursor coords, so raw
      // strings never repeat. The `:norm1`/`:norm2` variants re-key after rounding every decimal
      // literal (html + vars) to 1 / 2 places — the "visually distinct" key the raster-reuse
      // idea actually needs. Whole-frame reuse is bounded by the cursor: it moves ~every frame.
      if (prof.profileOn()) {
        const djb2 = (seed: number, s: string) => {
          let h = seed;
          for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
          return h;
        };
        const varsStr = JSON.stringify(vars);
        const probe = (tag: string, hh: string, vv: string) => {
          const key = `${tag}:${djb2(djb2(5381, hh), vv)}:${hh.length}`;
          const seen = contentKeys.has(key);
          if (!seen) contentKeys.add(key);
          prof.addSample(`motion:cacheHit${tag}`, seen ? 1 : 0);
          if (tag === "") prof.addSample("motion:cacheDistinct", seen ? 0 : 1);
        };
        const round = (s: string, dp: number) => s.replace(/-?\d+\.\d+/g, (m) => Number(m).toFixed(dp));
        probe("", html, varsStr);
        probe(":norm1", round(html, 1), round(varsStr, 1));
        probe(":norm2", round(html, 2), round(varsStr, 2));
      }

      // NOT inlined here any more — rasterMotion inlines only the serialized markup that feeds
      // the foreignObject, so the live measure host stays at proc size instead of ~1MB.
      prof.addSample("motion:htmlKB", html.length / 1024);

      const bundle = await prof.awaited("motion:raster", () =>
        rasterMotion(html, vars, opts.theme, opts.width, opts.height, opts.scale),
      );
      if (!bundle) return;
      // Hoisted quads: one decode + upload per distinct src for the whole render, not per frame.
      for (const q of bundle.manifest.quads ?? []) {
        if (quadPlates.has(q.src)) continue;
        const plate = await loadUnderlay(q.src);
        if (plate) quadPlates.set(q.src, plate);
      }
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
          // Lens bundles carry no `full` plate; the lens effect always fires for them (same
          // LENS_CLASS_RE gate) and rebuilds the frame, so `base` is only ever read on the
          // non-lens path — where full is set (and aliases sample).
          base: plates.full ?? plates.sample,
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
          underlay,
          quadPlates,
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
