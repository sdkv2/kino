import type { LayerDraw } from "./graph.js";

/** `(providerId, key)` identity for a layer's raster cache. Null on an adjustment layer, which
 *  has no source to prefetch. */
export function sourceKey(layer: LayerDraw): { providerId: string; key?: string } | null {
  return layer.source ? { providerId: layer.source.providerId, key: layer.source.key } : null;
}

const keyId = (k: { providerId: string; key?: string }) => `${k.providerId}\0${k.key ?? ""}`;

/** Sources the next frame needs that this frame did not — candidates for prefetch. */
export function nextFrameKeys(current: LayerDraw[], next: LayerDraw[]): Array<{ providerId: string; key?: string }> {
  const cur = new Set(
    current.map(sourceKey).filter((k): k is { providerId: string; key?: string } => k !== null).map(keyId),
  );
  const out: Array<{ providerId: string; key?: string }> = [];
  const seen = new Set<string>();
  for (const layer of next) {
    const k = sourceKey(layer);
    if (!k) continue;
    const id = keyId(k);
    if (cur.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(k);
  }
  return out;
}
