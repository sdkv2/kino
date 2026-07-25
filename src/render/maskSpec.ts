// Spec-level mask types. Shared by the CLI (validation at build time) and the render page
// (resolution at draw time), so an invalid mask fails with a message instead of rendering
// a silently empty layer.
import { SDF_MAX_PX } from "./sdf.js";
import type { ShapeMask } from "./shapes.js";

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
export const EFFECT_KINDS = ["blur", "glow", "grade"] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

export interface LayerEffect {
  kind: EffectKind;
  params: Record<string, number | string>;
}

/** Validate the mask and effects on one beat. `index` is the beat's position, so a message
 *  points at the thing the author has to edit. */
export function validateSegmentFx(seg: unknown, index: number): string[] {
  const s = (seg ?? {}) as { mask?: unknown; effects?: unknown };
  const errs: string[] = [];
  const at = (msg: string) => `beat ${index}: ${msg}`;

  if (s.mask !== undefined) errs.push(...validateMask(s.mask).map(at));

  if (s.effects !== undefined) {
    if (!Array.isArray(s.effects)) {
      errs.push(at("effects must be an array"));
    } else {
      s.effects.forEach((e, j) => {
        const eff = (e ?? {}) as Partial<LayerEffect>;
        if (!eff.kind || !(EFFECT_KINDS as readonly string[]).includes(eff.kind)) {
          errs.push(at(`effects[${j}].kind "${String(eff.kind)}" is not an effect — expected one of ${EFFECT_KINDS.join(", ")}`));
        }
        if (eff.params !== undefined && (typeof eff.params !== "object" || eff.params === null)) {
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
