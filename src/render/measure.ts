// Layout geometry from the layer graph.
//
// Replaces engine.ts's collectMeasurements(), which walked the DOM for [data-measure] nodes.
// That approach cannot survive the compositor: staged markup sits off-screen at left:-99999,
// so every rect came back offset by that amount — silently wrong rather than absent.
//
// Reading the graph is also more accurate: these are the exact rects the renderer draws, and
// it covers layers that were never DOM elements at all.
import type { LayerDraw } from "./native/page/compositor/graph.js";
import type { Dims } from "./native/page/compositor/graph.js";

export interface ElementMeasure {
  label: string;
  x: number; y: number; w: number; h: number;
  cx: number; cy: number;
  cxPct: number; cyPct: number;
  dxPct: number; dyPct: number;
}

export function measureLayers(layers: LayerDraw[], dims: Dims): ElementMeasure[] {
  const { width: W, height: H } = dims;
  // Adjustment layers (e.g. the film finish) have `source: null` — they paint no pixels of
  // their own, they run a chain over whatever is already composited beneath them. They are
  // not a measurable element, so they're excluded here rather than left for every caller to
  // filter individually (see tests/layer-order-invariance.test.ts, which applies the same
  // reasoning to its own oracle).
  return layers.filter((layer) => layer.source !== null).map((layer) => {
    const { x, y, w, h } = layer.rect;
    const { scale, translate } = layer.transform;
    // Transform scales about the rect center, then translates — the same order modelMatrix
    // applies in the renderer. Rotation is deliberately not folded into w/h: a rotated
    // layer's axis-aligned bounds would misreport its actual size, and every consumer of
    // these numbers is checking alignment, not bounding boxes.
    const cx = x + w / 2 + translate[0];
    const cy = y + h / 2 + translate[1];
    const sw = w * scale;
    const sh = h * scale;
    return {
      label: layer.id,
      x: cx - sw / 2,
      y: cy - sh / 2,
      w: sw,
      h: sh,
      cx,
      cy,
      cxPct: (cx / W) * 100,
      cyPct: (cy / H) * 100,
      dxPct: (cx / W) * 100 - 50,
      dyPct: (cy / H) * 100 - 50,
    };
  });
}
