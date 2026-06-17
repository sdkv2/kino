# kino motion graphics — research findings

**Date:** 2026-06-16
**Status:** research complete → feeding into design
**Topic:** Letting agents implement clean motion graphics via established web graphics
libraries, authored as HTML/CSS/JS but **controlled by the JSON spec**, baked into kino videos.

> This is a **research note**, not the design. It captures the library landscape and the
> architectural constraints discovered, so the design + implementation plan can be written against
> verified ground. Decisions taken from this research: **scope the first build to Tier 1 (static
> HTML + CSS-variable binding) + `@remotion/lottie`.**

## The question

kino currently hand-rolls *all* motion on Remotion primitives (`interpolate`, `spring`, `Easing`)
plus Canvas2D `draw(ctx, env)` background functions. The goal: let driving agents produce richer,
cleaner motion graphics (kinetic typography, data viz, vector/character animation, particles/3D)
by leaning on existing web libraries — while agents author the *content* in HTML/CSS/JS (which they
are fluent in) and the **JSON spec owns timing, parameters, and triggers**.

## The single constraint that shapes everything

kino renders **React + Remotion in headless Chromium, frame-by-frame, deterministically**. Remotion
works by *seeking to frame N and screenshotting it*. Therefore:

> **`useCurrentFrame()` is the only legal clock.** Anything driven by wall-clock — CSS `transition`,
> self-cycling `@keyframes`, `requestAnimationFrame`, `setInterval`, `Date.now()`, `Math.random()`,
> or any library's internal RAF loop — does **not** advance between captured frames and renders
> frozen or flickering.

This is not a limitation to work around; it is the architecture. It forces exactly the split the
team wants: **JSON owns the clock; the agent's HTML/CSS is a stateless canvas that only reads
per-frame variables kino computes.** This is the same model used by HTML-to-video systems built for
agents (HyperFrames, Editframe), and it is a near-drop-in generalization of kino's *existing*
`custom` background pattern (`new Function("ctx","env",code)` run per-frame against `env.frame` +
`paramsAt()` keyframes — see `src/render/bgparams.ts`, `src/render/remotion/backgrounds/`).

Sources: [animating-properties](https://www.remotion.dev/docs/animating-properties),
[flickering](https://www.remotion.dev/docs/flickering),
[random](https://www.remotion.dev/docs/random).

## The CSS-animation determinism fix (canonical)

There is exactly one Remotion-blessed way to make author-written CSS animation deterministic
(from Remotion's own [`css-animation-play-state`](https://github.com/remotion-dev/css-animation-play-state)
example, referenced from [third-party](https://www.remotion.dev/docs/third-party)):

```css
.box { animation: scale 1s ease-in-out; animation-play-state: paused; }
```
```ts
const progress = interpolate(frame, [0, fps * DUR], [0, 1], { extrapolateRight: 'clamp' });
// applied per frame by kino:
animationDelay: `${progress * -DUR}s`   // negative delay = seek into the paused animation
```

`animation-play-state: paused` stops the clock; a **negative `animation-delay`** scrubs to an exact
pose; kino drives that delay from the frame. Agents can write normal `@keyframes`; kino owns the
playhead.

- **CSS `transition` has no equivalent escape hatch → it must be banned in agent output.**
- The cleaner default is agents writing values against kino-set CSS variables, e.g.
  `transform: translateY(calc(var(--progress) * -40px))` — no `@keyframes` self-cycling at all.

## Library scorecard (only what survives a headless render)

| Motion type | ✅ Adopt | ⚠️ Risky / conditional | ❌ Avoid |
|---|---|---|---|
| **Kinetic typography** | Remotion native `interpolate`/`spring` + **`@remotion/animation-utils`** (`interpolateStyles`, MIT) | **GSAP** & **anime.js v4** only via `{paused:true}` + `.seek(frame/fps)` (GSAP now free; anime is MIT/lighter, seeks in **ms**) | **Framer Motion** `<motion.>`, **Theatre.js** (0.x, stalled, AGPL studio) |
| **Data-driven** (counters, charts, stats) | Hand-rolled: **D3 as math kernel only** (`d3-scale`/`d3-shape`, ISC) + frame-driven `spring()` — Remotion's *own* official chart pattern | **visx** / **Recharts** with all internal animation disabled — only for complex chart types | **react-spring** (RAF), **@number-flow** *as animator* (WAAPI clock; `Intl.NumberFormat` covers formatting), **`d3-transition`** |
| **Vector & character** | **`@remotion/lottie`** — frame-driven by absolute `goToAndStop`, auto-handles async load + embedded images. Agents **consume + parametrize**, not author from scratch | **dotLottie** only if the container is needed (no official Remotion pkg) | **Rive** — state-machine characters **unsupported in Remotion & not on roadmap**; runtime fetches WASM from CDN mid-render |
| **Particles / 3D / shaders** | **Full-screen GLSL** (`uTime = frame/fps`) + **Canvas2D** (`pos(frame, seed)`) — mirrors kino's existing `draw(ctx,env)` pattern | **`@remotion/three`** + r3f only for genuine 3D (needs `--gl` backend; `angle` has memory-leak-on-long-renders caveat; ban `useFrame()`) | **tsParticles**, **PixiJS**, **regl**, **OGL** — no Remotion binding, RAF-based or pre-1.0/stale |

**Headless-render reality:** plain DOM, CSS, and Canvas2D render fine in kino's current default
Chromium (SwAngle, GPU off) — the background system already proves it, **no new flags needed**. Only
WebGL/Three would require a `--gl` flag + leak mitigation. So typography, data viz, generative
backgrounds, and Lottie carry **zero** new GPU-config risk; 3D is the only capability that does.

### Per-library determinism notes (binding contracts)

- **`@remotion/animation-utils`** — `interpolateStyles(frame, [...], [styleA, styleB])` returns a
  `CSSProperties` object driven by `useCurrentFrame()`. Best fit for "JSON keyframes → CSS style
  object." ([docs](https://www.remotion.dev/docs/animation-utils/))
- **GSAP / anime.js v4** — safe *only* as `gsap.timeline({paused:true})` / `createTimeline({autoplay:false})`
  then `.seek(frame/fps)` each render. Never `.play()`. No ScrollTrigger/scroll plugins (RAF-driven).
  anime seeks in **ms** (`frame/fps*1000`); GSAP in **seconds**.
- **`@remotion/lottie`** — reads `useCurrentFrame()`, calls `goToAndStop(frame, true)`. Auto-`delayRender`
  on load, awaits embedded images. **Kill expressions** (non-deterministic), **embed fonts**, keep
  asset refs **offline** (`staticFile`). Agents realistically **consume + parametrize** (color/text/
  timing/segments), not hand-author rich Lottie JSON. ([docs](https://www.remotion.dev/docs/lottie/))
- **Counters/charts** — Remotion's own pattern: compute geometry with D3 math (or inline), animate the
  *reveal* with `interpolate`/`spring` keyed on frame; disable every library's own animation
  (`isAnimationActive={false}`). For digit-roll, per-digit vertical offset from `interpolate` +
  `Intl.NumberFormat` — no extra dependency. ([d3-example](https://github.com/remotion-dev/d3-example))
- **GLSL/Three** — shader: `uTime = frame/fps` uniform, pure function. r3f: `<ThreeCanvas>` sets
  `frameloop:'never'`, compute transforms from `useCurrentFrame()`, **never `useFrame()`**, call
  `advance()` after async loads, pick a `--gl` backend (`angle` desktop / `angle-egl` cloud-GPU /
  `swangle` no-GPU), segment long renders to dodge `angle` leaks.
  ([three-canvas](https://www.remotion.dev/docs/three-canvas), [gl-options](https://www.remotion.dev/docs/gl-options))

## Recommended architecture (converged across all five research axes)

A `motionGraphic` block in the spec, rendered by a kino-owned `MotionGraphic` React component that —
**per frame** — resolves JSON keyframes via the *existing* `paramsAt()`, sets `--frame` / `--t` /
`--progress` / `--<param>` as CSS variables on a root element, injects the agent's sanitized HTML,
and force-pauses any self-driving animation. **Three authoring tiers, one controller:**

1. **Tier 1 — static HTML/CSS reading kino's CSS variables** *(default; most HTML-native)*. No JS,
   no animation API for the agent to hallucinate. Most output should live here.
2. **Tier 2 — `render(frame, params)` JS via `new Function`** *(procedural)*. Reuses kino's existing
   custom-background machinery, for loops/generative layout.
3. **Tier 3 — `<iframe srcDoc sandbox="allow-scripts">`** *(isolation fallback)* for hostile/heavy CSS,
   at the cost of per-frame `srcDoc` rewrites (the iframe can't call `useCurrentFrame()`).

**JSON → HTML binding (the controller).** kino sets CSS custom properties on the agent's root each
frame; the agent's CSS reads them via `var()`/`calc()`. Custom properties inherit across a Shadow DOM
boundary, so Tier 1 wraps the fragment in a Shadow root for style isolation without iframe reload
cost. ([MDN custom properties](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_cascading_variables/Using_CSS_custom_properties),
[MDN @property](https://developer.mozilla.org/en-US/docs/Web/CSS/@property))

**Security posture** (agent output is less trusted than brand config):

- **DOMPurify** with a locked tag/attribute allowlist on every markup path. ([cure53/DOMPurify](https://github.com/cure53/DOMPurify))
- **No network egress** during render — closes exfiltration, the only serious local-render vector.
- **Static-lint denylist** of non-deterministic/dangerous APIs (`transition`, `requestAnimationFrame`,
  `setInterval/Timeout`, `Date.now`, `Math.random`, `fetch`, `eval`, …) — doubles as the determinism guard.
- Tier 3: `sandbox="allow-scripts"` **without** `allow-same-origin` + restrictive CSP.
- `delayRender`'s 30s timeout is the hang backstop.

This is a generalization of the pattern already shipping in `components.tsx` /
`CanvasBackground.tsx` / `bgparams.ts` (per-frame pure function, JSON keyframes via `paramsAt`,
sync pre-paint capture) — emitting DOM/CSS variables instead of Canvas2D paints.

## Open items to resolve in design / a spike

1. **Remotion licensing** — free for individuals/small teams, **paid Company License at scale**. The
   one non-open-source dependency; confirm against kino's commercial setup.
2. **Spike (≈30 min) before relying on them:** (a) GSAP/anime `.seek()` applies *synchronously* inside
   headless Chromium before capture; (b) Tier 3 per-frame `srcDoc` iframe approach. (Tier 1 + Lottie,
   the chosen first scope, do **not** depend on either — both are documented/proven.)
3. **`@remotion/rive` pins an old runtime** (2.31.5) and abandoned state-machine support — Rive stays
   out of scope.

## Decision for the first build

- **Scope:** Tier 1 (static HTML + CSS-variable binding) **+ `@remotion/lottie`** (consume + parametrize).
- **Out of scope for v1:** Tier 2 (`new Function` HTML), Tier 3 (iframe), GSAP/anime engines, Three/WebGL,
  Rive. These are documented here so later phases extend rather than rediscover.
- Rationale: smallest slice that proves the *agents-write-HTML-controlled-by-JSON* loop end-to-end,
  covers kinetic typography + data viz + designer vector assets, and adds **no headless-GPU risk**.

---

*Sources are linked inline. Full per-axis briefs (animation engines, vector/character, data-driven,
particles/3D, HTML-injection/security) were produced by parallel research agents on 2026-06-16 and
condensed here.*
