// THE SIMULATION PATHWAY — the half the RENDERER sees.
//
// Tier 2 is a pure `(env) => string` evaluated fresh every frame, with `Math.random`/`Date.now`/
// timers lint-rejected. That is the right call and it is not what changes here: a renderer that can
// be resumed on any frame, on any of eight sharded hosts, in any order, cannot have a graphic whose
// frame N depends on the graphic having drawn frame N-1. Every attempt to "make Tier 2 stateful"
// ends at that wall.
//
// So the state moves OFFLINE. A solver runs once — stateful, iterative, as imperative as physics
// wants to be — and emits one row per frame. The render then does what it has always done: index a
// frame-indexed array. Frame 41 costs the same whether it is drawn first or last, and eight hosts
// drawing eight slices all read the same rows.
//
// WHY THIS FILE IS THE SMALL ONE. It is reachable from the PAGE bundle — motionVars.ts
// value-imports `simEnvAt` — so everything here ships to the renderer, and everything here must be
// free of node built-ins. Running a solver is a BUILD-time job that wants `node:fs` and a solver
// stdlib worth hundreds of KB, none of which the browser ever executes. That half lives in
// simRun.ts, which nothing page-side imports; keeping the split honest is what stops d3-force from
// riding into page.bundle.js for code that never runs there.
//
// This is the engine version of a recipe docs/motion-graphics.md already describes by hand
// (paste the array into the .js). What the recipe cannot do is the part that makes it usable: the
// array is regenerated when the solver changes, sized against the beat's real length after TTS
// moves it, and kept out of the .js file whose bytes are re-inlined into every raster.

/** One frame of solver output. Numbers, or objects/arrays of them — whatever the graphic reads. */
export type SimRow = unknown;

export interface SimData {
  /** One row per frame, indexed by BEAT-LOCAL frame. */
  rows: SimRow[];
  fps: number;
  /** The seed the rows were solved with — restate it to reproduce them exactly. */
  seed: number;
}

/** What a graphic sees. `at` is this frame's row, already indexed — the beat-boundary arithmetic
 *  belongs to the engine, not to every solver's consumer. `rows` is there for trails and lookahead. */
export interface SimEnv {
  at: SimRow | null;
  rows: SimRow[];
  fps: number;
}

/** The empty sim every graphic gets when it has no bake, so `env.sim.at` is always safe to read
 *  and a missing bake reads as "nothing happened" rather than as a TypeError mid-render. */
export const EMPTY_SIM: SimEnv = { at: null, rows: [], fps: 0 };

export function simEnvAt(data: SimData | undefined, frame: number): SimEnv {
  if (!data) return EMPTY_SIM;
  // Clamp rather than return null past the end: a beat held on its last frame through a transition
  // (layers.ts §5) should hold the sim's last state too, not blink to nothing.
  const i = Math.min(Math.max(0, frame), data.rows.length - 1);
  return { at: data.rows.length ? data.rows[i] : null, rows: data.rows, fps: data.fps };
}
