// Shader-background texture channels (uTex0..uTex3). Loaded ONCE inside kinoLoad — before the
// ready flag and before any frame capture — so sampling them per frame is synchronous and
// deterministic (no feImage, no mid-render decode).
//
// kind="image": staged file under /public, decoded via <img>.
// kind="html": sanitized motion-style markup rasterized via <svg><foreignObject> at 2×.
//   The markup is measured in a hidden live container first (vw units resolve against the
//   composition viewport), brand fonts are inlined as data-URI @font-face (an SVG image loads in
//   an isolated document — it cannot see document.fonts or fetch external URLs), and the kino
//   palette vars are set on the wrapper so --kino-* tokens work.
import type { KinoProps } from "../../props.js";
import { paramsAt } from "../../bgparams.js";

export interface LoadedTex {
  source: CanvasImageSource;
  width: number; // css px of ONE frame (cell)
  height: number;
  frames: number; // 1 = static
  cols: number; // atlas grid (1x1 for static)
  rows: number;
  revision: number; // bumped when `source` pixels change (live-scrub) → re-upload to GL
}

let loaded: LoadedTex[] = [];

// Live-scrub state per channel: everything needed to re-rasterize at an arbitrary scrub value
// without re-measuring (template built once at load), plus a small LRU of baked scrub values.
interface LiveTex {
  index: number; // channel slot in `loaded`
  param: string;
  makeSvg: (t: number) => string;
  cache: Map<string, HTMLCanvasElement>; // scrub value (fixed precision) → raster
}
const liveTexes: LiveTex[] = [];
const LIVE_CACHE_MAX = 48;

export function getBgTextures(): LoadedTex[] {
  return loaded;
}

const RASTER_SCALE = 2; // rasterize HTML textures at 2× for crisp sampling under warp
const ANIM_RASTER_SCALE = 1; // animated atlases trade sharpness for memory (N frames per texture)

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`background texture failed to load: ${url}`));
  });
  return img;
}

async function fontFaceCss(theme: KinoProps["theme"]): Promise<string> {
  const faces: string[] = [];
  const inline = async (family: string, rel: string | null) => {
    if (!rel) return;
    try {
      const buf = await (await fetch("/public/" + rel)).arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      faces.push(`@font-face{font-family:'${family}';src:url(data:font/ttf;base64,${btoa(bin)})}`);
    } catch {
      // Missing font → system fallback inside the raster; same tradeoff as a broken <Img>.
    }
  };
  await inline("KinoBrandFont", theme.fontUrl);
  await inline("KinoLabelFont", theme.labelFontUrl);
  return faces.join("");
}

function paletteVars(theme: KinoProps["theme"]): string {
  return (
    `--kino-mint:${theme.mint};--kino-green:${theme.green};--kino-night:${theme.night};` +
    `--kino-white:${theme.white};--kino-gold:${theme.gold};` +
    `--kino-font:${theme.font};--kino-label-font:${theme.labelFont};`
  );
}

interface HtmlTemplate {
  w: number;
  h: number;
  makeSvg: (scrubCss: string, scale: number) => string;
}

// Measure + serialize ONCE per texture; per-scrub rasters only vary the injected scrub CSS.
async function buildTemplate(html: string, theme: KinoProps["theme"]): Promise<HtmlTemplate> {
  // Measure in a hidden live container so CSS (including vw units) resolves for real.
  // Inner wrapper keeps <style> blocks (and any sibling markup) in the serialization while giving
  // one element to measure — firstElementChild alone would grab a leading <style> tag.
  const probe = document.createElement("div");
  probe.setAttribute("style", `position:absolute;left:-99999px;top:0;visibility:hidden;${paletteVars(theme)}`);
  const inner = document.createElement("div");
  inner.style.width = "fit-content";
  inner.innerHTML = html;
  probe.appendChild(inner);
  document.body.appendChild(probe);
  const rect = inner.getBoundingClientRect();
  const w = Math.max(2, Math.ceil(rect.width));
  const h = Math.max(2, Math.ceil(rect.height));
  // Serialize to XHTML for foreignObject (XML well-formedness).
  const xhtml = new XMLSerializer().serializeToString(inner);
  probe.remove();
  const fonts = await fontFaceCss(theme);
  const makeSvg = (scrubCss: string, scale: number) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}">` +
    // Palette vars live in a <style> block, NOT a style attribute: font families contain double
    // quotes, which would terminate the XML attribute and invalidate the whole SVG.
    `<style>${fonts} .kino-tex-root{${paletteVars(theme)}} ${scrubCss}</style>` +
    `<foreignObject width="${w}" height="${h}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" class="kino-tex-root" style="width:${w}px;height:${h}px">${xhtml}</div>` +
    `</foreignObject></svg>`;
  return { w, h, makeSvg };
}

// Scrub CSS: pause + negative delay against the 1s @keyframes convention.
const scrubCss = (t: number) =>
  `.kino-tex-root *{animation-duration:1s !important;animation-play-state:paused !important;` +
  `animation-delay:${-t}s !important;animation-fill-mode:both !important}`;

async function rasterizeHtml(html: string, theme: KinoProps["theme"], frames = 1): Promise<LoadedTex | null> {
  const tpl = await buildTemplate(html, theme);
  const { w, h } = tpl;
  const scale = frames > 1 ? ANIM_RASTER_SCALE : RASTER_SCALE;
  const cols = Math.ceil(Math.sqrt(frames));
  const rows = Math.ceil(frames / cols);
  const atlas = document.createElement("canvas");
  atlas.width = w * scale * cols;
  atlas.height = h * scale * rows;
  const ctx = atlas.getContext("2d");
  if (!ctx) return null;

  for (let k = 0; k < frames; k++) {
    const tk = frames > 1 ? k / (frames - 1) : 0;
    const svg = tpl.makeSvg(frames > 1 ? scrubCss(tk) : "", scale);
    try {
      // data: URL, NOT a blob URL — Chromium taints canvases painted from blob-URL foreignObject
      // SVGs (texImage2D would then throw), while data-URL foreignObject SVGs stay clean.
      const img = await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg));
      ctx.drawImage(img, (k % cols) * w * scale, Math.floor(k / cols) * h * scale);
    } catch (err) {
      console.error("background texture rasterization failed:", err);
      return null;
    }
  }
  return { source: atlas, width: w, height: h, frames, cols, rows, revision: 0 };
}

async function rasterAt(tpl: HtmlTemplate, t: number, cache: Map<string, HTMLCanvasElement>): Promise<HTMLCanvasElement | null> {
  const key = t.toFixed(4);
  const hit = cache.get(key);
  if (hit) {
    // LRU refresh
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  try {
    const img = await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(tpl.makeSvg(scrubCss(t), RASTER_SCALE)));
    const canvas = document.createElement("canvas");
    canvas.width = tpl.w * RASTER_SCALE;
    canvas.height = tpl.h * RASTER_SCALE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    cache.set(key, canvas);
    if (cache.size > LIVE_CACHE_MAX) cache.delete(cache.keys().next().value!);
    return canvas;
  } catch (err) {
    console.error("background texture live raster failed:", err);
    return null;
  }
}

/** Load all texture channels. Called from kinoLoad before the first seek. */
export async function loadBgTextures(props: KinoProps): Promise<void> {
  liveTexes.length = 0; // page reuse across render calls re-registers channels
  const defs = props.background.textures ?? [];
  const out: LoadedTex[] = [];
  for (const def of defs) {
    if (def.kind === "image" && def.src) {
      try {
        const img = await loadImage("/public/" + def.src);
        out.push({ source: img, width: img.naturalWidth, height: img.naturalHeight, frames: 1, cols: 1, rows: 1 });
      } catch (err) {
        console.error(String(err));
      }
    } else if (def.kind === "html" && def.html) {
      if (def.param) {
        // Live-scrub channel: template once, first raster at t=0; per-frame rasters via
        // prepareBgTextures (awaited inside kinoSeek before the React commit).
        const tpl = await buildTemplate(def.html, props.theme);
        const cache = new Map<string, HTMLCanvasElement>();
        const first = await rasterAt(tpl, 0, cache);
        if (first) {
          const idx = out.push({ source: first, width: tpl.w, height: tpl.h, frames: 1, cols: 1, rows: 1, revision: 0 }) - 1;
          liveTexes.push({ index: idx, param: def.param, makeSvg: tpl.makeSvg, cache });
        }
      } else {
        const tex = await rasterizeHtml(def.html, props.theme, def.frames ?? 1);
        if (tex) out.push(tex);
      }
    }
  }
  loaded = out;
}

/**
 * Re-rasterize live-scrub channels for this frame's resolved background params. Awaited inside
 * kinoSeek BEFORE the React commit, so ShaderBackground uploads the fresh pixels synchronously.
 * Deterministic: the raster is a pure function of the scrub value (cached by value).
 */
export async function prepareBgTextures(props: KinoProps, frame: number, fps: number): Promise<void> {
  if (liveTexes.length === 0) return;
  const bg = props.background;
  const tt = fps > 0 ? frame / fps : 0;
  const resolved = paramsAt(bg.params, bg.keyframes, tt);
  for (const live of liveTexes) {
    const raw = resolved[live.param];
    const t = Math.min(1, Math.max(0, typeof raw === "number" ? raw : 0));
    const tex = loaded[live.index];
    if (!tex) continue;
    const canvas = await rasterAt({ w: tex.width, h: tex.height, makeSvg: live.makeSvg }, t, live.cache);
    if (canvas && canvas !== tex.source) {
      tex.source = canvas;
      tex.revision++;
    }
  }
}
