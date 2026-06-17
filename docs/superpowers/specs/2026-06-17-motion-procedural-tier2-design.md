# kino motion graphics (Tier 2) — procedural HTML — design

> Status: approved 2026-06-17. Builds on Tier 1 (`2026-06-16-motion-graphics-design.md`) and the
> scrubbed-`@keyframes` follow-on (`2026-06-17-motion-keyframe-scrub-design.md`), both shipped in v1.13.0.
> This is "Future phase #3" from the Tier-1 design (Tier 2 procedural `render(frame, params)` HTML).

## Goal

Let an agent generate a motion graphic's markup **procedurally in JavaScript** — loops, computed
geometry, data-driven layout — for visuals that are painful or impossible to hand-author as static
HTML/CSS (a chart with N bars, a ring of N dots, a scatter/spiral, a waveform). The generated markup
still renders deterministically through the existing Tier-1 pipeline (Shadow DOM + CSS-variable
contract + `.kino-anim` scrub).

## The contract (one sentence)

The agent authors a JS file whose body is the body of `render(env)` returning **one HTML string**;
kino evaluates it **in the browser, per frame** (the same `new Function` pattern the `custom`
background uses), injects the returned markup into the motion-graphic Shadow root, and sets the
Tier-1 CSS-variable contract on the host — so motion can come from `env` (per-frame generative) and/or
from the CSS variables the emitted markup reads.

## Scope

**In scope (Tier 2):**

- A procedural source file (`assets/motion/*.js`) referenced from the spec exactly like a Tier-1
  `.html` graphic (a `motion` beat's `source`, or a `motionOverlay.source`).
- A pure function `render(env) → string`, evaluated per frame in the Remotion (browser) render.
- An `env` carrying frame state, resolved params, the pulse envelope, the brand palette, and frame
  dimensions.
- Determinism + safety enforced by **linting the JS source** at build time, plus a runtime hardening
  (`transition:none`) so generated CSS can't animate on the wall clock.
- The emitted markup composes with the full Tier-1 surface: the CSS-variable contract
  (`--progress`/`--t`/`--frame`/`--pulse`/`--<param>` + palette), the `.kino-anim` scrub
  (`--kino-delay` stagger), and the `.kino-cliptext` helper.

**Out of scope (deferred):**

- Imperative Canvas2D art as a motion beat — the `custom` background already covers pixel drawing,
  and it's a different authoring model from kino's HTML/CSS graphics.
- Build-time "generate-once" evaluation in Node (considered and rejected — see Alternatives).
- True sandboxing of arbitrary/untrusted JS — that is Tier 3 (`<iframe srcDoc sandbox>`). Tier 2's
  trust model matches the `custom` background: agent-authored, trusted, but browser-side.
- Passing arrays/objects as spec `params` — `params` stay scalar (`number | string`); structured data
  lives inside the `.js` file (which is code the agent already authors per-graphic).
- JS animation engines (anime.js/GSAP `.seek()`), Lottie, WebGL/3D — later phases.

## Authoring model & the `env` contract

`assets/motion/x.js` is the **body** of `render(env)`; it must `return` an HTML string (markup, and
optionally one inline `<style>`). Example — a data-driven bar chart that grows on `--progress` and
staggers via `--kino-delay`:

```js
// assets/motion/bars.js
const data = [40, 75, 55, 90];                 // structured data lives in the file; params stay scalar
return `<style>
  .bar{position:absolute;bottom:10%;width:8%;background:var(--kino-mint);border-radius:6px;
       transform-origin:bottom;transform:scaleY(var(--progress))}
</style>` +
  data.map((h, i) =>
    `<div class="bar kino-anim" style="left:${8 + i * 22}%;height:${h}%;--kino-delay:${i * 0.08}"></div>`
  ).join("");
```

`env` (browser, recomputed every frame):

| Field | Type | Meaning |
|---|---|---|
| `frame` | number | integer frame within the beat |
| `t` | number | seconds within the beat |
| `progress` | number | `0 → 1` across the beat |
| `pulse` | number | `0 → 1` trigger envelope (`pulseAt`) |
| `params` | `Record<string, number\|string>` | resolved spec params at this frame (`paramsAt`) |
| `palette` | `{ mint, green, night, white, gold, font }` | brand palette + font family |
| `width`, `height` | number | canvas dimensions (1080 × 1920 for 9:16) |

The function returns one HTML string. Because the host still carries the CSS-variable contract and the
scrub stylesheet is still injected, the emitted markup may use `var(--progress)` etc., `class="kino-anim"`,
and `class="kino-cliptext"` — the agent chooses per-element between computing motion in JS (`env.frame`)
and declaring it in CSS.

## Spec schema & wiring

No new spec surface. A `motion` beat (or `motionOverlay`) whose `source` ends in `.js` is procedural;
`.html` stays Tier 1. `params`/`keyframes`/`triggers` are identical.

```json
{ "kind": "motion", "source": "motion/bars.js", "text": "Four metrics, one trend.",
  "params": { "highlight": 2 } }
```

## Architecture / render path

- **`src/render/motiongraphic.ts`** — `resolveMotionGraphic` branches on the `source` extension:
  - `.html` → today's path (read → `lintMotionHtml` → `sanitizeMotionHtml` → `{ html, ... }`).
  - `.js` → read → **`lintMotionJs`** (new) → bake `{ html: "", proc: <source>, params, keyframes, triggers }`.
    The JS source is **not** DOMPurified (it's code, not markup); its *output* is trusted like the
    `custom` background's drawing (browser-side, deterministic). Markup safety relies on the source lint
    + the headless render context (no network/exfil; `<script>` inserted via `innerHTML` does not execute).
- **`src/render/props.ts`** — `MotionGraphicProps` gains `proc?: string` (the linted JS source). `html`
  stays required (`""` for procedural graphics).
- **`src/render/remotion/MotionGraphic.tsx`** —
  - If `data.proc`: memoize `fn = new Function("env", data.proc)` on `[data.proc]`. Each frame, build
    `env`, call `fn(env)` inside a `try/catch`, and set
    `shadowRef.current.innerHTML = KINO_SCRUB_STYLE + (result ?? "")`. A throw sets empty markup and
    logs once (the render continues, producing a blank — not a crash).
  - Else: today's static-`html` path.
  - The host CSS-variable effect is unchanged and runs for both paths.

## Determinism & security

- **Source lint — `lintMotionJs`** (build-time, a JS-oriented denylist; mirrors the spirit of the
  Tier-1 `BANNED` list). Reject: `Date.now`, `new Date`, `Math.random`, `performance.now`,
  `requestAnimationFrame`, `setTimeout`/`setInterval`, `fetch`/`XMLHttpRequest`, `import`/`require`,
  `process`, `globalThis`/`window`/`document`, inline `on\w+=` event-attribute emission. Allow ordinary
  JS + `Math.*` (geometry). Goal: the function is a pure `(env) → string`.
- **Runtime hardening** — extend `KINO_SCRUB_STYLE` with `*{transition:none !important}`. Generated
  markup can't be DOMPurified/linted per frame, so a stray CSS `transition` in the output would
  otherwise animate on the wall clock (non-deterministic). Globally killing transitions closes that
  hole and also hardens Tier 1 (where `transition` is already lint-banned — now belt-and-suspenders).
  Animations remain force-paused + `--progress`-scrubbed.
- **Trust model** — identical to the `custom` background (`new Function` of agent-authored JS), but the
  eval happens **in the browser render context**, which has no Node `process`/`fs`/env. So Tier 2 JS
  *cannot* read API keys or the filesystem, even though it is "trusted." True isolation of untrusted JS
  remains Tier 3.
- **Pure-function discipline** — `render` receives everything via `env` and returns a string; it must
  not touch the DOM directly (the lint discourages `document`/`window`). Same `(frame, params) → output`
  determinism guarantee as every other kino visual.

## Agent authoring experience

- `kino motion` gains a short "Procedural graphics (`.js`)" section: the `render(env)` contract, the
  `env` table, the bar-chart example, and the rule that the source is determinism-linted.
- `skills/video-production/SKILL.md` motion bullet notes the `.js` option.
- `docs/motion-graphics.md` gains a "Procedural (Tier 2)" section.
- Preview is unchanged: `kino still`/`storyboard`/`build` render procedural beats like any other.

## Testing

- **Unit (`tests/motiongraphic.test.ts`):**
  - `lintMotionJs` passes a clean `return \`...\`` body; rejects `Math.random()`, `Date.now()`,
    `fetch(`, `setTimeout(`, `require(`, `process.env`.
  - `resolveMotionGraphic` routes a `.js` source to `{ proc, html: "" }` and an `.html` source to the
    existing `{ html }` shape; a lint violation in a `.js` throws naming the file.
- **Render (`tests/render-motion.test.ts`):**
  - A procedural graphic returning a full-frame block whose colour is driven by `env.progress` (or a
    bar with `transform:scaleY(var(--progress))`) → centre-pixel **advances** between an early and late
    frame, and is **identical** when the same frame is rendered twice (deterministic).
  - A per-frame formula graphic (position computed from `env.frame`) renders without crashing.
  - An error-throwing source renders a blank frame (no crash).
  - A determinism check that a generated `transition` does **not** animate (the `transition:none`
    hardening) — same-frame-twice identical even with a transition in the output.

## Alternatives considered

- **Build-time "generate-once" (Node eval).** Run `render(params)` once at build, bake static markup,
  animate purely via Tier-1 CSS vars/scrub. Simpler (reuses Tier-1 rendering verbatim, no per-frame
  cost) and trivially deterministic, **but**: (a) can't express per-frame generative *motion* (only
  static generative layout); (b) runs agent JS in the Node build process *next to `process.env` API
  keys*, requiring a `vm` sandbox to be safe. Rejected in favour of the browser-side per-frame eval,
  which is safer (no Node globals), matches the design doc's `render(frame, params)`, reuses the proven
  `custom`-background machinery, and subsumes generate-once (a function that ignores `frame` is static).
- **Canvas2D draw fn as a motion beat.** Maximal reuse of the `custom`-background machinery, but
  imperative pixels are a different mental model and `custom` backgrounds already provide it. Out of scope.

## Open items

- `new Function` is invoked once per `MotionGraphic` instance (memoized on `proc`); the per-frame cost
  is the `fn(env)` call + one `innerHTML` assignment — acceptable (the `custom` background redraws per
  frame similarly). No streaming/diffing optimization in v1.
- If a procedural graphic wants structured data from the spec rather than hard-coded in the file, that
  is a future `params`-as-JSON extension; deliberately deferred.

## Relationship to the tiers

Tier 1 = static HTML + CSS-var contract + scrub (shipped). **Tier 2 = this** (procedural HTML via
browser `new Function`, trusted + linted). Tier 3 = `<iframe srcDoc sandbox>` isolation for *untrusted*
code and JS animation engines (future).
