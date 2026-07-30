// Parameters for the `wipe` family of transitions — a lit edge that travels across the frame and
// UNCOVERS the incoming beat behind it.
//
// One shader serves every direction. The four `wipe-<dir>` names are shorthands for an angle, so an
// author gets a readable default without losing arbitrary angles: `wipe` + `transitionParams.angle`
// covers diagonals and anything else. Everything else about the edge — how soft it is, how wide and
// bright the lit band is, what colour it is — is a parameter too, because a transition that only
// works in mint on a dark field is a demo, not a feature.
//
// Pure: no GL, no DOM. The renderer turns this into uniforms; tests read it directly.
import { hexToVec3 } from "./shaderSource.js";
import type { Transition } from "./motion.js";

/** Directions, as degrees of travel. 0 = down, 90 = right, 180 = up, 270 = left. */
export const WIPE_ANGLES: Record<string, number> = {
  wipe: 0,
  "wipe-down": 0,
  "wipe-right": 90,
  "wipe-up": 180,
  "wipe-left": 270,
};

export function isWipe(kind: string): boolean {
  return kind === "wipe" || kind.startsWith("wipe-");
}

/** What the author may set under `transitionParams`. Every field is optional. */
export interface WipeSpec {
  /** Degrees of travel; overrides the direction implied by a `wipe-<dir>` name. */
  angle?: number;
  /** Feather on the reveal edge, as a fraction of the frame. 0 = a hard, aliased line. */
  softness?: number;
  /** Width of the lit band riding the edge, as a fraction of the frame. **0 = no lit edge** — a
   *  clean, invisible cut-in reveal. */
  edgeWidth?: number;
  /** Hex colour of the lit band. Defaults to the brand mint. */
  edgeColor?: string;
  /** Brightness of the lit band. 0 = off (same as edgeWidth 0). */
  edgeGain?: number;
}

export interface WipeParams {
  /** Radians, ready for the shader. */
  angle: number;
  softness: number;
  edgeWidth: number;
  edgeColor: [number, number, number];
  edgeGain: number;
}

export const WIPE_DEFAULTS = {
  softness: 0.018,
  edgeWidth: 0.013,
  edgeGain: 0.55,
} as const;

/**
 * Resolve a wipe's shader parameters: the direction from the transition name (or an explicit
 * angle), everything else from `transitionParams` over the defaults.
 *
 * `brandMint` is the fallback edge colour, so an unconfigured wipe picks up the brand rather than a
 * hard-coded green.
 */
export function resolveWipeParams(kind: Transition, spec: WipeSpec | undefined, brandMint: string): WipeParams {
  const deg = spec?.angle ?? WIPE_ANGLES[kind] ?? 0;
  const edgeWidth = spec?.edgeWidth ?? WIPE_DEFAULTS.edgeWidth;
  const edgeGain = spec?.edgeGain ?? WIPE_DEFAULTS.edgeGain;
  return {
    angle: (deg * Math.PI) / 180,
    // A zero feather renders as an aliased staircase on a diagonal, so clamp to a sub-pixel floor
    // rather than honouring 0 literally.
    softness: Math.max(0.0005, spec?.softness ?? WIPE_DEFAULTS.softness),
    // Either knob at 0 means "no lit edge" — normalise both so the shader has one thing to test.
    edgeWidth: edgeGain <= 0 ? 0 : Math.max(0, edgeWidth),
    edgeColor: hexToVec3(spec?.edgeColor ?? brandMint),
    edgeGain: edgeWidth <= 0 ? 0 : Math.max(0, edgeGain),
  };
}
