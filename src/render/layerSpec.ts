// Spec-level declared layers. Shared by the CLI (validation at build time) and the render page
// (resolution at draw time), so an invalid layer fails with a message instead of rendering
// nothing. Mirrors maskSpec.ts — validation returns strings rather than throwing, so one build
// reports every problem at once.
//
// Import direction: this module value-imports Z from layers.js (for RESERVED_Z). layers.ts must
// never gain a value import back from this module — RESERVED_Z runs `Object.values(Z)` at module
// top level, so a cycle would hit a temporal-dead-zone error at load. Keep the dependency one-way.
import { Z } from "./layers.js";
import { validateMask, validateEffectKeyframes, validateEffectParams, EFFECT_KINDS, type LayerEffect, type LayerMask } from "./maskSpec.js";
import { DRIVE_CHANNELS, validateDriveExpr } from "./driveExpr.js";
// Type-only, so it can't participate in the layers.js value-import cycle warned about above:
// MotionGraphicProps is only used to shape the `graphic` resolved field below.
import type { BgKeyframe, MotionGraphicProps } from "./props.js";
import type { BlendMode } from "./native/page/compositor/graph.js";
import { BLEND_MODES } from "./blendModes.js";
import { isRasterImagePath, validateInlineSvg } from "../media/imageAsset.js";

export const LAYER_SOURCE_KINDS = ["image", "motion", "shader", "video", "lottie"] as const;
export type LayerSourceKind = (typeof LAYER_SOURCE_KINDS)[number];

// BlendMode is DECLARED IN graph.ts and re-exported here (not redefined) — two structurally
// identical unions in two modules is exactly how they drift apart when one gains a mode. A bare
// `export type { X } from "mod"` re-exports X but does not bind it locally (it's an "export …
// from" re-export, no local name introduced), so this imports it first, same as Dims in layers.ts.
// BLEND_MODES itself now lives in blendModes.ts (shared with maskSpec.ts's segment validator);
// re-exported here since nothing outside this module needs to know it moved.
export { BLEND_MODES };
export type { BlendMode };

export interface DeclaredLayerSource {
  kind: LayerSourceKind;
  /** Author-facing reference: asset-relative path, or staging path for inline `svg`. */
  src?: string;
  /** Inline SVG markup — staged at build to `src` (or generated/inline/<id>.svg). */
  svg?: string;
  params?: Record<string, number | string>;
  keyframes?: BgKeyframe[];
  triggers?: { at: number; action: string }[];
  // Resolved node-side by build.ts from `src` — the page never reads files (every OTHER provider
  // in this codebase consumes resolved content, not a path: createImageSource wants a staged URL,
  // createShaderDraw wants GLSL source text, MotionGraphicProps.html is already-sanitized markup).
  // Mirrors how `background` carries both `kind` and its resolved `shaderCode` (props.ts). Exactly
  // one of the three is populated, matching `kind`; all are undefined on a layer that hasn't been
  // through build.ts's resolution pass yet (e.g. a KinoProps fixture built by hand in a test).
  url?: string; // image, video: public-relative staged path (stageAsset's target, same as seg{i}/frame{i})
  shaderCode?: string; // shader: GLSL mainImage body, read from the resolved component file
  graphic?: MotionGraphicProps; // motion, lottie: sanitized markup (Tier 1/2) or parsed animationData (Tier 3)
}

export interface DeclaredLayer {
  id: string;
  z: number;
  source?: DeclaredLayerSource;
  adjust?: LayerEffect[];
  blend?: BlendMode;
  fromSec?: number;
  toSec?: number;
  rect?: { x: number; y: number; w: number; h: number };
  opacity?: number;
  mask?: LayerMask;
  effects?: LayerEffect[];
  keyframes?: BgKeyframe[];
  segment?: number;
  hold?: boolean;
  flipX?: boolean;
  flipY?: boolean;
  /** Beat-local math expressions — additive offset on keyframed transform channels. */
  drive?: Record<string, string>;
}

/** Ids `layersAt` may emit (src/render/layers.ts, every `out.push` site), PLUS any id registered
 *  as a provider directly by registry.ts (page-side) rather than pushed as a layer by layersAt. A
 *  declared layer taking one of these would shadow a built-in in the provider registry, and
 *  `mask.source.layerId` could no longer name either unambiguously.
 *
 *  Enumerated directly against layers.ts: backdrop, scrim, av{i} (§3); overlay{i} (§4 behind, §5
 *  behind, §6 — three push sites, one id shape), seg{i}/frame{i}/kicker{i} (§4); motion{i} (§5);
 *  text{i}_{j} (§7); caption{i} (§9); disclosure (§10); platformGuide/grid (§11);
 *  film — the cinematic-finish adjustment layer (§12).
 *
 *  There is no built-in "logo" id anymore — the logo system was removed in favour of an ordinary
 *  declared layer (spec.layers[]), so "logo" is a free id an author can use like any other.
 *
 *  region{i} is the odd one out: it is never pushed by layersAt at all — layers.ts §4 sets
 *  `seg{i}`'s own `source.providerId` to `region{i}` for a beat with a regionShader (the footage
 *  provider `seg{i}` points at, not a layer id of its own), and registry.ts registers that id
 *  directly (`sources.set(\`region${i}\`, createRegionCompositorSource(...))`). Cross-checked
 *  against every `sources.set(...)` call in registry.ts (not just layersAt's push sites, since this
 *  one is registry-side only) — region{i} was the only id registry.ts sets that this list missed. */
const BUILTIN_ID_PATTERNS = [
  /^backdrop$/, /^scrim$/, /^film$/, /^disclosure$/, /^platformGuide$/, /^grid$/,
  /^av\d+$/, /^seg\d+$/, /^frame\d+$/, /^kicker\d+$/, /^motion\d+$/, /^overlay\d+$/,
  /^caption\d+$/, /^text\d+_\d+$/, /^region\d+$/,
];

const RESERVED_Z = new Set<number>(Object.values(Z));

/** Fields the adjustment branch in layers.ts §11b never reads — see the check in validateLayers
 *  that rejects them alongside `adjust`. */
const ADJUST_INCOMPATIBLE_FIELDS = [
  "fromSec", "toSec", "segment", "hold", "rect", "opacity", "mask", "effects", "keyframes", "blend",
] as const satisfies readonly (keyof DeclaredLayer)[];

// Static (no I/O) shape check: does `src`'s extension agree with the declared `kind`? This is the
// one part of "does this source resolve" that doesn't need a project/filesystem to answer, so it
// runs here rather than only in build.ts's resolution pass — same rationale as every other check
// in this function (fail the whole build at once, cheaply, before spending on VO/avatar/render).
// It exists to catch a specific silent-nothing failure: e.g. kind "lottie" pointed at a .html file
// would resolve fine as Tier-1 markup (resolveMotionGraphic dispatches on extension, not `kind`),
// but registry.ts routes a "lottie" kind to createLottieSource, which reads `graphic.lottie` — left
// undefined — and paints nothing. A bare id (no dot) is left to the resolution pass, which is the
// only place that knows the library contents.
function checkSourceShape(kind: LayerSourceKind, src: string): string[] {
  const hasExt = /\.\w+$/.test(src);
  if (kind === "image" && !isRasterImagePath(src)) {
    return [`source.src "${src}" doesn't look like an image — expected .png/.jpg/.jpeg/.webp/.svg`];
  }
  if (kind === "video" && !/\.(mp4|mov|png|jpe?g|webp|svg)$/i.test(src)) {
    return [`source.src "${src}" doesn't look like a video or still image — expected .mp4/.mov/.png/.jpg/.jpeg/.webp/.svg`];
  }
  if (kind === "shader" && hasExt && !/\.(frag|glsl)$/i.test(src)) {
    return [`source.src "${src}" doesn't look like a shader — expected .frag/.glsl, or a bare assets-lib/backgrounds id`];
  }
  if (kind === "motion" && /\.json$/i.test(src)) {
    return [`source.kind is "motion" but src "${src}" is a .json file — use kind "lottie" for a Lottie animation`];
  }
  if (kind === "lottie" && hasExt && !/\.json$/i.test(src)) {
    return [`source.kind is "lottie" but src "${src}" is not a .json file`];
  }
  return [];
}

export function validateLayers(layers: unknown, segmentCount: number): string[] {
  if (layers === undefined) return [];
  if (!Array.isArray(layers)) return ["spec.layers must be an array"];

  const errs: string[] = [];
  const seen = new Set<string>();

  layers.forEach((raw, i) => {
    const l = (raw ?? {}) as Partial<DeclaredLayer>;
    const label = l.id ? `layer "${l.id}"` : `layers[${i}]`;
    const at = (msg: string) => `${label}: ${msg}`;

    if (!l.id || typeof l.id !== "string") {
      errs.push(at("id is required and must be a string"));
    } else {
      if (seen.has(l.id)) errs.push(at(`duplicate layer id "${l.id}"`));
      seen.add(l.id);
      if (BUILTIN_ID_PATTERNS.some((re) => re.test(l.id!))) {
        errs.push(at(`id "${l.id}" is reserved — it collides with a built-in layer`));
      }
    }

    if (l.z === undefined) errs.push(at("z is required"));
    else if (typeof l.z !== "number" || !Number.isFinite(l.z)) errs.push(at("z must be a finite number"));
    else if (RESERVED_Z.has(l.z)) {
      errs.push(at(`z ${l.z} is reserved for a built-in layer — pick a value between them so the order is unambiguous`));
    }

    // `.length`-aware, not just truthy: an empty `adjust: []` is not a real adjustment chain (the
    // ADJUST_INCOMPATIBLE_FIELDS check below and layersAt's own emission branch, layers.ts §11b,
    // both gate on `.length` too) — `!l.adjust` alone would let `{ id, z, adjust: [] }` (no source,
    // no length) slip past both branches and fall through to layersAt's pixel branch, emitting
    // `source: { providerId: d.id }` with nothing ever registered for that id.
    const hasAdjust = Boolean(l.adjust?.length);
    if (l.source && hasAdjust) errs.push(at("cannot have both source and adjust — an adjustment layer has no pixels of its own"));
    else if (!l.source && !hasAdjust) errs.push(at("needs either a source or an adjust chain"));

    // An adjustment layer (layers.ts §11b) is always base-group and applies to the whole
    // accumulator: the `d.adjust?.length` branch pushes only id/z/source:null/adjust and
    // `continue`s before fromSec/toSec/segment/hold/rect/opacity/mask/effects/keyframes/blend are
    // even read. Accepting those fields here would let a schema-valid spec author a windowed,
    // masked, or blended adjustment layer that silently does nothing of the kind at render time —
    // reject the combination instead of letting it validate clean and then quietly not work.
    if (l.adjust?.length) {
      for (const field of ADJUST_INCOMPATIBLE_FIELDS) {
        if (l[field] !== undefined) {
          errs.push(at(`adjust cannot be combined with ${field} — an adjustment layer is always base-group, spans the whole accumulator, and layersAt's adjustment branch never reads ${field}, so it would be silently ignored at render time`));
        }
      }
    }

    if (l.source) {
      const kind = l.source.kind;
      if (!kind || !(LAYER_SOURCE_KINDS as readonly string[]).includes(kind)) {
        errs.push(at(`unknown layer source kind: ${String(kind)} — expected one of ${LAYER_SOURCE_KINDS.join(", ")}`));
      } else {
        if (l.source.svg) {
          if (kind !== "image") {
            errs.push(at(`source.svg is only supported on image layers`));
          } else {
            const svgErr = validateInlineSvg(l.source.svg);
            if (svgErr) errs.push(at(`source.svg: ${svgErr}`));
          }
        }
        if (!l.source.src && !l.source.svg) {
          errs.push(at("source.src or source.svg is required"));
        } else if (l.source.src) {
          errs.push(...checkSourceShape(kind, l.source.src).map(at));
        }
      }
    }

    // `film` is a valid adjust kind (layers.ts §12 emits it as the cinematic finish) but is not
    // in EFFECT_KINDS — that list is the per-layer effect passes, and film is a distinct
    // full-frame-grade concept validated by its own postFx range checks (postSpec.ts). It is
    // allowed here as an explicit exception rather than folded into EFFECT_KINDS.
    for (const [j, e] of (l.adjust ?? []).entries()) {
      if (!(EFFECT_KINDS as readonly string[]).includes(e.kind) && (e.kind as string) !== "film") {
        errs.push(at(`unknown adjust kind: ${String(e.kind)}`));
      }
      errs.push(...validateEffectKeyframes(e, `adjust[${j}]`).map(at));
      errs.push(...validateEffectParams(e, `adjust[${j}]`).map(at));
    }
    for (const [j, e] of (l.effects ?? []).entries()) {
      if (!(EFFECT_KINDS as readonly string[]).includes(e.kind)) errs.push(at(`unknown effect kind: ${String(e.kind)}`));
      errs.push(...validateEffectKeyframes(e, `effects[${j}]`).map(at));
      errs.push(...validateEffectParams(e, `effects[${j}]`).map(at));
    }

    if (l.blend !== undefined && !(BLEND_MODES as readonly string[]).includes(l.blend)) {
      errs.push(at(`blend must be one of ${BLEND_MODES.join(", ")}`));
    }

    if (l.opacity !== undefined && (typeof l.opacity !== "number" || l.opacity < 0 || l.opacity > 1)) {
      errs.push(at("opacity must be a number between 0 and 1"));
    }

    if (l.fromSec !== undefined && l.toSec !== undefined && l.fromSec >= l.toSec) {
      errs.push(at("fromSec must be < toSec"));
    }

    if (l.segment !== undefined) {
      if (!Number.isInteger(l.segment) || l.segment < 0 || l.segment >= segmentCount) {
        errs.push(at(`segment ${l.segment} is out of range (spec has ${segmentCount} beats)`));
      }
    }
    if (l.hold && l.segment === undefined) {
      errs.push(at("hold requires segment — it means 'timed to this beat but outside its transition'"));
    }

    for (const [ch, expr] of Object.entries(l.drive ?? {})) {
      if (!(DRIVE_CHANNELS as readonly string[]).includes(ch)) {
        errs.push(at(`drive.${ch}: unknown channel — valid: ${DRIVE_CHANNELS.join(", ")}`));
        continue;
      }
      const err = validateDriveExpr(expr);
      if (err) errs.push(at(`drive.${ch}: ${err}`));
    }

    if (l.mask !== undefined) {
      errs.push(...validateMask(l.mask).map((m) => at(m)));
      // See maskSpec.ts's matching check in validateSegmentFx for the full rationale: the
      // compositor has no binding for a `file`-kind mask (renderer.ts's compositeLayerInner always
      // passes `binding: { mask: null, ... }` for anything other than a `layer`-kind source), so
      // this layer would render invisible rather than clipped. Declared layers route their `mask`
      // through the exact same renderer code path as a segment's (`layers.ts` §11b threads
      // `d.mask` onto the LayerDraw unchanged, same as §9's `caption{i}`), so the gap — and the
      // fail-loud fix — apply here too, not just to segments.
      const maskSrc = (l.mask as { source?: { kind?: unknown } }).source;
      if (maskSrc && (maskSrc as { kind?: unknown }).kind === "file") {
        errs.push(
          at(
            `mask.source.kind "file" is not supported on a declared layer yet — the compositor has no ` +
              `binding for it (same gap as a segment's file mask; see maskSpec.ts's validateSegmentFx) ` +
              `and this layer would render invisible; use mask.source.kind "shape" or "layer" instead`,
          ),
        );
      }
    }
  });

  return errs;
}
