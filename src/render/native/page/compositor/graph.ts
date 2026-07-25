// The compositor's layer graph. Pure types plus one normalizer — no GL, no DOM, so both
// node-side tests and the page bundle import it freely.

/** Which source produces this layer's pixels, and which variant of it. */
export interface TextureRef {
  providerId: string; // registry key — "bg", "av0", "seg2", "motion2", "caption", …
  key?: string;       // content key within the provider: caption word index, scrub value, …
}

/** Phase-2 seam. Threaded through the renderer as a no-op in phase 1. */
export interface MaskRef {
  providerId: string;
  channel: "r" | "g" | "b" | "a" | "luma";
  invert?: boolean;
  feather?: number; // px, resolved against the SDF when the source has one
}

/** Phase-2 seam. Threaded through the renderer as a no-op in phase 1. */
export interface EffectRef {
  kind: string;
  params: Record<string, number | string>;
}

export type BlendMode = "normal" | "screen" | "multiply" | "add";

export interface LayerTransform {
  scale: number;
  rotate: number;          // degrees, about the rect center
  translate: [number, number]; // px
}

export interface LayerDraw {
  id: string;
  source: TextureRef;
  rect: { x: number; y: number; w: number; h: number }; // frame px, top-left origin
  transform: LayerTransform;
  opacity: number;
  blend: BlendMode;
  effects: EffectRef[];
  mask?: MaskRef;
}

/** What `layersAt` may omit; `normalizeLayer` fills the rest. */
export type LayerSpec = Pick<LayerDraw, "id" | "source" | "rect"> &
  Partial<Omit<LayerDraw, "id" | "source" | "rect">>;

/** Composition pixel dimensions. Defined once here — layers.ts, registry.ts and Stage.tsx
 *  all import this rather than declaring their own structurally-identical copy. */
export interface Dims {
  width: number;
  height: number;
}

export const IDENTITY_TRANSFORM: LayerTransform = { scale: 1, rotate: 0, translate: [0, 0] };

export function normalizeLayer(spec: LayerSpec): LayerDraw {
  return {
    id: spec.id,
    source: spec.source,
    rect: spec.rect,
    transform: spec.transform ?? IDENTITY_TRANSFORM,
    opacity: Math.min(1, Math.max(0, spec.opacity ?? 1)),
    blend: spec.blend ?? "normal",
    effects: spec.effects ?? [],
    mask: spec.mask,
  };
}

/**
 * A layer's pixel source. `prepare` runs in the async resolve phase and may raster, decode
 * or fetch; `texture` runs in the synchronous draw phase and must not await anything.
 */
export interface TextureSource {
  prepare(frame: number, key?: string): Promise<void>;
  texture(gl: WebGL2RenderingContext, frame: number, key?: string): WebGLTexture | null;
  /** Natural pixel size when the source knows it; null means "use the layer rect". */
  size(): { w: number; h: number } | null;
  dispose?(): void;
}
