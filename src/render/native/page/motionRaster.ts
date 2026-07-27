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

/** FO supersample — draft SS=1 still FO-rasters at 2× then downsamples (1× FO snaps transforms to whole px). */
export const MOTION_FO_MIN_SCALE = 2;

export function motionFoScale(outScale: number): number {
  return Math.max(outScale, MOTION_FO_MIN_SCALE);
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
  if (plates.full.width === wantW && plates.full.height === wantH) return plates;
  return {
    full: downscaleCanvasTo(plates.full, wantW, wantH),
    sample: downscaleCanvasTo(plates.sample, wantW, wantH),
    chrome: downscaleCanvasTo(plates.chrome, wantW, wantH),
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
  const [full, sample, chrome, foreground] = await Promise.all([
    rasterAt(tpl, "full", motionCss(vars), null),
    rasterAt(tpl, "sample", motionCss(vars, sampleScrub), null),
    rasterAt(tpl, "chrome", motionCss(vars, LENS_CHROME_SCRUB), null),
    scrubs?.hasForeground
      ? rasterAt(tpl, "foreground", motionCss(vars, scrubs.foregroundScrub), null)
      : Promise.resolve(null),
  ]);
  if (!full || !sample || !chrome) return null;
  return normalizeMotionPlates(
    { full, sample, chrome, foreground: foreground ?? undefined },
    width,
    height,
    outScale,
  );
}

export async function rasterMotionFull(
  html: string,
  vars: Record<string, string>,
  theme: Theme,
  width: number,
  height: number,
  scale: number,
): Promise<HTMLCanvasElement | null> {
  const plates = await rasterMotionPlates(html, vars, theme, width, height, scale);
  return plates?.full ?? null;
}

export async function prepareMotionFrameBundle(
  html: string,
  vars: Record<string, string>,
  theme: Theme,
  width: number,
  height: number,
  scale: number,
): Promise<MotionFrameBundle | null> {
  const defs = needsMotionDefs(html) ? KINO_DEFS : "";
  const lensHost = motionNeedsLensLayers(html)
    ? openMotionLensHost(html, vars, theme, width, height, defs)
    : undefined;
  const manifest = lensHost
    ? buildMotionLayoutManifest(lensHost, width, height, scale)
    : { pageW: width, pageH: height, rasterScale: scale, lenses: [] };
  const scrubs = lensHost ? buildLensPlateScrubs(lensHost.texRoot, lensHost.stack) : undefined;
  let tpl: HtmlTemplate | undefined;
  if (lensHost) {
    const inner = lensHost.texRoot.firstElementChild;
    if (inner) {
      const xhtml = new XMLSerializer().serializeToString(inner);
      tpl = await buildTemplateFromXhtml(xhtml, theme, width, height, {
        scale: motionFoScale(scale),
        defs: defs || undefined,
      });
    }
  }

  const plates = await rasterMotionPlates(html, vars, theme, width, height, scale, scrubs, tpl);
  if (!plates) {
    lensHost?.unmount();
    return null;
  }
  return {
    manifest,
    plates,
    needsLensPost: motionNeedsLensLayers(html),
    vars,
    lensHost,
  };
}
