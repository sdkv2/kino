// THE SIMULATION PATHWAY — the half that RUNS a solver. Build-time only.
//
// Split out of sim.ts because that module is reachable from the page bundle and this one must never
// be: it carries the solver stdlib (`sim.lib`), which the browser never executes and should not
// download. Nothing under native/page/ may import this file.
//
// REPRODUCIBILITY is the contract this file enforces, and it is enforced twice over.
//
//   1. The solver SOURCE is linted for ambient nondeterminism, the same denylist Tier 2 carries
//      minus the part about state — a solver is allowed, and expected, to keep state between steps.
//   2. `Math.random` is REPLACED by the seeded stream for the duration of the solve. The lint only
//      reads the solver's own text, so a library reaching for `Math.random` inside its own internals
//      would sail straight past it and quietly make the bake unreproducible — and the symptom would
//      be "re-rendering changed the video", which is about the worst bug shape there is.
//
//      d3-force specifically does NOT need this: it threads its own seeded LCG (src/lcg.js, exposed
//      as `simulation.randomSource`) and never touches the global, which is part of why it was the
//      right library to bundle first. The swap is the guard for everything that comes after it —
//      the next library, and any solver that reaches for the global out of habit.
//
// Together: same solver, same seed, same frames → identical rows, on any machine, forever.
import * as d3Force from "d3-force";
import Matter from "matter-js";
import type { SimData, SimRow } from "./sim.js";

/**
 * The solver standard library.
 *
 * Curated and bundled rather than imported, exactly as Tier 2's `env.lib` is — a solver body runs
 * through `new Function("sim", src)` and has no `require`, and projects carry no node_modules of
 * their own, so "just import a package" is not a thing an author can do. The alternative to
 * curating is every solver hand-rolling its own relaxation loop.
 *
 * `force` is d3-force, and it was picked first for three reasons that compound: `simulation.tick()`
 * IS this file's step contract so it needs no adapter, it is a sibling of the `d3-shape` already
 * bundled in Tier 2's `env.lib` (extending a validated dependency decision rather than reopening
 * one), and it carries its own seeded LCG instead of touching `Math.random`, so it is reproducible
 * on its own terms.
 *
 * It covers the class of motion that CONVERGES rather than collides — nodes settling into a cluster,
 * labels pushing apart, a graph finding its shape. What it deliberately does not cover is rigid-body
 * contact: no restitution, no rotation, no stacking. A board asking for coins landing in a pile
 * wants a rigid-body engine, which is a separate decision with a much larger dependency behind it;
 * until then that solver is a hand-written integrator, which `sim.dt` exists to make short.
 */
export interface SimLib {
  /** d3-force — `forceSimulation(nodes)`, `forceCollide`, `forceX/Y`, `forceLink`, `forceManyBody`.
   *  Drive it with `.stop()` then one `.tick()` per frame; never `.restart()`, which hands control
   *  to a timer this pathway does not have. */
  force: typeof d3Force;
  /**
   * matter-js — 2D RIGID BODY. `Engine`, `Bodies`, `Composite`, `Body`, `Constraint`, `Events`.
   *
   * The complement to `force`, not a bigger version of it: forces CONVERGE (points drifting toward
   * a target), bodies COLLIDE (contact, friction, restitution, and — the part nothing else here
   * offers — rotation and resting stacks). A tile settling into a cluster is a force problem; coins
   * landing in a heap at believable angles is a body problem.
   *
   * Drive it with `matterStep` rather than `Engine.update` directly, unless you know why not.
   */
  matter: typeof Matter;
  /**
   * Advance a matter-js engine by exactly one FRAME, sub-stepped.
   *
   * matter-js is tuned for ~16.7ms steps. A 30fps frame is 33.3ms, and handing the solver the whole
   * thing at once degrades exactly what a rigid-body engine is here for: stacks jitter, fast bodies
   * tunnel through thin floors, and resting contact never quite rests. The fix is standard and
   * mechanical — take several smaller steps per frame — which makes it the pathway's job rather than
   * every solver author's, since the symptom is "the pile looks a bit wrong" rather than an error.
   *
   * `substeps` defaults to however many keep each step at or under 1/60s, so it adapts to the
   * composition's fps instead of assuming 30.
   */
  matterStep(engine: Matter.Engine, dtSeconds: number, substeps?: number): void;
}

/** Longest sub-step matter-js is comfortable with. */
const MATTER_MAX_STEP = 1 / 60;

function matterStep(engine: Matter.Engine, dtSeconds: number, substeps?: number): void {
  const n = Math.max(1, substeps ?? Math.ceil(dtSeconds / MATTER_MAX_STEP - 1e-9));
  const step = (dtSeconds * 1000) / n;
  // A CONSTANT delta every call, which is the other half of matter-js determinism — the engine
  // scales its integrator by the ratio to the previous delta, so a varying one changes the result.
  for (let i = 0; i < n; i++) Matter.Engine.update(engine, step);
}

export const simLib: SimLib = { force: d3Force, matter: Matter, matterStep };

/** What a solver is handed. Everything it needs to be reproducible, and nothing that isn't. */
export interface SimContext {
  /** Frames to produce. Defaults to the beat's own length, so a bake follows real TTS. */
  frames: number;
  fps: number;
  /** Seconds per frame — the integration step, pre-divided so no solver has to get it wrong. */
  dt: number;
  /** Composition pixels, for a solver working in screen space. */
  width: number;
  height: number;
  /** Author params, the same bag the graphic reads — so a solver and its graphic can share one
   *  number instead of two copies of it. */
  params: Record<string, number | string>;
  /** Seeded, reproducible uniform [0,1). The randomness a solver should reach for by name;
   *  `Math.random` is both linted out AND redirected here for the duration of the solve. */
  random(): number;
  /** Bundled solver libraries — see SimLib. */
  lib: SimLib;
}

/** Default PRNG seed. Any integer reproduces its own bake; this one is just the value a spec that
 *  never mentions a seed gets. */
export const DEFAULT_SIM_SEED = 0x5eed;

/**
 * mulberry32 — 32-bit state, one multiply-xor round. Chosen for being short enough to read and
 * verify at a glance: the property that matters is not statistical quality (a coin sim does not
 * need a Mersenne twister) but that the same seed gives the same stream on every machine and every
 * Node version, and a hand-written integer PRNG guarantees that where `Math.random` cannot.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Ambient nondeterminism a solver may not reach for. Mirrors the Tier-2 determinism lint, minus the
 * part about state — a solver is allowed, and expected, to keep state between steps.
 *
 * `Math.random` is the one entry that is a READABILITY rule rather than a correctness one, and its
 * message says so: the solve redirects `Math.random` to the seeded stream anyway, so a solver using
 * it would in fact reproduce. It stays rejected because a solver whose randomness is named
 * `sim.random()` is visibly seeded, while one calling `Math.random` only reproduces because of a
 * global swap happening somewhere else — and the redirect exists for library internals the lint
 * cannot read, not as a blessing for code it can.
 */
const NONDETERMINISM: Array<{ re: RegExp; message: string }> = [
  {
    re: /\bMath\s*\.\s*random\b/,
    message:
      "simulation solver uses Math.random() — call sim.random() instead, so the solver reads as seeded rather than reproducing only because the runner swaps the global out from under it.",
  },
  ...(
    [
      ["Date.now()", /\bDate\s*\.\s*now\b/, "the frame index the solver is already stepping"],
      ["new Date()", /\bnew\s+Date\b/, "the frame index the solver is already stepping"],
      ["performance.now()", /\bperformance\s*\.\s*now\b/, "the frame index the solver is already stepping"],
      ["a timer", /\bsetTimeout\b|\bsetInterval\b|\brequestAnimationFrame\b/, "a plain loop — the solver owns its own clock"],
    ] as Array<[string, RegExp, string]>
  ).map(([what, re, instead]) => ({
    re,
    message: `simulation solver uses ${what} — a bake has to be reproducible from its seed, or the video cannot be re-rendered. Use ${instead}.`,
  })),
];

/** Strip line and block comments so a commented-out `Math.random` does not fail a build. Same
 *  policy as lintBackfaceVisibility. */
const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

export function lintSimSolver(src: string): string[] {
  const code = stripComments(src);
  return NONDETERMINISM.filter(({ re }) => re.test(code)).map(({ message }) => message);
}

/**
 * Run `solve` with `Math.random` pointing at the seeded stream, then put it back.
 *
 * Patching a global is not something to do lightly, so: the solve is SYNCHRONOUS and build-time, in
 * a single-threaded process, with no await anywhere inside it — so nothing else can observe the
 * swapped global, and the `finally` restores it even when a solver throws. The alternative is a lint
 * that can only see the solver's own source and is therefore blind to exactly the case that matters
 * (a bundled library's internals), which would leave the reproducibility promise depending on
 * whether a dependency happened to be written carefully.
 */
function withSeededRandom<T>(random: () => number, solve: () => T): T {
  const real = Math.random;
  Math.random = random;
  // matter-js keeps its PRNG state in a MODULE-level `Common._seed`, so a second solve in the same
  // build would continue the first one's sequence rather than restart — "same seed, same rows" would
  // hold for a spec with one simulated beat and quietly stop holding for a spec with two. Nothing
  // inside matter-js's own solver draws from it (only `Common.random`, which is a utility for
  // callers), so this is a guard for solver code rather than a correctness fix for the engine. The
  // `in` check keeps it from throwing if a future version drops the field; the property it protects
  // is covered by a reproducibility test, not by this line existing.
  // `_seed` is deliberately absent from matter-js's public typings — hence `unknown` rather than a
  // direct cast, which TS rejects as a non-overlapping conversion. There is no setter to use
  // instead: `Common.setSeed` does not exist in 0.20.
  const common = Matter.Common as unknown as { _seed?: number };
  const matterSeed = typeof common._seed === "number" ? common._seed : null;
  if (matterSeed !== null) common._seed = 0;
  try {
    return solve();
  } finally {
    Math.random = real;
    if (matterSeed !== null) common._seed = matterSeed;
  }
}

/**
 * Run a solver once and collect its rows.
 *
 * The solver is a module body evaluated with `new Function("sim", src)` — the same shape a Tier-2
 * proc takes, so an author who has written one already knows the contract. It returns either an
 * array of rows (solve everything up front, the natural shape for a closed-form or batch solver) or
 * a per-frame step function (the natural shape for an integrator, which wants to be called
 * `frames` times and keep its own state in the closure).
 *
 * Both are collected into the same frame-indexed array, because that is the only shape the renderer
 * can consume — see sim.ts's header for why.
 */
export function runSimSolver(
  src: string,
  ctx: Omit<SimContext, "random" | "dt" | "lib">,
  seed = DEFAULT_SIM_SEED,
): SimData {
  const lint = lintSimSolver(src);
  if (lint.length) throw new Error(lint.join("\n"));

  const random = seededRandom(seed);
  const sim: SimContext = {
    ...ctx,
    dt: ctx.fps > 0 ? 1 / ctx.fps : 0,
    random,
    lib: simLib,
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function("sim", src) as (s: SimContext) => unknown;

  // The whole solve sits inside one swap — the setup body AND every step call. A solver that draws
  // its start state at the top and jiggles it per tick has to see one continuous seeded stream, or
  // the two halves would be reproducible separately and not together.
  const rows = withSeededRandom(random, (): SimRow[] => {
    const out = fn(sim);
    if (Array.isArray(out)) return out;
    if (typeof out === "function") {
      const step = out as (frame: number) => SimRow;
      return Array.from({ length: ctx.frames }, (_, f) => step(f));
    }
    throw new Error(
      "simulation solver must return an array of rows (one per frame) or a step function (frame) => row",
    );
  });

  if (rows.length < ctx.frames) {
    throw new Error(
      `simulation solver produced ${rows.length} rows for a ${ctx.frames}-frame beat — every frame needs one, or the graphic freezes where they run out`,
    );
  }
  // A solver that overshoots is fine and common (solve a round number, use what the beat needs);
  // trimming here keeps the file the size of the beat rather than the size of the guess.
  return { rows: rows.slice(0, ctx.frames), fps: ctx.fps, seed };
}
