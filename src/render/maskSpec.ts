// Spec-level mask types. Shared by the CLI (validation at build time) and the render page
// (resolution at draw time), so an invalid mask fails with a message instead of rendering
// a silently empty layer.
import { SDF_MAX_PX } from "./sdf.js";
import type { ShapeMask } from "./shapes.js";
import { BLEND_MODES } from "./blendModes.js";

export type MaskChannel = "r" | "g" | "b" | "a" | "luma";

export type MaskSource =
  /** Analytic shape — no file, no upload, exact distance. */
  | { kind: "shape"; shape: ShapeMask }
  /** A mask image or video under /public, with its SDF frames generated node-side. */
  | { kind: "file"; src: string; channel: MaskChannel }
  /** Another layer's own alpha or luma, rendered to a target and sampled. */
  | { kind: "layer"; layerId: string; channel: MaskChannel };

export interface LayerMask {
  source: MaskSource;
  /** Soften the boundary over this many px. Resolved from the SDF, so it is a true distance,
   *  not a blur of the coverage. */
  feather?: number;
  /** Grow (positive) or shrink (negative) the masked region, in px. */
  expand?: number;
  /** Swap kept and cut regions. */
  invert?: boolean;
}

const CHANNELS: MaskChannel[] = ["r", "g", "b", "a", "luma"];

export function validateMask(m: unknown): string[] {
  const errs: string[] = [];
  if (!m || typeof m !== "object") return ["mask must be an object"];
  const mask = m as Partial<LayerMask>;
  const src = mask.source as Partial<MaskSource> | undefined;

  if (!src || typeof src !== "object") {
    errs.push("mask.source is required");
  } else if (src.kind === "shape") {
    if (!("shape" in src) || !src.shape) errs.push("mask.source.shape is required for kind 'shape'");
  } else if (src.kind === "file") {
    if (!("src" in src) || !src.src) errs.push("mask.source.src is required for kind 'file'");
    if ("channel" in src && src.channel && !CHANNELS.includes(src.channel)) {
      errs.push(`mask.source.channel must be one of ${CHANNELS.join(", ")}`);
    }
  } else if (src.kind === "layer") {
    if (!("layerId" in src) || !src.layerId) errs.push("mask.source.layerId is required for kind 'layer'");
  } else {
    errs.push(`unknown mask source kind: ${String((src as { kind?: unknown }).kind)}`);
  }

  const { feather, expand } = mask;
  if (feather !== undefined) {
    if (typeof feather !== "number" || feather < 0) errs.push("mask.feather must be a number >= 0");
    // Feather is resolved from the encoded distance field, which saturates at SDF_MAX_PX.
    // Asking beyond that would clip with no warning.
    else if (feather > SDF_MAX_PX) errs.push(`mask.feather must be <= ${SDF_MAX_PX} (the SDF encode range)`);
  }
  if (expand !== undefined) {
    if (typeof expand !== "number") errs.push("mask.expand must be a number");
    else if (Math.abs(expand) > SDF_MAX_PX) errs.push(`mask.expand must be within ±${SDF_MAX_PX} (the SDF encode range)`);
  }
  return errs;
}

/** Effect kinds the compositor can run. Kept as a literal list rather than read from the pass
 *  registry: validation runs node-side in the CLI, where the page's registry is not loaded. */
export const EFFECT_KINDS = ["blur", "glow", "grade", "motionBlur"] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

export interface LayerEffect {
  kind: EffectKind;
  params: Record<string, number | string>;
}

/** Validate the mask, effects and blend on one beat. `index` is the beat's position, so a
 *  message points at the thing the author has to edit. */
export function validateSegmentFx(seg: unknown, index: number): string[] {
  const s = (seg ?? {}) as { mask?: unknown; effects?: unknown; blend?: unknown };
  const errs: string[] = [];
  const at = (msg: string) => `beat ${index}: ${msg}`;

  if (s.mask !== undefined) {
    errs.push(...validateMask(s.mask).map(at));
    // The compositor has no binding for a `file`-kind segment mask: renderer.ts's
    // compositeLayerInnerWithBackdrop only fills MaskBinding.mask for a `layer`-kind source (via
    // maskTargets, built from another layer's own render); every other kind — "file" included —
    // falls through to `binding = { mask: null, sdf: null, sdfMax: 0 }` unconditionally. "shape"
    // doesn't care (uSourceKind 0 is analytic, no texture read), but "file" sets uSourceKind 1 and
    // then samples that null texture, which reads (0,0,0,1) — every channel (r/g/b/luma, including
    // the default) gives coverage 0, so every layer this mask attaches to (seg{i}, caption{i},
    // overlay{i}, text{i}_{j}) renders invisible. planMaskJobs (videoFrames.ts) does extract
    // lmask{i} frames for this case, but nothing in registry.ts or renderer.ts ever turns them into
    // a bound texture — the feature is half-built. Fail loudly here instead of authoring a beat
    // that silently disappears (same policy as a declared "video" layer — see build.ts's
    // resolveDeclaredLayers and docs/spec-reference.md's "kind: video does not work" note).
    const maskSrc = (s.mask as { source?: { kind?: unknown } }).source;
    if (maskSrc && (maskSrc as { kind?: unknown }).kind === "file") {
      errs.push(
        at(
          `mask.source.kind "file" is not supported on a segment mask yet — the compositor has no ` +
            `binding for it (renderer.ts's applyMask always gets a null texture for a "file" source, ` +
            `so uSourceKind=1 samples nothing and every layer of this beat would render invisible); ` +
            `use mask.source.kind "shape" or "layer" instead`,
        ),
      );
    }
  }

  if (s.blend !== undefined && !(BLEND_MODES as readonly string[]).includes(s.blend as string)) {
    errs.push(at(`blend must be one of ${BLEND_MODES.join(", ")}`));
  }

  if (s.effects !== undefined) {
    if (!Array.isArray(s.effects)) {
      errs.push(at("effects must be an array"));
    } else {
      s.effects.forEach((e, j) => {
        const eff = (e ?? {}) as Partial<LayerEffect>;
        if (!eff.kind || !(EFFECT_KINDS as readonly string[]).includes(eff.kind)) {
          errs.push(at(`effects[${j}].kind "${String(eff.kind)}" is not an effect — expected one of ${EFFECT_KINDS.join(", ")}`));
        }
        if (typeof eff.params !== "object" || eff.params === null) {
          errs.push(at(`effects[${j}].params must be an object`));
        }
      });
    }
  }
  return errs;
}

export interface ResolvedMask {
  source: MaskSource;
  feather: number;
  expand: number;
  invert: boolean;
}

export function resolveMaskDefaults(m: LayerMask): ResolvedMask {
  return {
    source: m.source,
    feather: m.feather ?? 0,
    expand: m.expand ?? 0,
    invert: m.invert ?? false,
  };
}
