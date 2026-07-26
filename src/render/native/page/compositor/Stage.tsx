// The compositor stage: one visible canvas, plus a hidden staging DOM that exists only so
// rasterizable layers can be measured and serialized.
//
// The seek contract is two strict phases. Phase A is async — compute the layer list and let
// every source prepare (raster, decode, fetch). Phase B is synchronous — bind, transform,
// blend, present. Nothing in phase B touches CSS, layout or the network, which is where the
// determinism guarantee comes from.
import React, { useLayoutEffect, useRef } from "react";
import type { KinoProps } from "../../../props.js";
import type { MediaMap } from "../media.js";
import { layersAt } from "../../../layers.js";
import { StageRenderer } from "./renderer.js";
import { buildRegistry, type Dims } from "./registry.js";
import type { LayerDraw, TextureSource } from "./graph.js";
import { nextFrameKeys } from "./prefetch.js";

export { nextFrameKeys } from "./prefetch.js";

export interface StageHandle {
  seek(frame: number): Promise<void>;
  dispose(): void;
}

export function createStage(
  canvas: HTMLCanvasElement,
  props: KinoProps,
  dims: Dims,
  media: MediaMap,
  ss: number,
): StageHandle {
  const renderer = new StageRenderer(canvas, { width: dims.width, height: dims.height, ss });
  const renderDims = { width: dims.width * ss, height: dims.height * ss };
  // Markup rasters lay out at composition size (see buildRegistry), so the supersample has to
  // come from the raster scale — an SS=2 composite wants its caption/motion SVGs drawn at 2×.
  const rasterScale = ss;
  const sources: Map<string, TextureSource> = buildRegistry(props, renderDims, dims, media, rasterScale);
  let prefetch: Promise<void> = Promise.resolve();

  const prepareKeys = (keys: Array<{ providerId: string; key?: string }>, frame: number) =>
    Promise.all(
      keys.map((k) => {
        const src = sources.get(k.providerId);
        return src?.prepare(frame, k.key) ?? Promise.resolve();
      }),
    ).then(() => {});

  return {
    async seek(frame: number): Promise<void> {
      await prefetch;
      const layers = layersAt(props, frame, dims);
      await sources.get("backdrop")?.prepare(frame);
      await sources.get("scrim")?.prepare(frame);
      await Promise.all([
        ...layers
          .filter((l) => l.source.providerId !== "backdrop" && l.source.providerId !== "scrim")
          .map((l) => sources.get(l.source.providerId)?.prepare(frame, l.source.key) ?? Promise.resolve()),
        ...layers
          .map((l) => (l.mask as { source?: { kind?: string; layerId?: string } } | undefined)?.source)
          .filter((s): s is { kind: "layer"; layerId: string } => s?.kind === "layer")
          .map((ref) => {
            const mLayer = layers.find((l) => l.id === ref.layerId);
            return mLayer ? sources.get(mLayer.source.providerId)?.prepare(frame, mLayer.source.key) : undefined;
          }),
      ]);
      renderer.draw(layers, sources, frame, { theme: props.theme, postFx: props.postFx, props });
      const next = layersAt(props, frame + 1, dims);
      prefetch = prepareKeys(nextFrameKeys(layers, next), frame + 1);
    },
    dispose(): void {
      for (const s of sources.values()) s.dispose?.();
      renderer.dispose();
    },
  };
}

/** Mounts the visible canvas. The staging DOM lives beside it, off-screen. */
export const Stage: React.FC<{
  props: KinoProps;
  dims: Dims;
  media: MediaMap;
  scale: number;
  onReady: (handle: StageHandle) => void;
}> = ({ props, dims, media, scale, onReady }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stagingRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!canvasRef.current) return;
    const handle = createStage(canvasRef.current, props, dims, media, scale);
    onReady(handle);
    return () => handle.dispose();
  }, [props, dims, media, scale, onReady]);

  return (
    <>
      <canvas
        ref={canvasRef}
        id="kino-stage"
        width={dims.width}
        height={dims.height}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <div
        ref={stagingRef}
        id="kino-staging"
        style={{ position: "absolute", left: -99999, top: 0, width: dims.width, height: dims.height, visibility: "hidden" }}
      />
    </>
  );
};
