// Post-raster hooks for motion HTML (backdrop-sampling effects run after foreignObject raster).
import { glassPostEffect } from "./glass.js";
import { isGpuMotionPostResult, type MotionPostResult } from "./types.js";
export type { MotionPostEffect, MotionPostResult, GpuMotionPostResult } from "./types.js";
export { isGpuMotionPostResult } from "./types.js";

const effects = [glassPostEffect];

export function motionNeedsCompositorBackdrop(html: string): boolean {
  return effects.some((e) => e.test(html));
}

export function applyMotionPostEffects(ctx: {
  base: HTMLCanvasElement;
  html: string;
  vars: Record<string, string>;
  width: number;
  height: number;
  gl?: WebGL2RenderingContext;
}): MotionPostResult {
  let current: MotionPostResult = ctx.base;
  for (const effect of effects) {
    if (!effect.test(ctx.html) || isGpuMotionPostResult(current)) continue;
    current = effect.apply({ ...ctx, base: current });
  }
  return current;
}
