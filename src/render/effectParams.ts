// Resolve an authored effect list at a point in time.
//
// Effect params used to be frozen for a whole beat, so an effect could only describe a constant —
// a blur that should ramp smeared the entire beat instead. Every pass already receives its params
// fresh each frame (effects/pass.ts), and layers.ts already rewrites them per frame for `auto`
// motion blur, so the renderer never needed a change: the tween resolves here, one step earlier,
// and what reaches the compositor is the same static {kind, params} shape as before.
import { paramsAt } from "./bgparams.js";
import type { LayerEffect } from "./maskSpec.js";

/**
 * `effects` with every keyframed param evaluated at `tSec`.
 *
 * `tSec` is relative to the effect's owner: the beat's start for a segment's `effects`, the
 * layer's own start for a declared layer's `effects`/`adjust`. Base `params` act as an implicit
 * t=0 keyframe (`implicitBase`), so a lone keyframe tweens from the authored base — the same
 * idiom motion-graphic params use.
 *
 * Returns the input array by reference when nothing is keyframed, so the common case allocates
 * nothing on a per-frame path.
 */
export function resolveEffects(
  effects: LayerEffect[] | undefined,
  tSec: number,
): LayerEffect[] | undefined {
  if (!effects?.length) return effects;
  if (!effects.some((e) => e.keyframes?.length)) return effects;
  return effects.map((e) =>
    e.keyframes?.length
      ? { kind: e.kind, params: paramsAt(e.params ?? {}, e.keyframes, tSec, { implicitBase: true }) }
      : e,
  );
}
