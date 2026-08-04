// A 3D solver, written by hand.
//
// Both bundled libraries are 2D — `sim.lib.force` lays out a plane, `sim.lib.matter` collides in
// one. Neither is a ceiling: a solver is arbitrary stateful JS, and three dimensions cost exactly
// one more component per vector. This file is the demonstration of that, and it is short.
//
// Twelve panels start scattered deep in space, tumbling. Each is pulled to its slot on a wall by a
// damped spring with its own mass, while its orientation is pulled to square. They arrive in
// sequence, not together — and a thirteenth, the HERO, arrives last and settles in front of them.
//
// The hero is a composition decision expressed in the solve. Twelve equal panels at twelve equal
// slots give the eye nowhere to land; one element that is larger, nearer, later and the only
// saturated thing in frame gives the shot a subject and makes everything else supporting cast.

const COLS = 3;
const ROWS = 4;
const N = COLS * ROWS;
/** The hero rests IN FRONT of the wall, off the grid and off centre. */
const HERO_Z = 700;

// Slot geometry, in composition pixels. z = 0 is the wall plane; the camera sits at +z.
const GAP_X = 300;
const GAP_Y = 292;
const originX = sim.width / 2 - ((COLS - 1) * GAP_X) / 2;
const originY = sim.height * 0.5 - ((ROWS - 1) * GAP_Y) / 2;

const panels = Array.from({ length: N }, (_, i) => {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  return {
    i,
    // Where it belongs.
    tx: originX + col * GAP_X,
    ty: originY + row * GAP_Y,
    // Where it starts: scattered, and spread through DEPTH on both sides of the wall — some panels
    // sweep in from behind the camera plane growing large, others rise from far away growing from
    // nothing. A swarm that all starts at one depth reads as a flat layer sliding, not as volume.
    //
    // The positive end is capped well under the renderer's perspective distance. In CSS a child at
    // translateZ(Z) under `perspective: P` scales by P/(P−Z), so Z approaching P is the eye itself:
    // the panel explodes to infinity and then vanishes. That is a hard geometric limit, not a taste
    // one — see panels.js, which states the P it pairs with.
    x: sim.width / 2 + (sim.random() - 0.5) * sim.width * 1.6,
    y: sim.height * 0.5 + (sim.random() - 0.5) * sim.height * 0.9,
    z: (sim.random() - 0.38) * 2000,
    // A slow drift before release. Without it an unreleased panel is frozen in space — it spins on
    // the spot and then launches, which reads as a glitch rather than as a swarm. Everything in
    // frame should be moving, however slightly, at all times.
    vx: (sim.random() - 0.5) * 190,
    vy: (sim.random() - 0.5) * 150,
    vz: (sim.random() - 0.5) * 220,
    // Tumbling, in degrees. Each panel gets its own spin so the swarm never looks keyframed.
    rx: (sim.random() - 0.5) * 320,
    ry: (sim.random() - 0.5) * 320,
    wx: (sim.random() - 0.5) * 260,
    wy: (sim.random() - 0.5) * 260,
    // Per-panel mass, so they do not all land on the same frame. This is the whole reason the
    // solver has state: a stiffness that varies per element cannot be expressed as one shared
    // eased curve, and a wall that assembles in one beat reads as a cut.
    k: 26 + sim.random() * 16,
    // Staggered release. Until its moment a panel drifts on its initial spin, which keeps the
    // frame alive during the part of the beat where nothing has arrived yet.
    // Spread so the LAST panel lands around three-quarters through the beat. Tuned against the
    // measured arrival spread, not guessed: a wall that finishes assembling at the halfway mark
    // leaves the back half of the beat with nothing happening in it.
    delay: 0.05 + (i % COLS) * 0.13 + Math.floor(i / COLS) * 0.42 + sim.random() * 0.16,
  };
});

// The hero: same physics, different destination and the latest release of all. It gets a slower
// spring (a lower k) so its approach is longer and heavier than the wall's — mass you can read.
panels.push({
  i: N,
  hero: true,
  tx: sim.width * 0.44,
  ty: sim.height * 0.54,
  tz: HERO_Z,
  // Sweeps in from off the upper right, large and close, rather than growing from the middle. Its
  // start z is capped well under the graphic's perspective distance for the reason stated there —
  // at 2050 it scaled 4.7x and swamped the opening, which is the same P/(P−Z) limit biting from
  // the other end.
  x: sim.width * 1.18,
  y: sim.height * 0.24,
  z: 1450,
  vx: 0,
  vy: 0,
  vz: 0,
  rx: -46,
  ry: 128,
  wx: 26,
  wy: -150,
  k: 17,
  delay: 0.86,
});

// Critical damping for a given stiffness — the ratio that settles fastest without overshoot. A
// touch under it (0.86) leaves a little overshoot, which is what makes a landing read as a landing
// rather than as a stop.
const damping = (k) => 2 * Math.sqrt(k) * 0.86;

// The stagger is a RAMP, not a gate. The first draft switched each panel's spring on at its delay
// and left it inert before then, which produced the two defects that reading looked wrong:
//
//   • Nothing pulled a waiting panel anywhere, so it drifted in a straight line at constant speed,
//     spinning at a constant rate. Constant velocity with no acceleration reads as debris floating,
//     not as an object with somewhere to be — it hangs.
//   • The switch itself was a discontinuity. A panel drifting one way would have a strong spring
//     appear in one frame and yank it another, which is a motion no physical thing makes.
//
// So every panel is under a weak pull from frame 0 — already committed, already converging — and
// its own moment is where that pull ramps up to full. The stagger survives; the hanging does not.
const BASELINE = 0.12; // fraction of full stiffness before a panel's moment
const RAMP_SEC = 0.55; // how long the pull takes to come up to full

return (frame) => {
  const t = frame * sim.dt;
  for (const p of panels) {
    // Smoothstep so the force has no corner in it — a linear ramp still leaves a visible kink at
    // both ends, and the eye finds those on a moving object surprisingly easily.
    const u = Math.min(1, Math.max(0, (t - p.delay) / RAMP_SEC));
    const k = p.k * (BASELINE + (1 - BASELINE) * (u * u * (3 - 2 * u)));
    const c = damping(k);

    // Position: a damped spring per axis, integrated forward. Frame N depends on frame N-1.
    p.vx += (-k * (p.x - p.tx) - c * p.vx) * sim.dt;
    p.vy += (-k * (p.y - p.ty) - c * p.vy) * sim.dt;
    p.vz += (-k * (p.z - (p.tz || 0)) - c * p.vz) * sim.dt;
    // Orientation: the same spring toward square, a little slower so the panel is still levelling
    // out as it lands. Damping ramps with the stiffness, so the tumble slows gradually rather than
    // running at a fixed rate and then suddenly braking.
    p.wx += (-k * 0.72 * p.rx - c * p.wx) * sim.dt;
    p.wy += (-k * 0.72 * p.ry - c * p.wy) * sim.dt;

    p.x += p.vx * sim.dt;
    p.y += p.vy * sim.dt;
    p.z += p.vz * sim.dt;
    p.rx += p.wx * sim.dt;
    p.ry += p.wy * sim.dt;

    // THE LANDING, as an event rather than a position. A pure graphic can see that a panel is
    // stationary, but not that THIS is the frame it stopped — that needs the previous frame, which
    // is the one thing only the solver has. So the solver decides, and emits a decaying impulse the
    // graphic can spend on a glint. This is the same trick as velocity: state the renderer would
    // otherwise have to fake, computed once where it is already known.
    const gap = Math.hypot(p.x - p.tx, p.y - p.ty, p.z - (p.tz || 0));
    const speed = Math.hypot(p.vx, p.vy, p.vz);
    if (!p.landed && gap < 26 && speed < 190) {
      p.landed = true;
      p.impact = 1;
    }
    p.impact = (p.impact || 0) * 0.83;
  }

  // Rounded, and the row carries SPEED as its last field. The graphic uses it for motion blur and
  // for the leading-edge glint — the solver already knows how fast every panel is moving, and
  // throwing that away means the renderer has to fake it or go without.
  return panels.map((p) => [
    Math.round(p.x),
    Math.round(p.y),
    Math.round(p.z),
    Math.round(p.rx),
    Math.round(p.ry),
    Math.round(Math.hypot(p.vx, p.vy, p.vz)),
    Math.round((p.impact || 0) * 100) / 100,
    p.hero ? 1 : 0,
  ]);
};
