// Run a simulation solver on its own and report what it produced.
//
// A build runs the solver for you (see render/sim.ts and the `sim` block on a motion beat), so this
// command is not a step in the pipeline — it is the way to see the bake before a render does. That
// matters more here than for most authoring surfaces, because a solver's output is numbers rather
// than pixels: "the coins land in a pile" and "the coins all land at y=0 on frame 3" produce very
// different videos and identical builds, and the second one is only visible in the rows.
import { readFileSync, writeFileSync } from "node:fs";
import { resolveProject } from "../config/project.js";
import { resolveMotionSource } from "../media/motionLib.js";
import { compDims, parseFormatList, type FormatId } from "../render/formats.js";
import { runSimSolver, DEFAULT_SIM_SEED, simLib } from "../render/simRun.js";

export interface BakeOpts {
  project?: string;
  frames?: string;
  fps?: string;
  seed?: string;
  format?: string;
  params?: string;
  out?: string;
  as?: string;
}

/** Rows are opaque to the engine, so summarise structurally rather than pretending to know the
 *  units: what shape a row is, and how much of the solve is actually moving. */
function describe(rows: unknown[]): string[] {
  const first = rows[0];
  const shape = Array.isArray(first)
    ? `array of ${first.length}`
    : first && typeof first === "object"
      ? `object { ${Object.keys(first as object).join(", ")} }`
      : typeof first;
  const out = [`  row shape   ${shape}`];
  // A solver whose every row is identical is the single most common failure — an integrator that
  // never gets stepped, or a step function that ignores its frame argument.
  const distinct = new Set(rows.map((r) => JSON.stringify(r))).size;
  out.push(`  distinct    ${distinct} of ${rows.length} rows`);
  if (distinct === 1) {
    out.push("  WARNING     every frame is identical — the solver is not being stepped");
  }

  // Detect settled body inter-penetration for [x, y, angle] body arrays in the final frame
  const last = rows[rows.length - 1];
  if (Array.isArray(last) && last.length > 1 && Array.isArray(last[0]) && last[0].length >= 2) {
    let overlaps = 0;
    const items = last as Array<[number, number, number?]>;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const dx = Math.abs(items[i][0] - items[j][0]);
        const dy = Math.abs(items[i][1] - items[j][1]);
        // Typical pill dimensions ~176x84 — flag tight center overlap (< 100x45)
        if (dx < 100 && dy < 45) overlaps++;
      }
    }
    if (overlaps > 0) {
      out.push(`  HINT        ${overlaps} settled body pair(s) overlap — use chamfer, low rest speed (<0.2), and restCount > 10`);
    }
  }
  return out;
}

export async function bake(solverRef: string, opts: BakeOpts): Promise<void> {
  const project = resolveProject({ project: opts.project });
  const solver = resolveMotionSource(solverRef, project);
  const src = readFileSync(solver.abs, "utf8");

  const formats: FormatId[] = opts.format ? parseFormatList(opts.format) : ["9:16"];
  const dims = compDims(formats[0]);
  const fps = opts.fps ? Number(opts.fps) : 30;
  const frames = opts.frames ? Number(opts.frames) : Math.round(fps * 3);
  const seed = opts.seed ? Number(opts.seed) : DEFAULT_SIM_SEED;
  const params = opts.params ? (JSON.parse(opts.params) as Record<string, number | string>) : {};

  const data = runSimSolver(src, { frames, fps, width: dims.width, height: dims.height, params }, seed);

  const asJson = opts.as === "json";
  if (opts.out) {
    writeFileSync(opts.out, JSON.stringify(data));
    if (!asJson) process.stdout.write(`wrote ${opts.out}\n`);
  }
  if (asJson) {
    process.stdout.write(`${JSON.stringify(data)}\n`);
    return;
  }

  const w = process.stdout.write.bind(process.stdout);
  w(`${solver.display} — ${frames} frames at ${fps}fps, seed ${seed}\n`);
  for (const line of describe(data.rows)) w(`${line}\n`);
  w(`  first       ${JSON.stringify(data.rows[0])}\n`);
  w(`  last        ${JSON.stringify(data.rows[data.rows.length - 1])}\n`);
  w("\n");
  w("Attach it to a beat — the build runs the solver itself, and the graphic reads env.sim:\n");
  w(`  { "kind": "motion", "source": "motion/x.js", "sim": { "source": "${solverRef}" } }\n`);
  w("  render(env) { const row = env.sim.at; ... }\n");
  w("\n");
  w(solverContract());
}

/**
 * The authoring contract, printed after every bake.
 *
 * A solver has no `require` and projects carry no node_modules, so a bundled stdlib that nobody
 * announces is a stdlib nobody uses — the same reason `kino motion` prints the `env.lib` contract
 * rather than leaving it in the docs.
 */
export function solverContract(): string {
  return [
    "The `sim` context a solver is handed:",
    "  sim.frames / sim.fps   frames to produce, and the rate they play at",
    "  sim.dt                 seconds per frame — the integration step, pre-divided",
    "  sim.width / sim.height composition pixels",
    "  sim.params             the graphic's own params, so both read one number",
    "  sim.random()           seeded, reproducible uniform [0,1)",
    `  sim.lib                bundled solver libraries: ${Object.keys(simLib).join(", ")}`,
    "",
    "  sim.lib.force is d3-force — an iterative LAYOUT solver (nodes settling into a cluster,",
    "  labels pushing apart, a graph finding its shape). Drive it a frame at a time:",
    "",
    "    const sim3 = sim.lib.force.forceSimulation(nodes)",
    "      .force('charge', sim.lib.force.forceManyBody().strength(-30))",
    "      .force('collide', sim.lib.force.forceCollide(28))",
    "      .force('x', sim.lib.force.forceX(sim.width / 2))",
    "      .force('y', sim.lib.force.forceY(sim.height / 2))",
    "      .stop();                       // never .restart() — that hands control to a timer",
    "    return (frame) => { sim3.tick(); return nodes.map((n) => [Math.round(n.x), Math.round(n.y)]); };",
    "",
    "  It has no collision geometry, rotation or restitution — it converges, it does not collide.",
    "",
    "  sim.lib.matter is matter-js — 2D RIGID BODY, for when things COLLIDE rather than converge:",
    "  contact, friction, restitution, and the two nothing else here offers, rotation and resting",
    "  stacks. Step it with sim.lib.matterStep, which sub-steps to matter's preferred 1/60s:",
    "",
    "    const M = sim.lib.matter;",
    "    const engine = M.Engine.create();",
    "    engine.positionIterations = 10; // prevent inter-penetration on dense piles",
    "    engine.velocityIterations = 10;",
    "    const tiles = Array.from({ length: 12 }, (_, i) =>",
    "      M.Bodies.rectangle(sim.random() * sim.width, -100 * sim.random(), 176, 84,",
    "                         { chamfer: { radius: 10 }, restitution: 0.15, friction: 0.35 }));",
    "    const floor = M.Bodies.rectangle(sim.width / 2, sim.height * 0.8, sim.width, 40,",
    "                                     { isStatic: true });   // WITHOUT THIS THEY FALL FOREVER",
    "    M.Composite.add(engine.world, [...tiles, floor]);",
    "    const restCount = tiles.map(() => 0), prev = tiles.map(() => null);",
    "    return (frame) => {",
    "      sim.lib.matterStep(engine, sim.dt);",
    "      return tiles.map((b, i) => {",
    "        const speed = Math.hypot(b.velocity.x, b.velocity.y);",
    "        if (speed < 0.2 && Math.abs(b.angularVelocity) < 0.005) restCount[i]++; else restCount[i] = 0;",
    "        if (prev[i] && restCount[i] > 10) return prev[i];",
    "        return (prev[i] = [Math.round(b.position.x), Math.round(b.position.y), Math.round(b.angle * 57.2958)]);",
    "      });",
    "    };",
    "",
    "  The static floor is the classic silent failure: forget it and every body falls off-screen",
    "  with no error at all. Match DOM border-radius with `chamfer: { radius: R }` so collision",
    "  geometry aligns with the rendered shape, and require sustained low velocity (restCount > 10",
    "  at speed < 0.2) before locking outputs.",
    "",
    "Return an array of rows, or a (frame) => row step function. `frames` defaults to the beat's",
    "own length, so a bake follows real TTS — set it only when the count is the point (a loop that",
    "must close on exactly N frames). State between steps is the whole point; Date.now/timers are",
    "rejected, and Math.random is redirected to the seeded stream so a library cannot break a bake.",
    "",
  ].join("\n");
}
