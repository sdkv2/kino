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
import { buildLensPlateScrubs, type LensPlateScrubs } from "./lensPaintOrder.js";
import { measureHoistedQuads, type HoistedQuad } from "./underlay.js";

export type { HoistedQuad } from "./underlay.js";
export type { LensMaterial } from "./lensMirror.js";
export type { LensPlateScrubs } from "./lensPaintOrder.js";
export { buildLensPlateScrubs } from "./lensPaintOrder.js";

export interface LensLayoutEntry extends BakedLensPass {
  index: number;
}

/** Layout sidecar for one motion frame — rects + materials from FO-identical host. */
export interface MotionLayoutManifest {
  pageW: number;
  pageH: number;
  rasterScale: number;
  lenses: LensLayoutEntry[];
  /** Imagery hoisted out of the raster and blitted at these rects (see underlay.ts). */
  quads: HoistedQuad[];
}

export interface MotionPaintPlates {
  /**
   * Full FO raster. ABSENT on the lens-post path: both the GPU lens composite and the CPU
   * mirror fallback rebuild the frame from sample+chrome(+foreground), so rastering the whole
   * scene a fourth time was pure decode-pool contention. Non-lens bundles always set it — there
   * it IS the frame (sample/chrome alias it).
   */
  full?: HTMLCanvasElement;
  /** Scene with lenses hidden — optical input for mirror sampling. */
  sample: HTMLCanvasElement;
  /** Lens descendants only — composited above glass passes. */
  chrome: HTMLCanvasElement;
  /** Non-lens content that paints above the lens stack — composited last. */
  foreground?: HTMLCanvasElement;
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
  /** Lens post path (backdrop sampling) — avoids retaining multi-MB inlined html per cache entry. */
  needsLensPost: boolean;
  vars: Record<string, string>;
  /** Mounted through texture() — unmount on cache eviction. */
  lensHost?: MotionLensHost;
}

export function disposeMotionFrameBundle(bundle: MotionFrameBundle): void {
  bundle.lensHost?.unmount();
  bundle.lensHost = undefined;
  const { plates } = bundle;
  for (const c of [plates.full, plates.sample, plates.chrome, plates.foreground]) {
    if (c) {
      c.width = 0;
      c.height = 0;
    }
  }
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
  const quads = measureHoistedQuads(host.texRoot, hostRect);
  return { pageW, pageH, rasterScale, lenses, quads };
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
