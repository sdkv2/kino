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
import { awaited, sync } from "./profile.js";

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
  /** Output canvas. Defaults to the composition size; a draft passes a smaller surface, which
   *  shrinks the pixels the whole stage is rasterised onto without touching the layout. */
  out: Dims = dims,
): StageHandle {
  const renderer = new StageRenderer(canvas, { width: out.width, height: out.height, ss, comp: dims });
  const renderDims = { width: out.width * ss, height: out.height * ss };
  // Markup rasters lay out at composition size (see buildRegistry), so the supersample has to
  // come from the raster scale — an SS=2 composite wants its caption/motion SVGs drawn at 2×.
  // A draft rides the same lever the other way: comp px → fewer target px.
  const rasterScale = (out.width * ss) / dims.width;
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
      await awaited("prefetch-wait", () => prefetch);
      const layers = sync("layersAt", () => layersAt(props, frame, dims));
      await awaited("prep:backdrop", () => sources.get("backdrop")?.prepare(frame));
      await awaited("prep:scrim", () => sources.get("scrim")?.prepare(frame));
      await Promise.all([
        // An adjustment layer (source === null) has no pixels to prepare — it runs a chain over
        // what is already composited.
        ...layers
          .map((l) => l.source)
          .filter((s): s is NonNullable<typeof s> => s !== null)
          .filter((s) => s.providerId !== "backdrop" && s.providerId !== "scrim")
          .map((s) => awaited(`prep:${s.providerId}`, () => sources.get(s.providerId)?.prepare(frame, s.key))),
        ...layers
          .map((l) => (l.mask as { source?: { kind?: string; layerId?: string } } | undefined)?.source)
          .filter((s): s is { kind: "layer"; layerId: string } => s?.kind === "layer")
          .map((ref) => {
            const mLayer = layers.find((l) => l.id === ref.layerId || l.source?.providerId === ref.layerId);
            const providerId = mLayer?.source ? mLayer.source.providerId : ref.layerId;
            return sources.get(providerId)?.prepare(frame, mLayer?.source?.key);
          }),
        // File-kind masks read extracted lmask frames (coverage + SDF) — prepare those sources too,
        // or the mask pass binds a texture that was never uploaded this frame.
        ...layers
          .filter((l) => (l.mask as { source?: { kind?: string } } | undefined)?.source?.kind === "file")
          .map((l) => {
            const beatKey = l.group ? `lmask${/^beat(\d+)$/.exec(l.group)?.[1] ?? ""}` : "";
            const key = `lmask-${l.id}`;
            const src = sources.get(key) ?? (beatKey ? sources.get(beatKey) : undefined);
            return src?.prepare(frame, l.source?.key);
          }),
      ]);
      sync("draw", () => renderer.draw(layers, sources, frame, { theme: props.theme, postFx: props.postFx, props }));
      const next = sync("layersAt", () => layersAt(props, frame + 1, dims));
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
  /** Output canvas size; defaults to the composition size. */
  out?: Dims;
  onReady: (handle: StageHandle) => void;
}> = ({ props, dims, media, scale, out, onReady }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stagingRef = useRef<HTMLDivElement>(null);
  const outDims = out ?? dims;

  useLayoutEffect(() => {
    if (!canvasRef.current) return;
    const handle = createStage(canvasRef.current, props, dims, media, scale, outDims);
    onReady(handle);
    return () => handle.dispose();
  }, [props, dims, media, scale, outDims, onReady]);

  return (
    <>
      <canvas
        ref={canvasRef}
        id="kino-stage"
        width={outDims.width}
        height={outDims.height}
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
