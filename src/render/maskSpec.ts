// Spec-level mask types. Shared by the CLI (validation at build time) and the render page
// (resolution at draw time), so an invalid mask fails with a message instead of rendering
// a silently empty layer.
import { SDF_MAX_PX } from "./sdf.js";
import type { ShapeMask } from "./shapes.js";
import { BLEND_MODES } from "./blendModes.js";
import { EASE_NAMES, type Keyframe } from "./bgparams.js";

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
  /** Tween this effect's params over time. `at` is relative to the effect's owner — the beat's
   *  start for a segment's `effects`, the layer's own start for a declared layer's `effects` or
   *  `adjust`. Resolved by resolveEffects (effectParams.ts) before the compositor sees the layer;
   *  a resolved effect carries only `kind` + `params`. */
  keyframes?: Keyframe[];
}

/** Validate one effect's `keyframes` track. `label` prefixes each message with the thing the
 *  author has to edit ("effects[0]", "adjust[1]"); the caller adds the beat or layer. */
export function validateEffectKeyframes(e: unknown, label: string): string[] {
  const kf = (e as { keyframes?: unknown } | null | undefined)?.keyframes;
  if (kf === undefined) return [];
  if (!Array.isArray(kf)) return [`${label}.keyframes must be an array`];
  const errs: string[] = [];
  kf.forEach((k, i) => {
    const at = `${label}.keyframes[${i}]`;
    const entry = (k ?? {}) as { at?: unknown; params?: unknown; ease?: unknown };
    if (typeof entry.at !== "number" || !Number.isFinite(entry.at) || entry.at < 0) {
      errs.push(`${at}.at must be a number >= 0`);
    }
    if (typeof entry.params !== "object" || entry.params === null || Array.isArray(entry.params)) {
      errs.push(`${at}.params must be an object`);
    }
    if (entry.ease !== undefined && !(EASE_NAMES as readonly string[]).includes(entry.ease as string)) {
      errs.push(`${at}.ease "${String(entry.ease)}" is not an ease — expected one of ${EASE_NAMES.join(", ")}`);
    }
  });
  return errs;
}

/** `blur`'s focusMode is the one effect param whose value is an enum rather than a number, so it
 *  is the one a typo can silently degrade — numParam bounds every other param at the GPU edge,
 *  but an unknown mode string would just fall back to radial and look like a bug in the falloff. */
export function validateEffectParams(e: unknown, label: string): string[] {
  const eff = (e ?? {}) as { kind?: unknown; params?: Record<string, unknown> };
  if (eff.kind !== "blur") return [];
  const mode = eff.params?.focusMode;
  if (mode !== undefined && mode !== "radial" && mode !== "band") {
    return [`${label}.params.focusMode "${String(mode)}" is not a mode — expected radial or band`];
  }
  return [];
}

/** Validate the mask, effects and blend on one beat. `index` is the beat's position, so a
 *  message points at the thing the author has to edit. */
export function validateSegmentFx(seg: unknown, index: number): string[] {
  const s = (seg ?? {}) as { mask?: unknown; effects?: unknown; blend?: unknown };
  const errs: string[] = [];
  const at = (msg: string) => `beat ${index}: ${msg}`;

  if (s.mask !== undefined) {
    errs.push(...validateMask(s.mask).map(at));
    // `file`-kind masks are BOUND now: planMaskJobs extracts the frames (coverage + SDF), the
    // registry registers them as lmask<beat> sources, and the renderer's mask branch binds them.
    // No rejection needed — a missing extraction (hand-built props, or a media failure) degrades
    // to a null texture exactly like a layer mask whose target never rendered.
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
        errs.push(...validateEffectKeyframes(e, `effects[${j}]`).map(at));
        errs.push(...validateEffectParams(e, `effects[${j}]`).map(at));
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
