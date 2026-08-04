// The expensive provider: sanitized motion markup or styled text, rasterized through
// <svg><foreignObject> and uploaded as a texture. Reuses the raster path that already
// serves background texture channels — fonts inlined, data: URL (never blob, which taints
// the canvas and makes texImage2D throw), LRU cache keyed by scrub value.
import type { Theme } from "../../../../props.js";
import { buildTemplate, rasterAt, scrubCss, TEX_ROOT, type HtmlTemplate } from "../../bgTextures.js";
import { classifyRaster, type RasterCadence } from "../rasterPolicy.js";
import { fetchAsDataUrl, inlineExternalRefs } from "../inline.js";
import type { TextureSource } from "../graph.js";
import { uploadCanvasOrImage } from "./upload.js";

const CACHE_MAX = 24;

/** Which raster serves this (frame, key) pair. Static layers collapse to one entry. */
export function cacheKeyFor(cadence: RasterCadence, frame: number, key: string | undefined): string {
  if (cadence === "static") return "static";
  if (cadence === "keyed" && key) return `k:${key}`;
  return `f:${frame}`;
}

export function createHtmlSource(opts: {
  html: string | ((frame: number, key?: string) => string);
  theme: Theme;
  size: { w: number; h: number };
  fps: number;
  hasTier2: boolean;
  scale: number;
  /** Force the raster cadence when the caller knows it (e.g. word-keyed captions, whose
   *  markup carries no CSS vars for classifyRaster to detect). */
  cadence?: RasterCadence;
  /**
   * Per-frame CSS injected into the raster — custom properties an animated caption reads.
   *
   * This is the seam that separates the TEMPLATE from the PIXELS. The template is the expensive
   * half (fonts base64-inlined, markup parsed) and stays keyed by cadence, so a words-mode caption
   * still builds one per word and no more. The vars are cheap and may change every frame, so they
   * key only the raster cache. Returning "" collapses the pair back to the template's own key,
   * which is how an animation that has settled stops costing anything: the markup reads its vars
   * through fallbacks equal to the settled pose, so the var-less raster IS that pose.
   */
  vars?: (frame: number, key?: string) => string;
}): TextureSource {
  const sampleHtml = typeof opts.html === "function" ? opts.html(0) : opts.html;
  const cadence = opts.cadence ?? classifyRaster(sampleHtml, { hasTier2: opts.hasTier2 });
  const cache = new Map<string, HTMLCanvasElement>();
  const templates = new Map<string, HtmlTemplate>();
  let tex: WebGLTexture | null = null;
  let uploaded: string | null = null;
  let current: string | null = null;

  return {
    async prepare(frame: number, key?: string): Promise<void> {
      const templateKey = cacheKeyFor(cadence, frame, key);
      const vars = opts.vars?.(frame, key) ?? "";
      const cacheKey = vars ? `${templateKey}|${vars}` : templateKey;
      current = cacheKey;
      if (cache.has(cacheKey)) return;

      let template = templates.get(templateKey);
      if (!template) {
        const rawHtml = typeof opts.html === "function" ? opts.html(frame, key) : opts.html;
        const inlined = await inlineExternalRefs(rawHtml, fetchAsDataUrl);
        template = await buildTemplate(inlined, opts.theme, { size: opts.size, scale: opts.scale });
        templates.set(templateKey, template);
      }

      // Static and keyed rasters hold no time; dynamic ones scrub to this frame. Vars ride on top
      // of either — they are set on the raster root, so they cascade to everything in the markup.
      const scrub = cadence === "dynamic" ? scrubCss(frame / opts.fps) : "";
      const css = vars ? `${scrub}.${TEX_ROOT}{${vars}}` : scrub;
      const canvas = await rasterAt(template, cacheKey, css, null);
      if (!canvas) return;
      cache.set(cacheKey, canvas);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    },
    texture(gl: WebGL2RenderingContext): WebGLTexture | null {
      if (!current) return null;
      const canvas = cache.get(current);
      if (!canvas) return null;
      if (uploaded !== current || !tex) {
        tex = uploadCanvasOrImage(gl, tex, canvas);
        uploaded = current;
      }
      return tex;
    },
    size(): { w: number; h: number } | null {
      const tpl = templates.values().next().value;
      return tpl ? { w: tpl.w, h: tpl.h } : null;
    },
    dispose(): void {
      cache.clear();
    },
  };
}
