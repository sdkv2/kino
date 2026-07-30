// Camera movement carried THROUGH a transition.
//
// A cut reads as one continuous shot when the camera does not stop at the boundary: the outgoing
// beat keeps moving as it leaves, and the incoming beat arrives already in motion and settles. That
// is a different thing from a camera move inside a beat (`.cam` in a motion graphic), which starts
// and ends within one composition and therefore dies at every cut.
//
// Composability is the whole design. The move is applied inside `kinoFrom` / `kinoTo` — the sampling
// helpers EVERY transition reads its two beats through — so it stacks onto any transition, built-in
// or author-supplied, with no shader changes. A wipe can pan, an iris can push in, the ink can bleed
// while the frame drifts.
//
// ENDPOINTS. Each side is driven by its own distance from its own endpoint: the outgoing beat by
// `t = p` (zero at p=0) and the incoming beat by `t = 1 - p` (zero at p=1). Every term is multiplied
// by that t, so at each endpoint the transform is exactly identity and the sample is the untouched
// beat. The transition's own endpoint contract therefore survives untouched — this cannot break a
// shader that was already correct.
//
// Pure: no GL. The renderer turns this into uniforms; tests read it directly.

/** Per-side move. `zoom` > 0 pushes in, < 0 pulls out; pan is a fraction of the frame. */
export interface CameraSide {
  zoom: number;
  panX: number;
  panY: number;
}

export interface CameraParams {
  /** Applied to the OUTGOING beat, scaled by p (identity at p=0). */
  from: CameraSide;
  /** Applied to the INCOMING beat, scaled by 1-p (identity at p=1). */
  to: CameraSide;
  /** Directional smear strength, in frame widths at peak. 0 = off (and skips the tap loop). */
  blur: number;
  /**
   * Fraction of each side spent AT full extent rather than travelling to it.
   *
   * With no hold the move ramps across the whole side, so it only reaches full extent exactly at
   * the boundary and immediately starts back — it reads as a continuous drift, never as a punch.
   * A hold splits it into ramp / plateau / ramp: the frame pushes in, SITS there through the cut,
   * then eases out. 0 = the old continuous drift, 0.95 = a near-instant snap and a long dwell.
   */
  hold: number;
}

export interface CameraSpec {
  /** Named move; sets zoom/pan, which explicit fields then override. */
  move?: string;
  zoom?: number;
  panX?: number;
  panY?: number;
  /** Scales the whole move. 1 = the preset as documented. */
  amount?: number;
  blur?: number;
  /** Fraction of each side held at full extent (0..0.95). Default 0.5. */
  hold?: number;
}

/**
 * Presets, expressed as ONE continuous move rather than two independent ones.
 *
 * Both sides carry the same sign so the motion reads as a single camera crossing the cut. For a
 * push, the outgoing beat scales up as it leaves AND the incoming beat starts scaled up and settles
 * back — the camera never reverses at the boundary, which is precisely the artefact that makes a
 * transition look like two clips rather than one shot.
 */
export const CAMERA_MOVES: Record<string, { zoom: number; panX: number; panY: number }> = {
  push: { zoom: 0.18, panX: 0, panY: 0 },
  pull: { zoom: -0.15, panX: 0, panY: 0 },
  "pan-left": { zoom: 0.04, panX: 0.16, panY: 0 },
  "pan-right": { zoom: 0.04, panX: -0.16, panY: 0 },
  "tilt-up": { zoom: 0.04, panX: 0, panY: -0.16 },
  "tilt-down": { zoom: 0.04, panX: 0, panY: 0.16 },
  // A whip is a pan hard enough that the smear is the point; the blur default doubles for it.
  "whip-left": { zoom: 0.06, panX: 0.42, panY: 0 },
  "whip-right": { zoom: 0.06, panX: -0.42, panY: 0 },
};

export const CAMERA_BLUR_DEFAULT = 0.5;

/** Default dwell. Half of each side ramping, half held — enough plateau to read as a punch-in. */
export const CAMERA_HOLD_DEFAULT = 0.5;

/** Blur multiplier per preset — a whip is defined by its smear, an ordinary pan is not. */
const BLUR_SCALE: Record<string, number> = { "whip-left": 2, "whip-right": 2 };

/**
 * Resolve a spec into the two per-side transforms plus the blur strength.
 *
 * The incoming side's pan is NEGATED relative to the outgoing side's: the outgoing beat drifts one
 * way as it leaves, and the incoming beat has to come from the opposite side to arrive at rest.
 * Same physical direction of travel, mirrored offsets.
 */
export function resolveCamera(spec: CameraSpec | undefined): CameraParams | undefined {
  if (!spec) return undefined;
  const preset = spec.move ? CAMERA_MOVES[spec.move] : undefined;
  if (spec.move && !preset) return undefined; // validated upstream; never guess a move
  const amount = spec.amount ?? 1;
  const zoom = (spec.zoom ?? preset?.zoom ?? 0) * amount;
  const panX = (spec.panX ?? preset?.panX ?? 0) * amount;
  const panY = (spec.panY ?? preset?.panY ?? 0) * amount;
  const blur = Math.max(0, spec.blur ?? CAMERA_BLUR_DEFAULT * (spec.move ? (BLUR_SCALE[spec.move] ?? 1) : 1));
  if (zoom === 0 && panX === 0 && panY === 0) return undefined; // nothing to do — skip the uniforms
  return {
    from: { zoom, panX, panY },
    to: { zoom, panX: -panX, panY: -panY },
    blur,
    hold: Math.min(0.95, Math.max(0, spec.hold ?? CAMERA_HOLD_DEFAULT)),
  };
}
