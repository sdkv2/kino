# Motion graphics

Motion graphics let an agent author a **self-contained HTML/CSS file** whose animation is driven entirely by **kino-set CSS custom properties**. kino renders it deterministically in headless Chromium (via Remotion), mounted in a sandboxed Shadow DOM. The JSON spec owns the clock; your HTML is a stateless canvas that reads variables and paints the current frame.

Run `kino motion` for the same contract inline.

- [Why it's shaped this way](#why-its-shaped-this-way)
- [The CSS-variable contract](#the-css-variable-contract)
- [Driving it from the spec](#driving-it-from-the-spec)
- [A first example](#a-first-example)
- [Scrubbed @keyframes](#scrubbed-keyframes)
- [Staggering reveals](#staggering-reveals)
- [Gradient-clipped text (`kino-cliptext`)](#gradient-clipped-text-kino-cliptext)
- [Procedural graphics (Tier 2)](#procedural-graphics-tier-2)
- [Determinism & safety (the lint)](#determinism--safety-the-lint)
- [Authoring tips](#authoring-tips)
- [Worked examples](#worked-examples)

## Why it's shaped this way

Remotion renders by seeking to frame *N* and screenshotting. There is no real timeline running — so anything that animates on the **wall clock** (raw CSS `transition`, unscrubbed `@keyframes`, `requestAnimationFrame`, `Date.now()`) renders to a frozen or non-deterministic frame. kino's contract makes motion a pure function of frame state:

- **JSON owns the clock** — `params`, `keyframes`, and `triggers` in the spec.
- **HTML is a stateless canvas** — one markup file + one inline `<style>`, reading the variables kino sets every frame.

At build time the file is **lint-checked** (determinism + safety) and **sanitized** (DOMPurify), then mounted in a **Shadow DOM** so its styles never leak into the composition.

## The CSS-variable contract

kino sets these custom properties on the graphic's host **every frame**. Read them with `var(...)` and combine in `calc()` (and `sin()`/`clamp()`/`round()` — all CSS math is fair game).

| Variable | Value |
|---|---|
| `--frame` | integer frame within the beat |
| `--t` | seconds within the beat |
| `--progress` | `0 → 1` across the beat (use for entrances/reveals) |
| `--pulse` | `0 → 1` envelope fired by spec triggers (`{ at, action: "pulse" }`) |
| `--<param>` | every key in the spec's `params`, tweened by `keyframes` (e.g. `--pct`) |
| `--kino-mint` `--kino-green` `--kino-night` `--kino-white` | brand palette |
| `--kino-font` | brand font family |

> The gold accent is **not** auto-injected — pass it as a param if you need it (`"params": { "gold": "#d99a20" }` → `var(--gold)`).

## Driving it from the spec

Reference the file two ways (see [Spec reference](spec-reference.md)):

- **Full-screen beat** — `{ "kind": "motion", "source": "motion/x.html", "text": "spoken VO" }`
- **Overlay** on an avatar/app beat — `"motionOverlay": { "source": "motion/x.html" }`

Both carry the timing controls:

```json
{
  "source": "motion/stat.html",
  "params":   { "pct": 0 },
  "keyframes": [{ "at": 0.2, "params": { "pct": 86 }, "ease": "easeInOut" }],
  "triggers":  [{ "at": 0.2, "action": "pulse" }]
}
```

`ease` ∈ `linear | easeInOut | overshoot | spring`. Each param surfaces as `--<key>`; a `pulse` trigger surfaces as a decaying `--pulse` envelope. Sync `at` times to the voiceover with `kino inspect`.

## A first example

A bar that grows to `--pct` and a title that rises in on `--progress`:

```html
<style>
  .bar   { position:absolute; left:8%; bottom:30%; height:48px;
           width:calc(var(--pct) * 1%); background:var(--kino-mint); border-radius:8px; }
  .title { position:absolute; left:8%; bottom:38%; font-family:var(--kino-font);
           color:var(--kino-white); font-weight:900; font-size:64px;
           opacity:var(--progress);
           transform:translateY(calc((1 - var(--progress)) * 40px)); }
</style>
<div class="title">86% match</div><div class="bar"></div>
```

```json
"params": { "pct": 0 },
"keyframes": [{ "at": 0.2, "params": { "pct": 86 }, "ease": "overshoot" }]
```

## Scrubbed @keyframes

You can use **real CSS `@keyframes`** — kino force-pauses every animation (`*{animation-play-state:paused}`) and **scrubs** elements marked `class="kino-anim"` across the beat by driving a `--progress`-based negative `animation-delay`. The animation plays `0 → 100%` across the whole beat, so put sub-timing in the `%` stops.

```html
<style>
  @keyframes pop {
    0%   { transform:scale(.6); opacity:0 }
    60%  { transform:scale(1.06) }
    100% { transform:scale(1); opacity:1 }
  }
  .badge { animation-name:pop }   /* duration/iteration are managed by kino */
</style>
<div class="badge kino-anim">NEW</div>
```

- Sub-timing lives in the `%` stops; easing is your `animation-timing-function`.
- **Don't** set `animation-play-state` yourself — kino manages the pause (it's lint-rejected).
- Stagger with `--kino-delay` (see below).

## Staggering reveals

Don't let everything land at once. Three idioms:

```css
/* 1. Auto-stagger a whole list with sibling-index() — one rule, no extra params */
.item { --d: calc((sibling-index() - 1) * .08);
        opacity: clamp(0, calc((var(--progress) - .2 - var(--d)) * 8), 1); }

/* 2. Give each element its own slice of --progress */
.a { opacity: clamp(0, calc(var(--progress) * 10), 1); }
.b { opacity: clamp(0, calc((var(--progress) - .12) * 10), 1); }

/* 3. Stagger scrubbed @keyframes with --kino-delay (pairs with sibling-index) */
.kw { animation-name:rise; --kino-delay: calc((sibling-index() - 1) * .1); }
```

For per-element spring/overshoot, expose a param per element (`--w1`, `--w2`, …) and offset the keyframe `at` times.

## Gradient-clipped text (`kino-cliptext`)

Gradient-filled text via `background-clip:text` only paints the gradient over the element's **content box** — so glyph ink that **tight/negative `letter-spacing`** pushes past that box renders **transparent**, and the last glyph's edge looks sliced. Add `class="kino-cliptext"` to fix it: kino injects a helper that widens the paint box with inline padding, cancelled by an equal negative margin so layout/centering is unchanged.

```html
<style>
  .big { background-image:linear-gradient(var(--kino-mint), var(--kino-white));
         -webkit-background-clip:text; background-clip:text; color:transparent;
         letter-spacing:-.04em; }
</style>
<div class="big kino-cliptext">98%</div>
```

It's opt-in by design: a CSS selector can't match *computed* `background-clip`, and blanket padding would break `margin:auto` centering and tight letter-spaced runs. (Also: set the gradient with `background-image`, not the `background` shorthand — the shorthand resets `background-clip`.)

## Procedural graphics (Tier 2)

When a graphic needs loops or computed geometry (a chart of N bars, a ring of N dots, a scatter), point
`source` at a **`.js`** file instead of `.html`. Its body is the body of `render(env)` and must **return
an HTML string**; kino evaluates it in the browser **every frame** and injects the result into the same
Shadow DOM, so the returned markup can still use the CSS-variable contract, `.kino-anim`, and
`.kino-cliptext`.

```js
// assets/motion/bars.js  — body of render(env) → returns HTML
const data = [40, 75, 55, 90];                 // structured data lives in the file; params stay scalar
return data.map((h, i) =>
  `<div class="bar kino-anim" style="left:${8 + i * 22}%;height:${h}%;--kino-delay:${i * 0.08}"></div>`
).join("") +
`<style>.bar{position:absolute;bottom:10%;width:8%;background:var(--kino-mint);
  transform-origin:bottom;transform:scaleY(var(--progress))}</style>`;
```

`env = { frame, t, progress, pulse, params, palette:{mint,green,night,white,gold,font}, width, height }`.

It runs in the browser render (no Node `process`/`fs`/env reachable) and must be a **pure `(env) → string`**:
the build lints the source and rejects `Date.now`/`Math.random`/timers/`fetch`/`import`/`require`/`process`
and direct `document`/`window` access. Reference it from the spec exactly like a `.html` graphic.

## Determinism & safety (the lint)

The build **rejects** a graphic that contains any of the following (each error tells you what to do instead), from [`src/render/motiongraphic.ts`](../src/render/motiongraphic.ts):

| Rejected | Why / instead |
|---|---|
| `<script>` | Motion comes from CSS variables, not JS. |
| inline `on*=` handlers | No event handlers. |
| CSS `transition` (and `transition-*`) | Non-deterministic — drive motion from `var(--progress)`. |
| `animation-play-state` | Managed by kino — use `class="kino-anim"`; don't override the pause. |
| SVG SMIL (`<animate>`, `<animateTransform>`, `<animateMotion>`, `<set>`) | Drive motion from `var(--progress)`. |
| `requestAnimationFrame` / `setInterval` / `setTimeout` | Timers/RAF aren't frame-driven. |
| `Date.now` / `Math.random` | Break determinism. |
| `fetch(` / `XMLHttpRequest` | No network during render. |
| `url(...)` to anything but `data:` or `#fragment` | External/relative refs don't resolve — inline assets as data: URIs. |
| `@import` | Bundle all styles inline. |

**Allowed:** `@keyframes` and the `animation-*` longhands (except `animation-play-state`), all CSS custom properties + `calc()`/`sin()`/`clamp()`/`round()`/`counter()`, `sibling-index()`, `data:` URIs, and `#fragment` `url()`. After linting, the HTML is sanitized with DOMPurify (keeps your `<style>` + structural markup; strips `script`/`iframe`/`object`/`embed`/`link`/`meta`/`base`).

## Authoring tips

- **Use `vw` units for resolution independence.** The render canvas is 1080px wide, so `1vw = 10.8px`; sizing everything in `vw` makes the graphic render pixel-identical in the video *and* scale cleanly when the raw file is previewed at any width (a fixed-px graphic overflows a narrow preview pane).
- **Prefer `easeInOut`** (or a smoothstep ramp) over `spring` for calm, premium motion; let entrances last ~1s and add slow continuous life off `--t` (e.g. `transform:rotate(calc(var(--t) * 20deg))`).
- **Inline images as `data:` URIs** — external/relative `url()` won't resolve in the render.
- **Sync to the voiceover** — read per-word start/end with `kino inspect` and place your keyframe `at` times on the words.

## Worked examples

[`examples/motion-flex/`](../examples/motion-flex/) is a full showcase rendered through kino's real pipeline:

- `hero.html` — a kinetic title (blur-rise headline via scrubbed `@keyframes`, gradient shimmer).
- `stat.html` — a count-up stat (pure-CSS `counter` driven by `--pct`, staggered keywords, `kino-cliptext`).
- `orbit.html` — an orbiting particle system with a popping wordmark.

Render them:

```bash
npx tsx examples/motion-flex/render-flex.ts            # verification stills → examples/motion-flex/out/
FLEX_VIDEO=1 npx tsx examples/motion-flex/render-flex.ts # the full mp4
```

See also: [Spec reference](spec-reference.md) · [CLI reference](cli-reference.md) · [Backgrounds & overlays](backgrounds-and-overlays.md).
