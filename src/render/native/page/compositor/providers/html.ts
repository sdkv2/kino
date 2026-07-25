// The expensive provider: sanitized motion markup or styled text, rasterized through
// <svg><foreignObject> and uploaded as a texture. Reuses the raster path that already
// serves background texture channels — fonts inlined, data: URL (never blob, which taints
// the canvas and makes texImage2D throw), LRU cache keyed by scrub value.
import type { Theme } from "../../../../props.js";
import { buildTemplate, rasterAt, scrubCss, type HtmlTemplate } from "../../bgTextures.js";
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
}): TextureSource {
  const sampleHtml = typeof opts.html === "function" ? opts.html(0) : opts.html;
  const cadence = classifyRaster(sampleHtml, { hasTier2: opts.hasTier2 });
  const cache = new Map<string, HTMLCanvasElement>();
  const templates = new Map<string, HtmlTemplate>();
  let tex: WebGLTexture | null = null;
  let uploaded: string | null = null;
  let current: string | null = null;

  return {
    async prepare(frame: number, key?: string): Promise<void> {
      const cacheKey = cacheKeyFor(cadence, frame, key);
      current = cacheKey;
      if (cache.has(cacheKey)) return;

      let template = templates.get(cacheKey);
      if (!template) {
        const rawHtml = typeof opts.html === "function" ? opts.html(frame, key) : opts.html;
        const inlined = await inlineExternalRefs(rawHtml, fetchAsDataUrl);
        template = await buildTemplate(inlined, opts.theme, { size: opts.size, scale: opts.scale });
        templates.set(cacheKey, template);
      }

      // Static and keyed rasters hold no time; dynamic ones scrub to this frame.
      const css = cadence === "dynamic" ? scrubCss(frame / opts.fps) : "";
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
