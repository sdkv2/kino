# motion-sim — two beats, two solvers

A complete demonstration of the [simulation pathway](../../docs/spec-reference.md#simulation), and of
the two halves of the solver stdlib side by side:

| Beat | Solver | Shows |
|---|---|---|
| **Twenty-one nodes finding their groups** | `d3-force` | Motion that **converges** — points drifting toward targets, pushing apart where they overlap. |
| **Twelve find the wall, one leads it** | hand-written | Motion in **3D** — a damped spring per axis plus tumbling orientation, projected through CSS `perspective` and depth-sorted. |

| File | Role |
|---|---|
| [`cluster.sim.js`](cluster.sim.js) / [`panels.sim.js`](panels.sim.js) | The **solvers**. Run once, at build time. Keep state between frames. |
| [`cluster.js`](cluster.js) / [`panels.js`](panels.js) | The **graphics**. Pure `(env) => string` — each indexes the row its solver already computed. |
| [`render-sim.ts`](render-sim.ts) | Builds `KinoProps` and calls the real `renderStills` / `renderVideo` path. |

## Render it

```bash
npx tsx examples/motion-sim/render-sim.ts             # eight stills across both solves → out/
```

```bash
SIM_VIDEO=1 npx tsx examples/motion-sim/render-sim.ts # the 9:16 mp4 → out/motion-sim-9x16.mp4
```

`out/` is gitignored.

## What it is actually showing

Tier 2 is a pure `(env) => string` re-evaluated from scratch every frame. That is what lets kino
render frames out of order, resume on any frame, and shard one build across several hosts — and it
is also a hard ceiling: a graphic whose frame N depends on having drawn frame N-1 cannot exist.

So the state moves **offline**. Read the two files side by side and the split is the whole idea:

- `cluster.sim.js` is unapologetically stateful. `nodes` is mutated in place, tick after tick; frame
  40 is where it is *because frames 0–39 happened*.
- `cluster.js` keeps nothing. It reads `env.sim.at`, this frame's row, already indexed. Ask it for
  frame 85 first and frame 0 last and it does not care.

The physics is real. It just happened before the render started.

## Notes worth stealing

**`sim.lib` is how a library reaches a solver.** A solver body runs through
`new Function("sim", src)` — no `require`, no `import` — and projects carry no `node_modules`, so a
bundled stdlib is the only route. Two are bundled: `sim.lib.force` ([d3-force](https://d3js.org/d3-force),
whose `simulation.tick()` is already this pathway's step contract — `.stop()` first, so the solver
owns the clock rather than d3's timer) and `sim.lib.matter`
([matter-js](https://brm.io/matter-js/), stepped with `sim.lib.matterStep`, which sub-steps to
matter's preferred rate). `kino bake <solver>` prints the full contract.

**Stagger with a ramp, never a gate.** The obvious way to stagger a swarm is to hold each element
inert until its moment and then switch its force on. It looks wrong, in two compounding ways: an
element with no force on it drifts at constant velocity, and constant velocity with no acceleration
reads as debris floating rather than as something with somewhere to be — it *hangs*. Then the switch
itself is a discontinuity, so a panel drifting one way gets yanked another in a single frame.

`panels.sim.js` gives every panel a weak pull from frame 0 and ramps it to full (smoothstepped) at
its own moment. The stagger survives; the hanging does not. The measure that catches this is
distance-to-target over time — it should shrink *monotonically from frame 0*, with no panel ever
increasing it. Here it runs 1076 → 844 → 507 → 251 → 101 → 32 → 8 → 0 px with zero panels ever
moving away, and arrivals still spread across frames 34–66.

**Give the shot a subject.** Twelve equal panels arriving at twelve equal slots is competent and
unstriking — the eye has nowhere to land. The hero is a composition decision expressed in the
solve: larger, nearer (it rests at z = 700, in front of the wall), latest to arrive, slowest spring,
and the only saturated thing in frame. Three signals pointing at one element; any one alone reads as
a variation rather than a subject.

Its tint is deliberately weak (16% accent). The first attempt tinted the face 38% and the hero
became a blank green card — a face tinted enough to be unmistakable is also a face nothing legible
can sit on. The identity moved to the border, the glow and a solid accent CTA instead.

**Spend the solver's state on accents, not just positions.** The row carries eight fields, and three
of them are not geometry:

| Field | Used for |
|---|---|
| `speed` | Motion blur. A panel crossing frame at 3000px/s rendered crisp reads as a slide. |
| `impact` | The **landing**. A pure graphic can see a panel is stationary but not that *this* is the frame it stopped — that needs the previous frame, which only the solver has. It emits a decaying impulse; the graphic spends it on an edge glint and a brightness lift. Twelve of those across the beat give the assembly a rhythm. |
| `hero` | Which element is the subject. |

**Do not bloom type.** A full-frame `bloom` was the first reach for "more striking" and it was wrong:
bloom cannot tell a glyph from a highlight, so it smeared a halo around every letter of the
headline, and `halation` — which gives bloom a per-channel radius so red bleeds furthest — turned
that halo *orange*. On a photographed highlight that is the effect working correctly; over synthetic
UI type it reads as a rendering fault, which is exactly how it was reported.

Isolating it took one render of the same frame with each stage removed in turn — the halo tracked
bloom exactly, and the type came back clean the moment it went. Nothing was lost, because the glow
that matters here belongs to **elements**: the hero's aura and the landing glints are box-shadows on
the panels themselves, and those survive untouched. Glow on the thing that glows; not over the frame.

`veil` stays — it is the content-responsive glare, it measures the frame rather than the glyphs, and
it lifts blacks evenly instead of ringing anything. `film` stays for grain.

**3D is not in the stdlib, and that is fine.** Both bundled libraries are 2D. `panels.sim.js` is a
hand-written 3D integrator — a damped spring per axis plus angular springs for the tumble — because
a solver is arbitrary stateful JS and a third component costs one more line per vector. Reach for
the stdlib when it fits; do not mistake it for the ceiling.

**CSS 3D is real 3D, with one hard limit and one trap.** `perspective`, `translate3d` and
`rotateX/rotateY` project properly, so the solver's z means what it says. The limit: a panel at
`translateZ(Z)` under `perspective: P` scales by `P/(P−Z)`, so `Z` approaching `P` is the eye itself
— the element explodes and vanishes. The solver's z range and the graphic's `P` are a matched pair,
and both files say so. The trap: `backface-visibility` is rejected by kino's
lint, so a tumbling panel has to gate its faces off the rotation instead.

**Gating the faces is three things, not one.** The first draft did only the obvious part — swap the
styling when `cos(rx)·cos(ry)` changes sign — and it popped: panels turned from a near-black slab to
a fully-lit card in a single frame. Fixing it properly took all three:

| | |
|---|---|
| **Two stacked faces, cross-faded** | The substitute kino's lint actually names. One element swapping its own styling can only ever switch instantly. |
| **A brightness ramp with `\|facing\|`** | The one that matters most. A surface turned edge-on catches almost no light, so the card *brightens as it opens* instead of arriving lit. |
| **A back that is a material, not a hole** | Painted near-black, every turning panel read as a hole punched in the frame — and a hole appearing is a pop no cross-fade can hide. |

Worth knowing *why* it was so visible: panels linger near edge-on for many frames rather than
sweeping through it — measured, one crosses at frames 4, 9 and 11. `t1`–`t4` in the still set are
the measured crossing frames, kept as the regression check for exactly this.

**Tuning is an authoring step, not a detail.** d3's defaults converge in a handful of ticks, and a
cluster that has finished forming by frame 14 of 90 reads as a cut rather than as motion. Weak
forces have the opposite problem — the groups never sort and the beat ends on a shrug. Both were
real first drafts of this file. The strengths that shipped were picked by *measuring* the solve
(milliseconds) instead of re-rendering guesses (half a minute each), on two numbers:

- **separation** — the gap between group centres over the spread within a group. 4.4x here, which is
  what makes three columns read as three.
- **travel per ten frames** at the start, middle and end — 94 / 12 / 2 px. Moving throughout, and
  settled by the cut.

**Reproducibility is the point of the seed.** `sim.random()` is seeded and the seed is recorded with
the bake, so this scatter is the same scatter on every machine and every re-render. Put a `seed` on
the spec's `sim` block to draw a different one deliberately. `Math.random` is rejected in a solver's
own source and redirected to the seeded stream during the solve, so a library's internals cannot
quietly make a bake unreproducible either.

**The graphic still does the parts that do not need memory.** The scale-in on each tile is a plain
function of `env.t`, and it belongs in `cluster.js` — the solver is for what needs history, not for
everything that moves.

## In a spec

The runner above builds props directly, which is what makes the wiring visible. In a real project
the same beat is four lines:

```jsonc
{
  "kind": "motion",
  "source": "motion/cluster.js",
  "dur": 3,
  "sim": { "source": "motion/cluster.sim.js" }
}
```

`frames` defaults to the beat's own length, so the bake follows real TTS instead of running out
partway through a beat that got longer. Set it only when the count is the point — a loop that has to
close on exactly N frames.
