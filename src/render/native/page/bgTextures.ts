// Shader-background texture channels (uTex0..uTex3). Static channels resolve ONCE inside
// kinoLoad (before the ready flag/first capture); animated `.html` channels re-rasterize every
// frame at their exact scrub value (awaited inside kinoSeek before the React commit) — a plain
// texture() sample in the shader always sees this frame's pixels. Deterministic throughout:
// the raster is a pure function of (markup, scrub value), no feImage, no wall clock.
//
// kind="image": staged file under /public, decoded via <img>, resolved once.
// kind="html": sanitized motion-style markup rasterized via <svg><foreignObject> at 2×.
//   The markup is measured in a hidden live container first (vw units resolve against the
//   composition viewport), brand fonts are inlined as data-URI @font-face (an SVG image loads in
//   an isolated document — it cannot see document.fonts or fetch external URLs), and the kino
//   palette vars are set on the wrapper so --kino-* tokens work. With `param` set, the markup's
//   1s-convention CSS @keyframes are scrubbed (pause + negative animation-delay) to that
//   background param's per-frame value; without it, the raster is a single static frame.
import type { KinoProps } from "../../props.js";
import { paramsAt } from "../../bgparams.js";
import * as prof from "./compositor/profile.js";

export interface LoadedTex {
  source: CanvasImageSource;
  width: number; // css px
  height: number;
  revision: number; // bumped when `source` pixels change (animated) → re-upload to GL
}

// Sparse by channel index: a failed load leaves `null` so later defs do not shift into earlier
// uTex slots (backgroundTextures[i] must stay uTexI even when [i-1] 404s).
let loaded: (LoadedTex | null)[] = [];

// Animated-channel state: everything needed to re-rasterize at an arbitrary scrub value without
// re-measuring (template built once at load), plus a small LRU of baked scrub values.
interface AnimTex {
  index: number; // channel slot in `loaded`
  param: string;
  tpl: HtmlTemplate;
  cache: Map<string, HTMLCanvasElement>; // scrub value (fixed precision) → raster
}
const animTexes: AnimTex[] = [];
const ANIM_CACHE_MAX = 48;

// Video-channel state: a hidden <video> per channel, seeked to frame/fps and re-drawn into its own
// canvas every frame. Same canvas object across frames (redrawn in place); the revision bump is what
// tells ShaderBackground to re-upload.
interface VideoTex {
  index: number; // channel slot in `loaded`
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}
const videoTexes: VideoTex[] = [];

// Pure, DOM-free seam (unit-tested; the <video> seek + canvas draw wrap it in prepareBgTextures):
// composition frame → deterministic source seek time (frame/fps) and the next revision, bumped every
// frame so a re-seeked mask always re-uploads to uTexN. fps<=0 guards divide-by-zero.
export function videoTexStep(frame: number, fps: number, revision: number): { time: number; revision: number } {
  return { time: fps > 0 ? frame / fps : 0, revision: revision + 1 };
}

export function getBgTextures(): (LoadedTex | null)[] {
  return loaded;
}

const RASTER_SCALE = 2; // rasterize HTML textures at 2× for crisp sampling under warp

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`background texture failed to load: ${url}`));
  });
  return img;
}

// Hidden <video> for a mask channel. `loadeddata` guarantees the first frame is decodable
// (videoWidth/Height known, drawImage safe). Same-origin (/public) → the canvas stays untainted, so
// texImage2D can read it back.
export async function loadVideo(url: string): Promise<HTMLVideoElement> {
  const vid = document.createElement("video");
  vid.muted = true;
  vid.preload = "auto";
  vid.src = url;
  await new Promise<void>((resolve, reject) => {
    vid.onloadeddata = () => resolve();
    vid.onerror = () => reject(new Error(`background video texture failed to load: ${url}`));
  });
  return vid;
}

// Seek to `t` and resolve once the frame has settled. Clamp inside [0, duration) — a seek past the
// end never fires `seeked`, so late composition frames hold the last mask frame.
// ponytail: <video> seeking is not guaranteed frame-exact (kino extracts footage frames node-side
// for that reason). Acceptable for a smooth mask; upgrade path = route mask.mp4 through videoFrames.ts.
export function seekVideo(vid: HTMLVideoElement, t: number): Promise<void> {
  const dur = Number.isFinite(vid.duration) ? vid.duration : t;
  const target = Math.max(0, Math.min(t, dur - 1e-3));
  if (Math.abs(vid.currentTime - target) < 1e-4) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      vid.removeEventListener("seeked", done);
      resolve();
    };
    vid.addEventListener("seeked", done);
    vid.currentTime = target;
  });
}

// ponytail: one @font-face block per theme per process — font bytes never change mid-render.
const fontFaceCache = new Map<string, string>();

/** Pure cache key: theme font paths determine the inlined @font-face CSS bytes. */
export function fontFaceCacheKey(
  theme: Pick<KinoProps["theme"], "fontUrl" | "labelFontUrl" | "fontFaces">,
): string {
  // fontFaces is part of the key: the inlined bytes differ per cut, so omitting it would serve one
  // brand's face set for another's.
  const cuts = (theme.fontFaces ?? []).map((f) => `${f.weight}:${f.url}`).join(",");
  return `${theme.fontUrl ?? ""}\0${theme.labelFontUrl ?? ""}\0${cuts}`;
}

async function buildFontFaceCss(theme: KinoProps["theme"]): Promise<string> {
  const faces: string[] = [];
  const inline = async (family: string, rel: string | null | undefined, weight?: number) => {
    if (!rel) return;
    try {
      const buf = await (await fetch("/public/" + rel)).arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      // A weight descriptor only when there is more than one cut: with a single face, declaring a
      // weight would make every other weight a synthetic-bold miss instead of just using the face.
      const desc = weight == null ? "" : `font-weight:${weight};`;
      faces.push(`@font-face{font-family:'${family}';${desc}src:url(data:font/ttf;base64,${btoa(bin)})}`);
    } catch {
      // Missing font → system fallback inside the raster; same tradeoff as a broken <Img>.
    }
  };
  const extra = theme.fontFaces ?? [];
  if (extra.length) {
    for (const f of extra) await inline("KinoBrandFont", f.url, f.weight);
  } else {
    await inline("KinoBrandFont", theme.fontUrl);
  }
  await inline("KinoLabelFont", theme.labelFontUrl);
  return faces.join("");
}

async function fontFaceCss(theme: KinoProps["theme"]): Promise<string> {
  const key = fontFaceCacheKey(theme);
  const hit = fontFaceCache.get(key);
  if (hit !== undefined) {
    prof.addSample("tpl:fontCssHit", 1);
    return hit;
  }
  prof.addSample("tpl:fontCssMiss", 1);
  const css = await buildFontFaceCss(theme);
  fontFaceCache.set(key, css);
  return css;
}

/** Unit tests only — clears the process-lifetime font CSS cache. */
export function resetFontFaceCacheForTests(): void {
  fontFaceCache.clear();
}

export function paletteVars(theme: KinoProps["theme"]): string {
  return (
    `--kino-mint:${theme.mint};--kino-green:${theme.green};--kino-night:${theme.night};` +
    `--kino-white:${theme.white};--kino-gold:${theme.gold};` +
    `--kino-font:${theme.font};--kino-label-font:${theme.labelFont};`
  );
}

export interface HtmlTemplate {
  w: number;
  h: number;
  makeSvg: (css: string) => string; // css lands in the raster's <style>, after the fonts + palette
  makeSvgUrl: (css: string) => string; // data: URL with cached encoded prefix/suffix around css
  svgByteLength: (css: string) => number; // raw SVG byte length without materialising the full string
}

const DATA_URL_PREFIX = "data:image/svg+xml;charset=utf-8,";

/** Split-boundary guard: encodeURIComponent throws on a lone UTF-16 surrogate. */
function assertSplitBoundary(before: string, after: string, label: string): void {
  if (before.length > 0) {
    const tail = before.charCodeAt(before.length - 1);
    if (tail >= 0xd800 && tail <= 0xdbff) {
      throw new Error(`SVG template split ${label}: high surrogate at end of prefix`);
    }
  }
  if (after.length > 0) {
    const head = after.charCodeAt(0);
    if (head >= 0xdc00 && head <= 0xdfff) {
      throw new Error(`SVG template split ${label}: low surrogate at start of suffix`);
    }
  }
}

/** The wrapper class every rasterized markup sits inside — the raster's stand-in for `:host`. */
export const TEX_ROOT = "kino-tex-root";

/**
 * Measure + serialize ONCE per texture; per-scrub rasters only vary the injected CSS.
 * `size` skips the fit-content measure and forces a fixed box (a full-frame motion layer measures
 * ~0 wide, since its children are absolutely positioned). `scale` overrides the 2× supersample —
 * markup already authored at composition size gains nothing from it. `defs` is SVG markup injected
 * alongside the foreignObject (the kino filter library, for filter:url(#kino-…) references).
 */
export async function buildTemplate(
  html: string,
  theme: KinoProps["theme"],
  opts: { size?: { w: number; h: number }; scale?: number; defs?: string } = {},
): Promise<HtmlTemplate> {
  // Measure in a hidden live container so CSS (including vw units) resolves for real.
  // Inner wrapper keeps <style> blocks (and any sibling markup) in the serialization while giving
  // one element to measure — firstElementChild alone would grab a leading <style> tag.
  const probe = document.createElement("div");
  probe.setAttribute("style", `position:absolute;left:-99999px;top:0;visibility:hidden;${paletteVars(theme)}`);
  const inner = document.createElement("div");
  if (opts.size) {
    // Fixed box: lay the markup out at exactly the size it will be rasterized at, so `inset:0`
    // children and % / vw units resolve against the real target rather than a shrink-wrapped box.
    inner.style.position = "relative";
    inner.style.width = `${opts.size.w}px`;
    inner.style.height = `${opts.size.h}px`;
  } else {
    inner.style.width = "fit-content";
  }
  inner.innerHTML = html;
  probe.appendChild(inner);
  document.body.appendChild(probe);
  const rect = inner.getBoundingClientRect();
  const w = opts.size?.w ?? Math.max(2, Math.ceil(rect.width));
  const h = opts.size?.h ?? Math.max(2, Math.ceil(rect.height));
  // Serialize to XHTML for foreignObject (XML well-formedness).
  const xhtml = new XMLSerializer().serializeToString(inner);
  probe.remove();
  const fonts = await fontFaceCss(theme);
  const scale = opts.scale ?? RASTER_SCALE;
  const defs = opts.defs ?? "";
  return htmlTemplateFromXhtml(xhtml, theme, w, h, scale, fonts, defs);
}

/** FO template from pre-serialized inner markup — skips a second measure probe when a live host exists. */
export async function buildTemplateFromXhtml(
  xhtml: string,
  theme: KinoProps["theme"],
  w: number,
  h: number,
  opts: { scale?: number; defs?: string } = {},
): Promise<HtmlTemplate> {
  const fonts = await fontFaceCss(theme);
  const scale = opts.scale ?? RASTER_SCALE;
  const defs = opts.defs ?? "";
  return htmlTemplateFromXhtml(xhtml, theme, w, h, scale, fonts, defs);
}

/** DOM-free template builder — exported for unit tests of the encoded-prefix/suffix path. */
export function htmlTemplateFromXhtml(
  xhtml: string,
  theme: KinoProps["theme"],
  w: number,
  h: number,
  scale: number,
  fonts: string,
  defs: string,
): HtmlTemplate {
  // Rounded: a fractional scale (a draft rasterising 1920 comp px onto 1280) otherwise lands on
  // 1279.9999999999998 and the plate comes back one pixel off its target, buying a full-frame
  // resample per frame in normalizeMotionPlates. Exact at scale 1 and 2, so nothing else moves.
  const svgOpen =
    `<svg xmlns="http://www.w3.org/2000/svg" style="background:transparent" width="${Math.round(w * scale)}" height="${Math.round(h * scale)}" viewBox="0 0 ${w} ${h}">`;
  // Palette vars live in a <style> block, NOT a style attribute: font families contain double
  // quotes, which would terminate the XML attribute and invalidate the whole SVG.
  const stylePrefix = `<style>${fonts} html,body{background:transparent !important;} .${TEX_ROOT}{${paletteVars(theme)}} `;
  const styleTail = `</style>${defs}`;
  const foOpen = `<foreignObject width="${w}" height="${h}">`;
  const divOpen =
    `<div xmlns="http://www.w3.org/1999/xhtml" class="${TEX_ROOT}" style="width:${w}px;height:${h}px;background:transparent">`;
  const divClose = `</div>`;
  const foClose = `</foreignObject></svg>`;

  const rawPrefix = svgOpen + stylePrefix;
  const rawSuffix = styleTail + foOpen + divOpen + xhtml + divClose + foClose;
  assertSplitBoundary(rawPrefix, rawSuffix, "before css");

  const fixedSvgBytes = rawPrefix.length + rawSuffix.length;
  let encodedPrefix: string | undefined;
  let encodedSuffix: string | undefined;

  const ensureEncodedHalves = () => {
    if (encodedPrefix === undefined) {
      encodedPrefix = encodeURIComponent(rawPrefix);
      encodedSuffix = encodeURIComponent(rawSuffix);
    }
  };

  return {
    w,
    h,
    makeSvg: (css: string) => rawPrefix + css + rawSuffix,
    makeSvgUrl: (css: string) => {
      assertSplitBoundary(css, rawSuffix, "after css");
      ensureEncodedHalves();
      return DATA_URL_PREFIX + encodedPrefix! + encodeURIComponent(css) + encodedSuffix!;
    },
    svgByteLength: (css: string) => fixedSvgBytes + css.length,
  };
}

/** Scrub CSS: pause + negative delay against the 1s @keyframes convention. */
export const scrubCss = (t: number) =>
  `.${TEX_ROOT} *{animation-duration:1s !important;animation-play-state:paused !important;` +
  `animation-delay:${-t}s !important;animation-fill-mode:both !important}`;

/**
 * Rasterize `tpl` with `css` injected. `cache` (keyed by `key`) is for scrub values that repeat;
 * pass null when every frame is a distinct value and the entries would only accumulate.
 */
export async function rasterAt(
  tpl: HtmlTemplate,
  key: string,
  css: string,
  cache: Map<string, HTMLCanvasElement> | null,
): Promise<HTMLCanvasElement | null> {
  const hit = cache ? cache.get(key) : undefined;
  if (hit) {
    // LRU refresh
    cache!.delete(key);
    cache!.set(key, hit);
    return hit;
  }
  try {
    // data: URL, NOT a blob URL — Chromium taints canvases painted from blob-URL foreignObject
    // SVGs (texImage2D would then throw), while data-URL foreignObject SVGs stay clean.
    const url = prof.sync(`raster:encode:${key}`, () => {
      prof.addSample(`raster:svgKB:${key}`, tpl.svgByteLength(css) / 1024);
      return tpl.makeSvgUrl(css);
    });
    const img = await prof.awaited(`raster:decode:${key}`, () => loadImage(url));
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || tpl.w;
    canvas.height = img.naturalHeight || tpl.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    try {
      prof.sync(`raster:draw:${key}`, () => ctx.drawImage(img, 0, 0));
    } finally {
      // Drop decoded SVG bitmap so Chromium's data-URL image cache can't grow with every motion frame.
      img.src = "";
    }
    if (cache) {
      cache.set(key, canvas);
      if (cache.size > ANIM_CACHE_MAX) cache.delete(cache.keys().next().value!);
    }
    return canvas;
  } catch (err) {
    console.error("background texture rasterization failed:", err);
    return null;
  }
}

/** Load all texture channels. Called from kinoLoad before the first seek. */
export async function loadBgTextures(props: KinoProps): Promise<void> {
  animTexes.length = 0; // page reuse across render calls re-registers channels
  videoTexes.length = 0;
  const defs = props.background.textures ?? [];
  // Fixed-length by def index — failures stay null so channel i never slides into uTex{i-1}.
  const out: (LoadedTex | null)[] = defs.map(() => null);
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    if (def.kind === "image" && def.src) {
      try {
        const img = await loadImage("/public/" + def.src);
        out[i] = { source: img, width: img.naturalWidth, height: img.naturalHeight, revision: 0 };
      } catch (err) {
        console.error(String(err));
      }
    } else if (def.kind === "video" && def.src) {
      try {
        const vid = await loadVideo("/public/" + def.src);
        const w = vid.videoWidth || 2;
        const h = vid.videoHeight || 2;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(vid, 0, 0, w, h); // frame 0; per-frame seeks happen in prepareBgTextures
          out[i] = { source: canvas, width: w, height: h, revision: 0 };
          videoTexes.push({ index: i, video: vid, canvas, ctx });
        }
      } catch (err) {
        console.error(String(err));
      }
    } else if (def.kind === "html" && def.html) {
      const tpl = await buildTemplate(def.html, props.theme);
      if (def.param) {
        // Animated channel: template once, first raster at t=0; per-frame rasters via
        // prepareBgTextures (awaited inside kinoSeek before the React commit).
        const cache = new Map<string, HTMLCanvasElement>();
        const first = await rasterAt(tpl, "0.0000", scrubCss(0), cache);
        if (first) {
          out[i] = { source: first, width: tpl.w, height: tpl.h, revision: 0 };
          animTexes.push({ index: i, param: def.param, tpl, cache });
        }
      } else {
        const raster = await rasterAt(tpl, "", scrubCss(0), null);
        if (raster) out[i] = { source: raster, width: tpl.w, height: tpl.h, revision: 0 };
      }
    }
  }
  loaded = out;
}

/**
 * Re-rasterize animated channels for this frame's resolved background params. Awaited inside
 * kinoSeek BEFORE the React commit, so ShaderBackground uploads the fresh pixels synchronously.
 * Deterministic: the raster is a pure function of the scrub value (cached by value).
 */
export async function prepareBgTextures(props: KinoProps, frame: number, fps: number): Promise<void> {
  if (animTexes.length === 0 && videoTexes.length === 0) return;
  // Video mask channels: seek to this frame's source time and re-draw into the channel canvas, then
  // bump revision so ShaderBackground.syncLiveTextures re-uploads it to uTexN.
  for (const vt of videoTexes) {
    const tex = loaded[vt.index];
    if (!tex) continue;
    const step = videoTexStep(frame, fps, tex.revision);
    await seekVideo(vt.video, step.time);
    vt.ctx.drawImage(vt.video, 0, 0, vt.canvas.width, vt.canvas.height);
    tex.source = vt.canvas;
    tex.revision = step.revision;
  }
  if (animTexes.length === 0) return;
  const bg = props.background;
  const tt = fps > 0 ? frame / fps : 0;
  const resolved = paramsAt(bg.params, bg.keyframes, tt);
  for (const anim of animTexes) {
    const raw = resolved[anim.param];
    const t = Math.min(1, Math.max(0, typeof raw === "number" ? raw : 0));
    const tex = loaded[anim.index];
    if (!tex) continue;
    const canvas = await rasterAt(anim.tpl, t.toFixed(4), scrubCss(t), anim.cache);
    if (canvas && canvas !== tex.source) {
      tex.source = canvas;
      tex.revision++;
    }
  }
}
