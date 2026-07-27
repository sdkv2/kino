// Per-frame layout manifest for kino-lens — single authority for mirror placement + baked material.
import type { Theme } from "../../props.js";
import { LENS_SELECTOR } from "../../lensContract.js";
import {
  lensPageRect,
  lensStackOrder,
  scrapeLensLayout,
  type BakedLensPass,
  type LensMaterial,
  type LensPageRect,
} from "./lensMirror.js";
import { mountMotionRasterProbe } from "./motionRaster.js";

export type { LensMaterial } from "./lensMirror.js";

export interface LensLayoutEntry extends BakedLensPass {
  index: number;
}

/** Layout sidecar for one motion frame — rects + materials from FO-identical host. */
export interface MotionLayoutManifest {
  pageW: number;
  pageH: number;
  rasterScale: number;
  lenses: LensLayoutEntry[];
}

export interface MotionPaintPlates {
  full: HTMLCanvasElement;
  /** Scene with lenses hidden — optical input for mirror sampling. */
  sample: HTMLCanvasElement;
  /** Lens descendants only — composited above glass passes. */
  chrome: HTMLCanvasElement;
}

/** Live DOM host kept mounted while a frame bundle is cached (layout == raster tree). */
export interface MotionLensHost {
  texRoot: HTMLElement;
  stack: HTMLElement[];
  unmount: () => void;
}

/** Cached in motion provider prepare() alongside FO plates. */
export interface MotionFrameBundle {
  manifest: MotionLayoutManifest;
  plates: MotionPaintPlates;
  html: string;
  vars: Record<string, string>;
  /** Mounted through texture() — unmount on cache eviction. */
  lensHost?: MotionLensHost;
}

export function disposeMotionFrameBundle(bundle: MotionFrameBundle): void {
  bundle.lensHost?.unmount();
  bundle.lensHost = undefined;
}

export function manifestLensRects(manifest: MotionLayoutManifest): LensPageRect[] {
  return manifest.lenses.map((l) => l.pageRect);
}

/** FO-identical measure host — matches buildTemplate → foreignObject tree. */
export function openMotionLensHost(
  html: string,
  vars: Record<string, string>,
  theme: Theme,
  pageW: number,
  pageH: number,
  defs = "",
): MotionLensHost {
  const probe = mountMotionRasterProbe(html, vars, theme, pageW, pageH, defs);
  const stack = lensStackOrder(Array.from(probe.texRoot.querySelectorAll<HTMLElement>(LENS_SELECTOR)));
  return { texRoot: probe.texRoot, stack, unmount: probe.unmount };
}

export function buildMotionLayoutManifest(
  host: MotionLensHost,
  pageW: number,
  pageH: number,
  rasterScale: number,
): MotionLayoutManifest {
  const hostRect = host.texRoot.getBoundingClientRect();
  const lenses: LensLayoutEntry[] = host.stack.map((el, index) => {
    const pageRect = lensPageRect(el, hostRect);
    const scraped = scrapeLensLayout(el);
    return { index, pageRect, ...scraped };
  });
  return { pageW, pageH, rasterScale, lenses };
}

/** One-shot layout (mount → measure → unmount). Prefer openMotionLensHost + bundle cache. */
export function layoutMotionFrame(
  html: string,
  vars: Record<string, string>,
  theme: Theme,
  pageW: number,
  pageH: number,
  rasterScale: number,
  defs = "",
): MotionLayoutManifest {
  const host = openMotionLensHost(html, vars, theme, pageW, pageH, defs);
  try {
    return buildMotionLayoutManifest(host, pageW, pageH, rasterScale);
  } finally {
    host.unmount();
  }
}
