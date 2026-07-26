// Layer grouping. A transition mixes two beats, which means each beat has to composite into
// its own target before they meet — so layers carry a group tag and the renderer walks groups
// rather than one flat list.
//
// Pure and node-testable: the grouping decision is spec-derived, not GL-derived.
import type { LayerDraw } from "./graph.js";

/** Layers with no group belong to "base": the backdrop, the disclosure, the film finish —
 *  everything that is not part of a beat and so never participates in a transition. */
export const BASE_GROUP = "base";

export function groupsOf(layers: LayerDraw[]): Map<string, LayerDraw[]> {
  const out = new Map<string, LayerDraw[]>();
  for (const layer of layers) {
    const key = layer.group ?? BASE_GROUP;
    const bucket = out.get(key);
    if (bucket) bucket.push(layer);
    else out.set(key, [layer]);
  }
  return out;
}

/** Consecutive layers sharing a group id — preserves z-order when base layers interleave beats. */
export function groupRuns(layers: LayerDraw[]): LayerDraw[][] {
  const runs: LayerDraw[][] = [];
  let current: LayerDraw[] = [];
  let key: string | undefined;
  for (const layer of layers) {
    const g = layer.group ?? BASE_GROUP;
    if (current.length && g !== key) {
      runs.push(current);
      current = [];
    }
    key = g;
    current.push(layer);
  }
  if (current.length) runs.push(current);
  return runs;
}
