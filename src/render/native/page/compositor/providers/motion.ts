// Motion-graphic layers: beat-relative vars, Tier-2 proc, kino-glass mirrors.
import type { MotionEnv, MotionGraphicProps, Theme } from "../../../../props.js";
import { paramsAt, pulseAt, progressCurves } from "../../../../bgparams.js";
import { buildMotionVars, cameraBlurVars } from "../../../../motionVars.js";
import { sanitizeMotionHtml } from "../../../../sanitizeMotion.js";
import { buildTemplate, rasterAt, TEX_ROOT } from "../../bgTextures.js";
import { KINO_DEFS, motionScrubCss } from "../../motionCss.js";
import { applyLiquidGlass } from "../../liquidGlass.js";
import type { TextureSource } from "../graph.js";
import { uploadCanvasOrImage } from "./upload.js";

const CACHE_MAX = 24;
const GLASS_RE = /\bkino-glass\b/;

function varsCss(vars: Record<string, string>): string {
  return `.${TEX_ROOT}{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";")}}`;
}

async function rasterMotion(
  html: string,
  vars: Record<string, string>,
  theme: Theme,
  width: number,
  height: number,
  scale: number,
): Promise<HTMLCanvasElement | null> {
  const css = motionScrubCss(TEX_ROOT) + varsCss(vars);
  const tpl = await buildTemplate(html, theme, {
    size: { w: width, h: height },
    scale,
    defs: /\bkino-(grain|vignette)\b|filter:\s*url\(#kino-/.test(html) ? KINO_DEFS : undefined,
  });
  return rasterAt(tpl, "x", css, null);
}

/** Glass mirrors need the true composite beneath — only available when the compositor calls
 *  texture() after registerBackdropTexture(). */
function rasterGlassMirrors(
  base: HTMLCanvasElement,
  html: string,
  vars: Record<string, string>,
  width: number,
  height: number,
): HTMLCanvasElement {
  if (!GLASS_RE.test(html)) return base;

  const host = document.createElement("div");
  host.style.cssText = `position:absolute;left:-99999px;top:0;width:${width}px;height:${height}px;visibility:hidden`;
  for (const [k, v] of Object.entries(vars)) host.style.setProperty(k, v);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>${motionScrubCss(":host")}</style>${KINO_DEFS}${html}`;
  document.body.appendChild(host);
  applyLiquidGlass(shadow);
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  if (!ctx) {
    host.remove();
    return base;
  }
  const hr = host.getBoundingClientRect();
  ctx.drawImage(base, 0, 0);
  shadow.querySelectorAll<HTMLElement>(".kino-glass").forEach((el) => {
    const mirror = el.querySelector("canvas");
    if (!mirror) return;
    const r = el.getBoundingClientRect();
    ctx.drawImage(mirror, r.left - hr.left, r.top - hr.top, r.width, r.height);
  });
  host.remove();
  return out;
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
  const cache = new Map<string, { base: HTMLCanvasElement; html: string; vars: Record<string, string> }>();
  const procFn =
    opts.data.proc && !opts.data.lottie
      ? // eslint-disable-next-line @typescript-eslint/no-implied-eval
        (new Function("env", opts.data.proc) as (env: MotionEnv) => unknown)
      : null;
  let tex: WebGLTexture | null = null;
  let uploaded: string | null = null;
  let current: string | null = null;

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

      const base = await rasterMotion(html, vars, opts.theme, opts.width, opts.height, opts.scale);
      if (!base) return;
      cache.set(cacheKey, { base, html, vars });
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    },
    texture(gl: WebGL2RenderingContext, frame?: number, key?: string): WebGLTexture | null {
      const local = frame !== undefined ? frame - opts.beatFrom : undefined;
      const cacheKey = key ?? current ?? (local !== undefined ? `f:${local}` : null);
      if (!cacheKey) return null;
      const entry = cache.get(cacheKey);
      if (!entry) return null;
      if (uploaded !== cacheKey || !tex) {
        const finalCanvas = rasterGlassMirrors(entry.base, entry.html, entry.vars, opts.width, opts.height);
        tex = uploadCanvasOrImage(gl, tex, finalCanvas);
        uploaded = cacheKey;
      }
      return tex;
    },
    size(): { w: number; h: number } {
      return { w: opts.width, h: opts.height };
    },
    dispose(): void {
      cache.clear();
    },
  };
}
