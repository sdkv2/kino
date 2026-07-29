// Layer grouping. A transition mixes two beats, which means each beat has to composite into
// its own target before they meet — so layers carry a group tag and the renderer walks groups
// rather than one flat list.
//
// Pure and node-testable: the grouping decision is spec-derived, not GL-derived.
import type { LayerDraw } from "./graph.js";

/** Layers with no group belong to "base": the backdrop, the disclosure, the film finish —
 *  everything that is not part of a beat and so never participates in a transition. */
export const BASE_GROUP = "base";

/**
 * Consecutive layers sharing a group id — preserves z-order when base layers interleave beats.
 *
 * An adjustment layer (`adjust`, no source) always stands alone, even among base layers it would
 * otherwise run with: it consumes everything composited beneath it, so it is a barrier in the
 * walk, not a member of a run. Without this, a scene beat's `[backdrop, scrim, film]` would come
 * back as one run and the finish would either be skipped or drawn as if it had pixels.
 */
export function groupRuns(layers: LayerDraw[]): LayerDraw[][] {
  const isAdjustment = (l: LayerDraw): boolean => Boolean(l.adjust?.length);
  const runs: LayerDraw[][] = [];
  let current: LayerDraw[] = [];
  let key: string | undefined;
  for (const layer of layers) {
    const g = layer.group ?? BASE_GROUP;
    // Break on a group change, and on BOTH sides of an adjustment layer.
    if (current.length && (g !== key || isAdjustment(layer) || isAdjustment(current[0]))) {
      runs.push(current);
      current = [];
    }
    key = g;
    current.push(layer);
  }
  if (current.length) runs.push(current);
  return runs;
}
