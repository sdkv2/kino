// Dual FO plates for backdrop-sampling lenses: field (shell) + chrome (descendants).
import type { Theme } from "../../props.js";
import { LENS_CLASS_RE } from "../../lensContract.js";
import { buildTemplate, rasterAt, TEX_ROOT } from "./bgTextures.js";
import { KINO_DEFS, motionScrubCss } from "./motionCss.js";

export interface MotionRasterLayers {
  full: HTMLCanvasElement;
  field: HTMLCanvasElement;
  chrome: HTMLCanvasElement;
}

/** Lens shell only — direct descendants hidden so mirror samples desk / vibrancy, not UI chrome. */
export const LENS_FIELD_SCRUB = `.kino-lens>*{visibility:hidden!important}`;

/**
 * Lens descendants only — everything else hidden; shell bg + pseudos stripped.
 * Transparent pixels outside lens trees → safe full-frame alpha-over at composite.
 */
export const LENS_CHROME_SCRUB =
  `.${TEX_ROOT} *{visibility:hidden!important}` +
  `.${TEX_ROOT} .kino-lens,.${TEX_ROOT} .kino-lens *{visibility:visible!important}` +
  `.kino-lens{background:transparent!important;background-image:none!important;box-shadow:none!important}` +
  `.kino-lens::before,.kino-lens::after{display:none!important;content:none!important}`;

function varsCss(vars: Record<string, string>): string {
  return `.${TEX_ROOT}{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";")}}`;
}

function motionCss(html: string, vars: Record<string, string>, extra = ""): string {
  return motionScrubCss(TEX_ROOT) + varsCss(vars) + extra;
}

async function rasterOnce(
  html: string,
  vars: Record<string, string>,
  theme: Theme,
  width: number,
  height: number,
  scale: number,
  extraCss: string,
  key: string,
): Promise<HTMLCanvasElement | null> {
  const css = motionCss(html, vars, extraCss);
  const tpl = await buildTemplate(html, theme, {
    size: { w: width, h: height },
    scale,
    defs: /\bkino-(grain|vignette)\b|filter:\s*url\(#kino-/.test(html) ? KINO_DEFS : undefined,
  });
  return rasterAt(tpl, key, css, null);
}

export function motionNeedsLensLayers(html: string): boolean {
  return LENS_CLASS_RE.test(html);
}

export async function rasterMotionFull(
  html: string,
  vars: Record<string, string>,
  theme: Theme,
  width: number,
  height: number,
  scale: number,
): Promise<HTMLCanvasElement | null> {
  return rasterOnce(html, vars, theme, width, height, scale, "", "full");
}

export async function rasterMotionLayers(
  html: string,
  vars: Record<string, string>,
  theme: Theme,
  width: number,
  height: number,
  scale: number,
): Promise<MotionRasterLayers | null> {
  const [full, field, chrome] = await Promise.all([
    rasterOnce(html, vars, theme, width, height, scale, "", "full"),
    rasterOnce(html, vars, theme, width, height, scale, LENS_FIELD_SCRUB, "field"),
    rasterOnce(html, vars, theme, width, height, scale, LENS_CHROME_SCRUB, "chrome"),
  ]);
  if (!full || !field || !chrome) return null;
  return { full, field, chrome };
}
