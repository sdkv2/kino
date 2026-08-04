// THE SOLVER. Runs ONCE, at build time, and it is allowed to do the thing a motion graphic cannot:
// keep state between frames.
//
// Everything below the `return` runs once per frame, in order, carrying `nodes` forward — frame 40
// is where it is because frames 0..39 happened. That is the shape a pure `render(env)` can never
// take, and moving it offline is what lets the renderer keep drawing frames out of order and across
// sharded hosts.
//
// Contract: return an array of rows, or a `(frame) => row` step function. One row per frame.

const N = 21;
const GROUPS = 3;
const RADIUS = 52;

// `sim.random()` is seeded and the seed is recorded with the bake, so this scatter is the SAME
// scatter every time the video is rendered. Change `seed` on the spec to draw a different one.
const nodes = Array.from({ length: N }, (_, i) => ({
  group: i % GROUPS,
  x: sim.random() * sim.width,
  y: sim.height * (0.12 + sim.random() * 0.76),
}));

// Where each group is heading. Thirds of the frame, so the three clusters land side by side.
const columnFor = (d) => sim.width * (0.22 + 0.28 * d.group);

// d3-force, from the bundled solver stdlib — a solver has no `require`, so `sim.lib` is the only
// way a library reaches one. `.stop()` takes the clock back from d3's own timer so this file owns
// the stepping; `.tick()` below then advances exactly one frame's worth per frame.
// The strengths are TUNED TO THE BEAT, and that is an authoring step rather than a detail. d3's
// defaults converge in a handful of ticks — a cluster that has finished forming by frame 14 of 90
// reads as a cut, not as motion — while weak forces never sort the groups at all and the piece ends
// on a shrug. Both were real first drafts here.
//
// These were picked by MEASURING the solve rather than re-rendering guesses (a solve is
// milliseconds; a still is half a minute). Two numbers decide it: the gap between group centres
// divided by the spread within a group, which says whether three columns actually read as three,
// and the mean per-node travel per ten frames at the start, middle and end, which says whether the
// motion lasts the beat and then stops. These land at 4.4x separation with travel 94 / 12 / 2 px —
// moving throughout, settled by the cut.
const solver = sim.lib.force
  .forceSimulation(nodes)
  .force("charge", sim.lib.force.forceManyBody().strength(-14))
  .force("collide", sim.lib.force.forceCollide(RADIUS).strength(0.5))
  .force("x", sim.lib.force.forceX(columnFor).strength(0.075))
  .force("y", sim.lib.force.forceY(sim.height * 0.46).strength(0.055))
  .stop();

// One tick per frame, and a row of plain numbers out. Rows ship inline in the render-page config,
// so they are rounded — a coordinate with fifteen decimals costs bytes on every frame and buys
// nothing the eye can see.
return (frame) => {
  solver.tick();
  return nodes.map((n) => [Math.round(n.x), Math.round(n.y), n.group]);
};
