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
  /** Paint order. The list is stable-sorted on (z, pushIndex), so equal z keeps authored order.
   *  Built-in constants live in layers.ts `Z`; declared layers pick their own. Optional because
   *  renderer.ts builds bare LayerDraw literals for mask and full-frame blit targets that take no
   *  part in ordering (they never flow through layersAt's sort); every real layer gets one via
   *  normalizeLayer's `spec.z ?? 0` default. */
  z?: number;
  source: TextureRef;
  rect: { x: number; y: number; w: number; h: number }; // frame px, top-left origin
  transform: LayerTransform;
  opacity: number;
  blend: BlendMode;
  /** Coverage-gamma correction for this layer's alpha, applied before premultiply. Font rasters
   *  are hinted for sRGB compositing and read thin when their coverage is blended in linear light;
   *  a' = pow(a, 1/textGamma) restores the apparent stroke weight. 1 disables it. Perceptual knob,
   *  not a correctness one. */
  textGamma: number;
  effects: EffectRef[];
  mask?: MaskRef;
  /** Beat this layer belongs to, for transitions. Absent = the base group. */
  group?: string;
  /** Composite after the cinematic-finish pass (motion/overlay tier). Text-behind seg cutouts need this. */
  aboveFilm?: boolean;
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

/** Layers whose pixels are glyph coverage, by the same id convention isAboveFilmLayer uses. */
const TEXT_CLASS = /^(text|caption|disclosure)/;
// 2.2 is the display gamma, and that is the principled value rather than a fitted one: correcting
// coverage by it makes linear-light blending of a glyph edge reproduce what sRGB blending gave,
// which is the whole point — font hinting and stem weights were tuned for that space.
// Measured against the caption goldens, diff-to-sRGB-baseline falls monotonically up to here
// (phrase-caption 0.01026 -> under threshold, words-caption 0.01009 -> under threshold).
const TEXT_GAMMA_DEFAULT = 2.2;

export function normalizeLayer(spec: LayerSpec): LayerDraw {
  return {
    id: spec.id,
    z: spec.z ?? 0,
    source: spec.source,
    rect: spec.rect,
    transform: spec.transform ?? IDENTITY_TRANSFORM,
    opacity: Math.min(1, Math.max(0, spec.opacity ?? 1)),
    blend: spec.blend ?? "normal",
    textGamma: Math.min(4, Math.max(0.1, spec.textGamma ?? (TEXT_CLASS.test(spec.id) ? TEXT_GAMMA_DEFAULT : 1))),
    effects: spec.effects ?? [],
    mask: spec.mask,
    group: spec.group,
    aboveFilm: spec.aboveFilm,
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
  /** True when `texture()` samples the compositor backdrop (post-raster effects). */
  needsCompositorBackdrop?(frame: number, key?: string): boolean;
  /** When true, compositor samples with SAMPLE_RENDERED (FBO output) instead of SAMPLE_UPLOADED. */
  textureIsRendered?(frame?: number, key?: string): boolean;
  dispose?(): void;
}
