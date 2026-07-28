// FO plates for backdrop-sampling lenses + per-frame layout manifest (sample / chrome / foreground).
import type { Theme } from "../../props.js";
import { LENS_CLASS_RE } from "../../lensContract.js";
import { buildTemplate, buildTemplateFromXhtml, paletteVars, rasterAt, TEX_ROOT, type HtmlTemplate } from "./bgTextures.js";
import { KINO_DEFS, motionScrubCss } from "./motionCss.js";
import {
  buildMotionLayoutManifest,
  disposeMotionFrameBundle,
  openMotionLensHost,
  type MotionFrameBundle,
  type MotionPaintPlates,
} from "./lensLayout.js";
import { buildLensPlateScrubs, type LensPlateScrubs } from "./lensPaintOrder.js";
import * as prof from "./compositor/profile.js";
import { stripUnrenderedImagery } from "./pruneHidden.js";

export type {
  LensLayoutEntry,
  LensMaterial,
  MotionFrameBundle,
  MotionLayoutManifest,
  MotionLensHost,
  MotionPaintPlates,
} from "./lensLayout.js";
export type { LensPlateScrubs } from "./lensPaintOrder.js";
export {
  buildMotionLayoutManifest,
  disposeMotionFrameBundle,
  layoutMotionFrame,
  manifestLensRects,
  openMotionLensHost,
} from "./lensLayout.js";
export { buildLensPlateScrubs } from "./lensPaintOrder.js";

/** Full scene with every `kino-lens` hidden — what's optically behind the glass. */
export const LENS_SAMPLE_SCRUB = `.kino-lens,.kino-lens *{visibility:hidden!important}`;

/**
 * Lens descendants only — everything else hidden; shell bg + pseudos stripped.
 * Transparent pixels outside lens trees → safe full-frame alpha-over at composite.
 */
export const LENS_CHROME_SCRUB =
  `.${TEX_ROOT} *{visibility:hidden!important}` +
  `.${TEX_ROOT} .kino-lens,.${TEX_ROOT} .kino-lens *{visibility:visible!important}` +
  `.kino-lens{background:transparent!important;background-image:none!important;box-shadow:none!important}` +
  `.kino-lens::before,.kino-lens::after{display:none!important;content:none!important}`;

/** Motion scrub + beat vars on the same root FO uses — keeps lens measure host in sync with raster. */
export function motionVarsCss(vars: Record<string, string>): string {
  return `.${TEX_ROOT}{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";")}}`;
}

export function motionHostCss(vars: Record<string, string>, extra = ""): string {
  return motionScrubCss(TEX_ROOT) + motionVarsCss(vars) + extra;
}

export interface MotionRasterProbe {
  texRoot: HTMLElement;
  unmount: () => void;
}

/**
 * Live layout probe matching buildTemplate → foreignObject (inner sized div inside .kino-tex-root).
 * Not the wrapMotionHtml shortcut — that tree diverges from the FO raster and desyncs mirrors.
 */
export function mountMotionRasterProbe(
  html: string,
  vars: Record<string, string>,
  theme: Theme,
  width: number,
  height: number,
  defs = "",
): MotionRasterProbe {
  const probe = document.createElement("div");
  probe.setAttribute(
    "style",
    `position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;${paletteVars(theme)}`,
  );
  const style = document.createElement("style");
  style.textContent = motionHostCss(vars);
  probe.appendChild(style);
  if (defs) probe.insertAdjacentHTML("beforeend", defs);

  const inner = document.createElement("div");
  inner.style.position = "relative";
  inner.style.width = `${width}px`;
  inner.style.height = `${height}px`;
  inner.innerHTML = html;

  const texRoot = document.createElement("div");
  texRoot.className = TEX_ROOT;
  texRoot.style.cssText = `width:${width}px;height:${height}px;background:transparent`;
  texRoot.appendChild(inner);
  probe.appendChild(texRoot);
  document.body.appendChild(probe);
  void texRoot.offsetHeight;
  return { texRoot, unmount: () => probe.remove() };
}

function motionCss(vars: Record<string, string>, extra = ""): string {
  return motionHostCss(vars, extra);
}

function needsMotionDefs(html: string): boolean {
  return /\bkino-(grain|vignette)\b|filter:\s*url\(#kino-/.test(html);
}

export function motionNeedsLensLayers(html: string): boolean {
  return LENS_CLASS_RE.test(html);
}

/** FO supersample floor. 1 = no FO supersample (the default since it became opt-in). */
export const MOTION_FO_MIN_SCALE = 1;

/**
 * Raise the floor with `--quality very-high` or an explicit `KINO_MOTION_FO_SCALE=2`.
 *
 * The 2× floor was the default until 2026-07-28. It costs ~17% of render wall on the macOS demo
 * (36s → 30s at c=4) and on a still it is close to invisible — 0.0104 on menubar glyphs, 0.0104
 * on dock icons, and bit-identical on the hoisted GL underlay, which never passes through the FO
 * raster at all.
 *
 * **It is not only antialiasing, and a still cannot show what it costs.** At 1× the FO snaps
 * transforms to whole pixels, so sub-pixel motion — cursor paths, slow window scaling — steps
 * visibly across frames. If motion judder shows up, this is the first knob to put back. It is part
 * of the frame-cache key, so a lowered run can never serve 2× frames or vice versa.
 */
function motionFoMin(): number {
  const v = (globalThis as { __kinoMotionFoMin?: number }).__kinoMotionFoMin;
  return typeof v === "number" && v > 0 ? v : MOTION_FO_MIN_SCALE;
}

export function motionFoScale(outScale: number): number {
  return Math.max(outScale, motionFoMin());
}

function downscaleCanvasTo(canvas: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  if (canvas.width === w && canvas.height === h) return canvas;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, w, h);
  return out;
}

/** Match plate pixel size to compositor outScale after optional FO supersample. */
export function normalizeMotionPlates(
  plates: MotionPaintPlates,
  pageW: number,
  pageH: number,
  outScale: number,
): MotionPaintPlates {
  const wantW = Math.round(pageW * outScale);
  const wantH = Math.round(pageH * outScale);
  if (plates.sample.width === wantW && plates.sample.height === wantH) return plates;
  // On the non-lens path full/sample/chrome alias ONE canvas — downscale once, not three times.
  const sample = downscaleCanvasTo(plates.sample, wantW, wantH);
  return {
    full: plates.full ? (plates.full === plates.sample ? sample : downscaleCanvasTo(plates.full, wantW, wantH)) : undefined,
    sample,
    chrome: plates.chrome === plates.sample ? sample : downscaleCanvasTo(plates.chrome, wantW, wantH),
    foreground: plates.foreground ? downscaleCanvasTo(plates.foreground, wantW, wantH) : undefined,
  };
}

async function rasterMotionPlates(
  html: string,
  vars: Record<string, string>,
  theme: Theme,
  width: number,
  height: number,
  outScale: number,
  scrubs?: LensPlateScrubs,
  existingTpl?: HtmlTemplate,
): Promise<MotionPaintPlates | null> {
  const foScale = motionFoScale(outScale);
  const defs = needsMotionDefs(html) ? KINO_DEFS : undefined;
  const tpl =
    existingTpl ??
    (await buildTemplate(html, theme, {
      size: { w: width, h: height },
      scale: foScale,
      defs,
    }));
  const sampleScrub = LENS_SAMPLE_SCRUB + (scrubs?.sampleExtra ?? "");
  // No `full` raster here: this is the lens-post path, and both lens composites (GPU node and
  // CPU mirror fallback) rebuild the frame from sample+chrome(+foreground). A full-scene pass
  // would re-decode the same image payload a fourth time for pixels nothing samples.
  const [sample, chrome, foreground] = await prof.awaited("motion:plates", () =>
    Promise.all([
      rasterAt(tpl, "sample", motionCss(vars, sampleScrub), null),
      rasterAt(tpl, "chrome", motionCss(vars, LENS_CHROME_SCRUB), null),
      scrubs?.hasForeground
        ? rasterAt(tpl, "foreground", motionCss(vars, scrubs.foregroundScrub), null)
        : Promise.resolve(null),
    ]),
  );
  if (!sample || !chrome) return null;
  return prof.sync("motion:normalize", () =>
    normalizeMotionPlates(
      { sample, chrome, foreground: foreground ?? undefined },
      width,
      height,
      outScale,
    ),
  );
}

/**
 * Rewrites `/public/...` refs to data URLs. Only the markup that reaches a foreignObject needs it
 * — an SVG-as-image is an isolated document and cannot fetch anything. The live measure host is a
 * real document in a real page, so it keeps the plain URLs and skips the payload entirely.
 */
export type InlineRefs = (html: string) => Promise<string>;

export async function rasterMotionFull(
  html: string,
  vars: Record<string, string>,
  theme: Theme,
  width: number,
  height: number,
  scale: number,
  inline?: InlineRefs,
): Promise<HTMLCanvasElement | null> {
  // Non-lens path: the full scene IS the frame — one raster, no scrub variants. (This used to
  // route through rasterMotionPlates and pay sample+chrome rasters that were discarded.)
  const foScale = motionFoScale(scale);
  const defs = needsMotionDefs(html) ? KINO_DEFS : undefined;
  const foHtml = inline ? await inline(html) : html;
  const tpl = await buildTemplate(foHtml, theme, { size: { w: width, h: height }, scale: foScale, defs });
  const full = await prof.awaited("motion:plates", () => rasterAt(tpl, "full", motionCss(vars), null));
  if (!full) return null;
  return prof.sync("motion:normalize", () =>
    normalizeMotionPlates({ full, sample: full, chrome: full }, width, height, scale),
  ).sample;
}

export async function prepareMotionFrameBundle(
  html: string,
  vars: Record<string, string>,
  theme: Theme,
  width: number,
  height: number,
  scale: number,
  inline?: InlineRefs,
): Promise<MotionFrameBundle | null> {
  const defs = needsMotionDefs(html) ? KINO_DEFS : "";
  const lensHost = motionNeedsLensLayers(html)
    ? prof.sync("motion:lensHost", () => openMotionLensHost(html, vars, theme, width, height, defs))
    : undefined;
  const manifest = lensHost
    ? prof.sync("motion:manifest", () => buildMotionLayoutManifest(lensHost, width, height, scale))
    : { pageW: width, pageH: height, rasterScale: scale, lenses: [], quads: [] };
  const scrubs = lensHost
    ? prof.sync("motion:scrubs", () => buildLensPlateScrubs(lensHost.texRoot, lensHost.stack))
    : undefined;
  // After the manifest and scrubs (which need the intact tree), before serialisation: an
  // SVG-as-image decodes every referenced image regardless of visibility, so anything that
  // produces no boxes is pure decode cost. Engine-side because a proc author cannot see it.
  if (lensHost) {
    prof.addSample(
      "motion:strippedImagery",
      prof.sync("motion:strip", () => stripUnrenderedImagery(lensHost.texRoot)),
    );
  }

  let tpl: HtmlTemplate | undefined;
  if (lensHost) {
    const inner = lensHost.texRoot.firstElementChild;
    if (inner) {
      const xhtml = prof.sync("motion:serialize", () =>
        new XMLSerializer().serializeToString(inner),
      );
      // Inline AFTER serialising, not before mounting. The host only ever needed structure and
      // CSS — every img in a motion proc is explicitly sized, so image bytes never affect the
      // measured layout. Carrying them into the live DOM meant parsing ~1MB of base64 per frame
      // to learn rects that CSS already determined.
      const foXhtml = inline ? await prof.awaited("motion:inline", () => inline(xhtml)) : xhtml;
      tpl = await prof.awaited("motion:tpl", () =>
        buildTemplateFromXhtml(foXhtml, theme, width, height, {
          scale: motionFoScale(scale),
          defs: defs || undefined,
        }),
      );
    }
  }

  // Unmount as soon as the manifest, scrubs and template are out. Bundles used to RETAIN their
  // host until cache eviction, so up to motionCacheMax live scene trees sat in the document at
  // once and every new mount paid style/layout across all of them: 11.95ms/frame with retention,
  // 2.23ms without. The host is pure scaffolding — everything downstream needs is already
  // extracted by this point.
  lensHost?.unmount();

  const plates = await rasterMotionPlates(html, vars, theme, width, height, scale, scrubs, tpl);
  if (!plates) return null;
  return {
    manifest,
    plates,
    needsLensPost: motionNeedsLensLayers(html),
    vars,
    // Deliberately NOT carrying the host: it is detached now, and a detached tree measures zero
    // rects rather than failing, which would corrupt the CPU mirror fallback silently. Omitting
    // it makes that path take its explicit `!host` branch instead. The GPU lens composite — the
    // only path the compositor uses — reads the manifest and plates, never the host.
  };
}
