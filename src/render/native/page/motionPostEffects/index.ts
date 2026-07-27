// Post-raster hooks for motion HTML (backdrop-sampling effects run after foreignObject raster).
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
  field?: HTMLCanvasElement;
  chrome?: HTMLCanvasElement;
  html: string;
  vars: Record<string, string>;
  width: number;
  height: number;
  gl?: WebGL2RenderingContext;
  lensShaders?: Record<string, string>;
}): MotionPostResult {
  let current: MotionPostResult = ctx.base;
  for (const effect of effects) {
    if (!effect.test(ctx.html) || isGpuMotionPostResult(current)) continue;
    current = effect.apply({ ...ctx, base: current });
  }
  return current;
}
