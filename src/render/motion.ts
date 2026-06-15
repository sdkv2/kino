// Camera shots + transitions. Pure, deterministic auto-vary so consecutive app cut-ins differ
// (reproducible → cache-friendly + testable). Override wins when the spec sets a value.
export type Shot = "push-in" | "pull-out" | "pan-left" | "pan-right" | "tilt-up" | "static";
export type Transition = "fade" | "fly-left" | "fly-up" | "pop" | "cut";

export const SHOTS: readonly Shot[] = ["push-in", "pan-right", "pull-out", "pan-left", "tilt-up"];
// Punchy CapCut-style rotation: spring fly-ins + a zoom pop, with fade as a breather.
export const TRANSITIONS: readonly Transition[] = ["fly-left", "fly-up", "pop", "fade"];

export function pickShot(appIndex: number, override?: Shot): Shot {
  return override ?? SHOTS[appIndex % SHOTS.length];
}

export function pickTransition(appIndex: number, override?: Transition): Transition {
  return override ?? TRANSITIONS[appIndex % TRANSITIONS.length];
}
