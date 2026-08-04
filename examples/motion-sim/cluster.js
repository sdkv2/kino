// THE GRAPHIC. A Tier-2 proc, and note what it is NOT: stateful.
//
// It keeps nothing, integrates nothing, and would produce the same markup if kino asked for frame
// 40 first and frame 0 last. All it does is index the row the solver already computed — which is
// exactly what a pure `(env) => string` has always been able to do.
//
// That is the whole trick. The physics is real; it just happened before the render started.

// `env.sim.at` is THIS frame's row, already indexed on the beat's clock — no arithmetic here, and
// it holds its last row through a handoff rather than blinking off. `|| []` because a graphic with
// no solver attached gets an empty sim rather than a crash.
const nodes = env.sim.at || [];

// One palette role per group. Semantic colours, so the demo also shows a fabricated UI drawing
// entirely from the brand instead of hard-coding hexes.
const ROLE = ["var(--kino-ok)", "var(--kino-warn)", "var(--kino-danger)"];

const tiles = nodes
  .map(([x, y, group]) => {
    // Settle-in: each tile scales up over the first ~0.4s. This part IS a pure function of
    // progress, and belongs here rather than in the solver — the solver is for what needs memory.
    const pop = Math.min(1, env.t / 0.25);
    return `<div style="position:absolute;left:${x}px;top:${y}px;width:88px;height:88px;
      margin:-44px 0 0 -44px;border-radius:20px;
      background:var(--kino-surface);border:3px solid ${ROLE[group]};
      transform:scale(${(0.2 + 0.8 * pop).toFixed(3)});opacity:${pop.toFixed(3)}"></div>`;
  })
  .join("");

return `<div style="position:absolute;inset:0">
  ${tiles}
  <div style="position:absolute;left:72px;right:72px;top:120px;color:var(--kino-fg);
    font:700 60px var(--kino-font);letter-spacing:-0.02em">Twenty-one nodes,<br>finding their groups.</div>
  <div style="position:absolute;left:72px;bottom:150px;color:var(--kino-muted);
    font:600 32px var(--kino-label-font)">
    solved once at build &middot; replayed by a pure function &middot; frame ${env.frame} of ${env.durationFrames}
  </div>
</div>`;
