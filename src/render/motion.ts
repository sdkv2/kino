// Camera shots + transitions. Pure, deterministic auto-vary so consecutive app cut-ins differ
// (reproducible → cache-friendly + testable). Override wins when the spec sets a value.
// `scroll`/`scroll-up` traverse a tall app still vertically (simulated scroll) — opt-in only, so
// they're excluded from the auto-vary rotation below.
export type Shot = "push-in" | "pull-out" | "pan-left" | "pan-right" | "tilt-up" | "scroll" | "scroll-up" | "static";
export type Transition = "fade" | "dissolve" | "fly-left" | "fly-up" | "pop" | "cut";

export const SHOTS: readonly Shot[] = ["push-in", "pan-right", "pull-out", "pan-left", "tilt-up"];
// Punchy CapCut-style rotation for UI stills: spring fly-ins + a zoom pop, with fade as a breather.
export const TRANSITIONS: readonly Transition[] = ["fly-left", "fly-up", "pop", "fade"];
// Video b-roll reads as footage, not UI — punchy fly/pop entrances feel wrong on it, so real
// clips rotate through the two soft transitions instead (override still wins).
export const VIDEO_TRANSITIONS: readonly Transition[] = ["dissolve", "fade"];

export function pickShot(appIndex: number, override?: Shot): Shot {
  return override ?? SHOTS[appIndex % SHOTS.length];
}

export function pickTransition(appIndex: number, override?: Transition, isVideo = false): Transition {
  const rotation = isVideo ? VIDEO_TRANSITIONS : TRANSITIONS;
  return override ?? rotation[appIndex % rotation.length];
}

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

// Pure camera-move math for an app cut-in: maps a shot + progress p (0→1 across the beat) to the
// inner image's scale and translate (tx/ty as % of the image's own size). `scroll`/`scroll-up` pan
// vertically across a tall screenshot at a mild zoom, traversing content that sits below the frame;
// the ±10% range stays within the overflow of portrait app captures (≈2.17 aspect) so no edge shows.
export function shotTransform(shot: Shot, p: number): { scale: number; tx: number; ty: number } {
  switch (shot) {
    case "push-in":
      return { scale: lerp(1.06, 1.2, p), tx: 0, ty: 0 };
    case "pull-out":
      return { scale: lerp(1.2, 1.06, p), tx: 0, ty: 0 };
    case "pan-left":
      return { scale: 1.14, tx: lerp(5, -5, p), ty: 0 };
    case "pan-right":
      return { scale: 1.14, tx: lerp(-5, 5, p), ty: 0 };
    case "tilt-up":
      return { scale: 1.14, tx: 0, ty: lerp(5, -5, p) };
    case "scroll":
      return { scale: 1.06, tx: 0, ty: lerp(10, -10, p) };
    case "scroll-up":
      return { scale: 1.06, tx: 0, ty: lerp(-10, 10, p) };
    case "static":
    default:
      return { scale: 1.1, tx: 0, ty: 0 };
  }
}
