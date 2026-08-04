// The solver standard library, and the two properties that make bundling one safe.
//
// A solver runs through `new Function("sim", src)` — no `require`, no `import` — and projects carry
// no node_modules of their own, so a library either arrives on `sim.lib` or it does not arrive.
// That makes two things load-bearing: the library has to be reachable, and it must not be able to
// break the reproducibility promise the pathway is built on.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { runSimSolver, simLib } from "../src/render/simRun.js";

const ctx = { frames: 8, fps: 30, width: 1080, height: 1920, params: {} };

/** 12 nodes relaxing toward the centre under charge + collide — Relay 11's shape, minus the
 *  hand-rolled relaxation loop that was the only way to get it before. */
const CLUSTER = `
  const nodes = Array.from({ length: 12 }, () => ({ x: sim.random() * sim.width, y: sim.random() * sim.height }));
  const s = sim.lib.force.forceSimulation(nodes)
    .force("charge", sim.lib.force.forceManyBody().strength(-40))
    .force("collide", sim.lib.force.forceCollide(46))
    .force("x", sim.lib.force.forceX(sim.width / 2).strength(0.12))
    .force("y", sim.lib.force.forceY(sim.height / 2).strength(0.12))
    .stop();
  return (frame) => { s.tick(); return nodes.map((n) => [Math.round(n.x), Math.round(n.y)]); };
`;

describe("sim.lib", () => {
  it("reaches the solver — the only way a library can, since there is no require", () => {
    expect(runSimSolver("return [typeof sim.lib.force.forceSimulation];", { ...ctx, frames: 1 }).rows[0]).toBe(
      "function",
    );
  });

  it("runs a real d3-force relaxation, one tick per frame", () => {
    const { rows } = runSimSolver(CLUSTER, ctx);
    expect(rows).toHaveLength(8);
    expect(rows[0]).toHaveLength(12);
  });

  it("actually converges — the nodes are closer to the centre at the end than the start", () => {
    const { rows } = runSimSolver(CLUSTER, { ...ctx, frames: 90 });
    const spread = (row: unknown) => {
      const pts = row as Array<[number, number]>;
      const d = pts.map(([x, y]) => Math.hypot(x - ctx.width / 2, y - ctx.height / 2));
      return d.reduce((a, b) => a + b, 0) / d.length;
    };
    expect(spread(rows[rows.length - 1])).toBeLessThan(spread(rows[0]) * 0.6);
  });

  it("keeps the nodes apart — collide is doing something", () => {
    const { rows } = runSimSolver(CLUSTER, { ...ctx, frames: 90 });
    const pts = rows[rows.length - 1] as Array<[number, number]>;
    let closest = Infinity;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        closest = Math.min(closest, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
      }
    }
    // Two radius-46 nodes settle around 92px apart; anything near 0 means collide never ran.
    expect(closest).toBeGreaterThan(40);
  });

  it("is reproducible across solves, and steerable by seed", () => {
    expect(runSimSolver(CLUSTER, ctx, 7).rows).toEqual(runSimSolver(CLUSTER, ctx, 7).rows);
    expect(runSimSolver(CLUSTER, ctx, 7).rows).not.toEqual(runSimSolver(CLUSTER, ctx, 8).rows);
  });
});

/** Coins dropped into a thick-walled well — the shape d3-force has no answer for. */
const COINS = `
  const M = sim.lib.matter;
  const engine = M.Engine.create();
  const coins = Array.from({ length: 9 }, () =>
    M.Bodies.circle(sim.width * (0.4 + 0.2 * sim.random()), -60 - sim.random() * 300, 44,
      { restitution: 0.35, friction: 0.45 }));
  const floorY = sim.height * 0.7;
  M.Composite.add(engine.world, [...coins,
    M.Bodies.rectangle(sim.width / 2, floorY + 140, 700, 240, { isStatic: true }),
    M.Bodies.rectangle(sim.width / 2 - 260, floorY - 1100, 120, 2400, { isStatic: true }),
    M.Bodies.rectangle(sim.width / 2 + 260, floorY - 1100, 120, 2400, { isStatic: true })]);
  return (frame) => {
    sim.lib.matterStep(engine, sim.dt);
    return coins.map((b) => [Math.round(b.position.x), Math.round(b.position.y), Math.round(b.angle * 180 / Math.PI)]);
  };
`;

describe("sim.lib.matter", () => {
  const solve = (frames = 90, seed?: number) =>
    runSimSolver(COINS, { ...ctx, frames }, seed).rows as Array<Array<[number, number, number]>>;

  it("falls, lands, and comes to rest inside the beat", () => {
    const rows = solve();
    const travel = (a: number, b: number) =>
      rows[b].reduce((s, r, i) => s + Math.hypot(r[0] - rows[a][i][0], r[1] - rows[a][i][1]), 0) / 9;
    expect(travel(10, 20)).toBeGreaterThan(30); // still falling
    expect(travel(80, 89)).toBeLessThan(5); // settled
  });

  it("keeps every body on screen — the static geometry is doing its job", () => {
    // A missing or thin floor does not error: bodies fall forever, and the render is simply empty.
    const last = solve()[89];
    expect(last.every(([, y]) => y > 0 && y < 1920)).toBe(true);
  });

  it("STACKS — bodies rest on each other, not just on the floor", () => {
    // This is the property d3-force cannot express at all. A single resting layer would put every
    // body at the same y; a heap puts them at several.
    const ys = solve()[89].map(([, y]) => y).sort((a, b) => a - b);
    let layers = 1;
    for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] > 44) layers++;
    expect(layers).toBeGreaterThan(1);
  });

  it("gives each body its own rest ANGLE — the other thing forces cannot do", () => {
    const angles = solve()[89].map(([, , deg]) => ((deg % 360) + 360) % 360);
    expect(new Set(angles.map((a) => Math.round(a / 20))).size).toBeGreaterThan(2);
  });

  it("is reproducible, including a second solve in the same process", () => {
    // matter-js keeps its PRNG state in a module-level Common._seed, so this would drift without
    // the reset in withSeededRandom — and it would drift only for a spec with more than one
    // simulated beat, which is the worst way for it to be found.
    expect(solve(30, 5)).toEqual(solve(30, 5));
    expect(solve(30, 5)).not.toEqual(solve(30, 6));
  });
});

describe("matterStep", () => {
  it("sub-steps to matter's preferred rate rather than handing it a whole frame", () => {
    const M = simLib.matter;
    const count = (fps: number) => {
      const engine = M.Engine.create();
      let calls = 0;
      const real = M.Engine.update;
      (M.Engine as { update: typeof M.Engine.update }).update = ((e, d) => {
        calls++;
        return real(e, d);
      }) as typeof M.Engine.update;
      try {
        simLib.matterStep(engine, 1 / fps);
      } finally {
        (M.Engine as { update: typeof M.Engine.update }).update = real;
      }
      return calls;
    };
    expect(count(30)).toBe(2); // a 33ms frame becomes two ~16.7ms steps
    expect(count(60)).toBe(1); // a 60fps frame is already the right size
    expect(count(24)).toBe(3);
  });

  it("honours an explicit substep count", () => {
    const engine = simLib.matter.Engine.create();
    expect(() => simLib.matterStep(engine, 1 / 30, 4)).not.toThrow();
  });
});

describe("Math.random during a solve", () => {
  it("is redirected to the seeded stream, so a library cannot break a bake", () => {
    // The lint reads the solver's source only. A library reaching for the global would sail past
    // it — this is the guard that makes that harmless.
    const viaGlobal = "const f = Math['ra' + 'ndom']; return Array.from({length: sim.frames}, () => f());";
    expect(runSimSolver(viaGlobal, ctx, 3).rows).toEqual(runSimSolver(viaGlobal, ctx, 3).rows);
    expect(runSimSolver(viaGlobal, ctx, 3).rows).not.toEqual(runSimSolver(viaGlobal, ctx, 4).rows);
  });

  it("is restored afterwards, including when the solver throws", () => {
    const real = Math.random;
    runSimSolver("return [1];", { ...ctx, frames: 1 });
    expect(Math.random).toBe(real);
    expect(() => runSimSolver("throw new Error('boom');", ctx)).toThrow(/boom/);
    expect(Math.random).toBe(real);
  });
});

describe("the page/build split", () => {
  // sim.ts ships to the renderer; simRun.ts must not. A stray import in the wrong direction would
  // drag d3-force into page.bundle.js for code the browser never executes, and nothing about the
  // build would fail — the bundle would just quietly grow.
  it("keeps the page-side module free of the runner and its library", () => {
    const page = readFileSync(new URL("../src/render/sim.ts", import.meta.url), "utf8");
    // Only what this module actually PULLS IN counts — the header prose names d3-force and
    // simRun.ts precisely to explain why neither is imported here, and an assertion that banned the
    // words would punish the comment that documents the rule.
    const imports = [...page.matchAll(/^\s*import\b[^;]*?from\s*["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(imports.filter((m) => /simRun|d3-|node:/.test(m))).toEqual([]);
  });

  it("still exports the replay half the renderer needs", async () => {
    const page = await import("../src/render/sim.js");
    expect(typeof page.simEnvAt).toBe("function");
    expect(page.EMPTY_SIM.at).toBeNull();
  });

  it("announces every bundled library by name, so discovery cannot drift from reality", async () => {
    const { solverContract } = await import("../src/commands/bake.js");
    for (const name of Object.keys(simLib)) expect(solverContract()).toContain(`sim.lib.${name}`);
  });
});
