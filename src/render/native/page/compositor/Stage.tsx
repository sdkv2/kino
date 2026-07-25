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
import type { TextureSource } from "./graph.js";

export interface StageHandle {
  seek(frame: number): Promise<void>;
  dispose(): void;
}

export function createStage(
  canvas: HTMLCanvasElement,
  props: KinoProps,
  dims: Dims,
  media: MediaMap,
  scale: number,
): StageHandle {
  const renderer = new StageRenderer(canvas, { width: dims.width, height: dims.height, ss: scale });
  const sources: Map<string, TextureSource> = buildRegistry(props, dims, media, scale);

  return {
    async seek(frame: number): Promise<void> {
      const layers = layersAt(props, frame, dims);
      // Phase A — every source that this frame needs, prepared concurrently.
      await Promise.all(
        layers.map((l) => sources.get(l.source.providerId)?.prepare(frame, l.source.key) ?? Promise.resolve()),
      );
      // Phase B — synchronous.
      renderer.draw(layers, sources, frame);
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
      {/* Staging DOM: laid out for real (so CSS, vw units and fonts resolve) but never
          composited into the frame. */}
      <div
        ref={stagingRef}
        id="kino-staging"
        style={{ position: "absolute", left: -99999, top: 0, width: dims.width, height: dims.height, visibility: "hidden" }}
      />
    </>
  );
};
