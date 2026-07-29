// Spec-level declared layers. Shared by the CLI (validation at build time) and the render page
// (resolution at draw time), so an invalid layer fails with a message instead of rendering
// nothing. Mirrors maskSpec.ts — validation returns strings rather than throwing, so one build
// reports every problem at once.
//
// Import direction: this module value-imports Z from layers.js (for RESERVED_Z). layers.ts must
// never gain a value import back from this module — RESERVED_Z runs `Object.values(Z)` at module
// top level, so a cycle would hit a temporal-dead-zone error at load. Keep the dependency one-way.
import { Z } from "./layers.js";
import { validateMask, EFFECT_KINDS, type LayerEffect, type LayerMask } from "./maskSpec.js";
import type { BgKeyframe } from "./props.js";
import type { BlendMode } from "./native/page/compositor/graph.js";
import { BLEND_MODES } from "./blendModes.js";

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
  src: string;
  params?: Record<string, number | string>;
  keyframes?: BgKeyframe[];
  triggers?: { at: number; action: string }[];
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
}

/** Ids `layersAt` may emit (src/render/layers.ts, every `out.push` site). A declared layer taking
 *  one of these would shadow a built-in in the provider registry, and `mask.source.layerId` could
 *  no longer name either unambiguously.
 *
 *  Enumerated directly against layers.ts: backdrop, scrim, av{i} (§3); overlay{i} (§4 behind, §5
 *  behind, §6 — three push sites, one id shape), seg{i}/frame{i}/kicker{i} (§4); motion{i} (§5);
 *  text{i}_{j} (§7); logo (§8); caption{i} (§9); disclosure (§10); platformGuide/grid (§11);
 *  film — the cinematic-finish adjustment layer (§12). */
const BUILTIN_ID_PATTERNS = [
  /^backdrop$/, /^scrim$/, /^film$/, /^logo$/, /^disclosure$/, /^platformGuide$/, /^grid$/,
  /^av\d+$/, /^seg\d+$/, /^frame\d+$/, /^kicker\d+$/, /^motion\d+$/, /^overlay\d+$/,
  /^caption\d+$/, /^text\d+_\d+$/,
];

const RESERVED_Z = new Set<number>(Object.values(Z));

/** Fields the adjustment branch in layers.ts §11b never reads — see the check in validateLayers
 *  that rejects them alongside `adjust`. */
const ADJUST_INCOMPATIBLE_FIELDS = [
  "fromSec", "toSec", "segment", "hold", "rect", "opacity", "mask", "effects", "keyframes", "blend",
] as const satisfies readonly (keyof DeclaredLayer)[];

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

    if (l.source && l.adjust) errs.push(at("cannot have both source and adjust — an adjustment layer has no pixels of its own"));
    else if (!l.source && !l.adjust) errs.push(at("needs either a source or an adjust chain"));

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
      } else if (!l.source.src) {
        errs.push(at("source.src is required"));
      }
    }

    // `film` is a valid adjust kind (layers.ts §12 emits it as the cinematic finish) but is not
    // in EFFECT_KINDS — that list is the per-layer effect passes, and film is a distinct
    // full-frame-grade concept validated by its own postFx range checks (postSpec.ts). It is
    // allowed here as an explicit exception rather than folded into EFFECT_KINDS.
    for (const e of l.adjust ?? []) {
      if (!(EFFECT_KINDS as readonly string[]).includes(e.kind) && (e.kind as string) !== "film") {
        errs.push(at(`unknown adjust kind: ${String(e.kind)}`));
      }
    }
    for (const e of l.effects ?? []) {
      if (!(EFFECT_KINDS as readonly string[]).includes(e.kind)) errs.push(at(`unknown effect kind: ${String(e.kind)}`));
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

    if (l.mask !== undefined) errs.push(...validateMask(l.mask).map((m) => at(m)));
  });

  return errs;
}
