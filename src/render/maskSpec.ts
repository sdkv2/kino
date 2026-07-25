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
