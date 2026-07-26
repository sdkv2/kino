import type { LayerDraw } from "./graph.js";

/** `(providerId, key)` identity for a layer's raster cache. */
export function sourceKey(layer: LayerDraw): { providerId: string; key?: string } {
  return { providerId: layer.source.providerId, key: layer.source.key };
}

const keyId = (k: { providerId: string; key?: string }) => `${k.providerId}\0${k.key ?? ""}`;

/** Sources the next frame needs that this frame did not — candidates for prefetch. */
export function nextFrameKeys(current: LayerDraw[], next: LayerDraw[]): Array<{ providerId: string; key?: string }> {
  const cur = new Set(current.map((l) => keyId(sourceKey(l))));
  const out: Array<{ providerId: string; key?: string }> = [];
  const seen = new Set<string>();
  for (const layer of next) {
    const k = sourceKey(layer);
    const id = keyId(k);
    if (cur.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(k);
  }
  return out;
}
