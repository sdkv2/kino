// The simulation pathway: a stateful solver runs once, offline, and a pure graphic replays its rows.
//
// The properties worth testing are the ones the pathway exists to guarantee. Determinism first —
// a bake that cannot be reproduced from its seed is a video that cannot be re-rendered — then the
// frame indexing, which is the seam where a graphic would otherwise have to do beat arithmetic and
// get it wrong at a boundary.
import { describe, it, expect } from "vitest";
import { runSimSolver, lintSimSolver, seededRandom, simLib, DEFAULT_SIM_SEED } from "../src/render/simRun.js";
import { simEnvAt, EMPTY_SIM } from "../src/render/sim.js";

const ctx = { frames: 5, fps: 30, width: 1080, height: 1920, params: {} };

/** An integrator: frame N's value depends on frame N-1's. The shape Tier 2 cannot express. */
const FALLING = `
  let y = 0, v = 0;
  return (frame) => { v += 500 * sim.dt; y += v * sim.dt; return Math.round(y); };
`;

describe("runSimSolver", () => {
  it("collects a step function into one row per frame", () => {
    const { rows } = runSimSolver(FALLING, ctx);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toBeLessThan(rows[4] as number);
  });

  it("accepts a solver that returns the whole array up front", () => {
    const { rows } = runSimSolver("return [1, 2, 3, 4, 5];", ctx);
    expect(rows).toEqual([1, 2, 3, 4, 5]);
  });

  it("trims an overshoot to the beat rather than carrying it", () => {
    const { rows } = runSimSolver("return [1,2,3,4,5,6,7,8,9,10];", ctx);
    expect(rows).toHaveLength(5);
  });

  it("fails loudly when a solver runs out of rows — the alternative is a frozen graphic", () => {
    expect(() => runSimSolver("return [1, 2];", ctx)).toThrow(/2 rows for a 5-frame beat/);
  });

  it("rejects a solver that returns neither shape", () => {
    expect(() => runSimSolver("return 42;", ctx)).toThrow(/array of rows .* or a step function/);
  });

  it("hands the solver a pre-divided timestep, so nobody derives it wrong", () => {
    expect(runSimSolver("return [sim.dt];", { ...ctx, frames: 1, fps: 25 }).rows[0]).toBeCloseTo(0.04, 10);
  });

  it("passes the graphic's own params through, so one number serves both", () => {
    const out = runSimSolver("return [sim.params.gravity];", { ...ctx, frames: 1, params: { gravity: 9.8 } });
    expect(out.rows[0]).toBe(9.8);
  });
});

describe("reproducibility", () => {
  const DRAW = "return Array.from({length: sim.frames}, () => sim.random());";

  it("gives the same rows for the same seed, every time", () => {
    expect(runSimSolver(DRAW, ctx, 7).rows).toEqual(runSimSolver(DRAW, ctx, 7).rows);
  });

  it("gives different rows for a different seed", () => {
    expect(runSimSolver(DRAW, ctx, 7).rows).not.toEqual(runSimSolver(DRAW, ctx, 8).rows);
  });

  it("records the seed it solved with, so a bake can be reproduced from the file alone", () => {
    expect(runSimSolver(DRAW, ctx, 7).seed).toBe(7);
    expect(runSimSolver(DRAW, ctx).seed).toBe(DEFAULT_SIM_SEED);
  });

  it("draws a spread of values rather than a constant", () => {
    const rows = runSimSolver("return Array.from({length: sim.frames}, () => sim.random());", { ...ctx, frames: 64 }).rows as number[];
    expect(new Set(rows).size).toBeGreaterThan(50);
    expect(Math.min(...rows)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...rows)).toBeLessThan(1);
  });

  it("seededRandom is stable across calls with the same seed", () => {
    const a = seededRandom(99);
    const b = seededRandom(99);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("lintSimSolver", () => {
  it("allows state between steps — that is the entire point of the pathway", () => {
    expect(lintSimSolver("let v = 0; return (f) => { v += 1; return v; };")).toEqual([]);
  });

  it("rejects the ambient nondeterminism that would make a bake unreproducible", () => {
    expect(lintSimSolver("return [Math.random()];")[0]).toMatch(/Math\.random/);
    expect(lintSimSolver("return [Date.now()];")[0]).toMatch(/Date\.now/);
    expect(lintSimSolver("setTimeout(f, 1)")[0]).toMatch(/timer/);
  });

  it("names the substitute rather than just refusing", () => {
    expect(lintSimSolver("return [Math.random()];")[0]).toMatch(/sim\.random\(\)/);
  });

  it("is honest that Math.random is a readability rule, not a correctness one", () => {
    // The runner redirects the global to the seeded stream, so a solver using it WOULD reproduce.
    // The message must not claim otherwise — an inaccurate lint teaches the wrong model.
    expect(lintSimSolver("return [Math.random()];")[0]).not.toMatch(/cannot be re-rendered/);
  });

  it("ignores a commented-out violation", () => {
    expect(lintSimSolver("// Math.random() would break this\nreturn [1];")).toEqual([]);
    expect(lintSimSolver("/* Date.now() */ return [1];")).toEqual([]);
  });

  it("stops the solve, not just the lint", () => {
    expect(() => runSimSolver("return [Math.random()];", ctx)).toThrow(/sim\.random\(\)/);
    expect(() => runSimSolver("return [Date.now()];", ctx)).toThrow(/reproducible/);
  });
});

describe("simEnvAt", () => {
  const data = runSimSolver("return [10, 20, 30, 40, 50];", ctx);

  it("indexes THIS frame's row, so a graphic does no beat arithmetic", () => {
    expect(simEnvAt(data, 0).at).toBe(10);
    expect(simEnvAt(data, 3).at).toBe(40);
  });

  it("exposes the whole solve for trails and lookahead", () => {
    expect(simEnvAt(data, 0).rows).toHaveLength(5);
  });

  it("holds the last row past the end — a held beat holds its sim too", () => {
    // layers.ts §5 freezes an outgoing motion beat on its last authored frame through the handoff.
    // Returning null there would blink the simulation off under the transition.
    expect(simEnvAt(data, 99).at).toBe(50);
  });

  it("clamps a negative frame rather than reading off the front", () => {
    expect(simEnvAt(data, -4).at).toBe(10);
  });

  it("is an empty sim, not undefined, for a graphic with no solver", () => {
    expect(simEnvAt(undefined, 0)).toBe(EMPTY_SIM);
    expect(EMPTY_SIM.at).toBeNull();
    expect(EMPTY_SIM.rows).toEqual([]);
  });
});
