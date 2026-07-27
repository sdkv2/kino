// Post-raster hooks for motion HTML (backdrop-sampling effects run after foreignObject raster).
import type { MotionLayoutManifest } from "../lensLayout.js";
import { lensPostEffect } from "./lens.js";
import { isGpuMotionPostResult, type MotionPostResult } from "./types.js";
export type { MotionPostEffect, MotionPostResult, GpuMotionPostResult } from "./types.js";
export { isGpuMotionPostResult } from "./types.js";

const effects = [lensPostEffect];

export function motionNeedsBackdropSampling(html: string): boolean {
  return effects.some((e) => e.test(html));
}

/** @deprecated use motionNeedsBackdropSampling */
export function motionNeedsCompositorBackdrop(html: string): boolean {
  return motionNeedsBackdropSampling(html);
}

export function applyMotionPostEffects(ctx: {
  base: HTMLCanvasElement;
  sample?: HTMLCanvasElement;
  manifest?: MotionLayoutManifest;
  plates?: import("../lensLayout.js").MotionPaintPlates;
  lensHost?: import("../lensLayout.js").MotionLensHost;
  chrome?: HTMLCanvasElement;
  html: string;
  vars: Record<string, string>;
  width: number;
  height: number;
  theme: import("../../props.js").Theme;
  gl?: WebGL2RenderingContext;
  underlay?: import("../underlay.js").UnderlayPlate | null;
  quadPlates?: Map<string, import("../underlay.js").UnderlayPlate>;
  lensShaders?: Record<string, string>;
}): MotionPostResult {
  let current: MotionPostResult = ctx.base;
  for (const effect of effects) {
    if (!effect.test(ctx.html) || isGpuMotionPostResult(current)) continue;
    current = effect.apply({ ...ctx, base: current });
  }
  return current;
}
