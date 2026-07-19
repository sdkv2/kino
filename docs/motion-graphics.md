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
- [Helper classes (reveals, pulse, easing)](#helper-classes-reveals-pulse-easing)
- [Procedural graphics (Tier 2)](#procedural-graphics-tier-2)
- [Embedded Lottie (Tier 3)](#embedded-lottie-tier-3)
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
| `--kino-mint` `--kino-green` `--kino-night` `--kino-white` `--kino-gold` | brand palette |
| `--kino-font` | brand font family |
| `--kino-caption-bottom` | px from the frame bottom where kino's caption band sits (`0px` when this beat has no caption) — keep your own text clear of it, e.g. `bottom:calc(var(--kino-caption-bottom) + 24px)` |

> The gold accent **is** auto-injected as `--kino-gold` (with a legacy `--gold` alias the shipped `examples/motion-flex/*` files use). You don't need to pass it as a param.

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

## Helper classes (reveals, pulse, easing)

kino injects a small, opt-in utility kit so you don't re-derive common motion. Everything here is **frame-driven and determinism-safe** — the reveals are scrubbed `@keyframes` (no wall clock), `kino-pulse` reads the trigger envelope, and there are no transitions or external `url()`s.

**One-class reveals** — add the class to any element; it animates in over the first ~third of the beat, then holds. No `@keyframes` to author. They're part of the scrub set, so they stagger with `--kino-delay` exactly like `kino-anim`:

| Class | Effect |
|---|---|
| `kino-rise` | fade + slide up (override distance with `--kino-rise-y`, default `42px`) |
| `kino-blur-rise` | fade + de-blur + slide up (premium feel) |
| `kino-pop` | scale-up with an overshoot settle |
| `kino-wipe` | left-to-right clip reveal |

```html
<style>
  .card { font-family:var(--kino-font); color:var(--kino-white); font-size:64px; }
  .card { --kino-delay: calc((sibling-index() - 1) * .08); }  /* stagger a list */
</style>
<div class="card kino-blur-rise">Author</div>
<div class="card kino-blur-rise">the</div>
<div class="card kino-blur-rise">spec.</div>
```

**`kino-pulse`** — maps the `--pulse` envelope to an opacity + scale pop. Place spec `triggers` with `action:"pulse"` at the VO word times (from `kino inspect`) and the element punches on each word:

```html
<style>.dot { width:24vw; height:24vw; border-radius:50%; background:var(--kino-green); }</style>
<div class="dot kino-pulse"></div>
```
```jsonc
// in the spec, on this beat's motion / motionOverlay:
"triggers": [{ "at": 0.31, "action": "pulse" }, { "at": 0.92, "action": "pulse" }]
```

**`kino-fade-edges`** — a top/bottom mask gradient that feathers overflowing or scrolling content so it doesn't hard-cut at the frame edge.

**Easing tokens** — cubic-béziers matching the spec's keyframe eases, for your own `@keyframes`:

```css
.thing { animation-name:slide; animation-timing-function:var(--kino-ease-overshoot); }
/* --kino-ease-out · --kino-ease-in-out · --kino-ease-overshoot · --kino-ease-spring */
```

### Texture & finish (SVG filter library)

kino injects a small SVG filter library plus finish helpers, so you can add analog texture and depth that plain CSS can't reach. The filters are **static and seeded → identical every frame** (deterministic), and you reference them with `url(#…)` fragment ids, which the lint allows (only external/relative `url()`s are rejected).

| Class / ref | Effect |
|---|---|
| `class="kino-grain"` | full-frame film-grain overlay (`feTurbulence` noise, `overlay` blend) |
| `class="kino-vignette"` | radial edge-darkening |
| `class="kino-mesh"` | soft multi-stop palette-gradient background (mint/gold/green on night) |
| `class="kino-shadow"` | soft drop-shadow for depth |
| `filter: url(#kino-grain)` | apply grain to your own element |
| `filter: url(#kino-displace)` | organic, hand-drawn edge wobble (`feDisplacementMap`) |

```html
<div class="kino-mesh" style="position:absolute;inset:0"></div>   <!-- soft branded backdrop -->
<div class="card kino-shadow">…</div>                            <!-- lift it off the page -->
<div class="kino-vignette"></div>                                <!-- focus the centre -->
<div class="kino-grain"></div>                                   <!-- analog grain on top -->
```

Grain is subtle by design — set the element's `opacity` higher for a heavier stock. The displacement filter is great on text or shape edges for a rough, screen-printed feel: `<h1 style="filter:url(#kino-displace)">…</h1>`.

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

## Embedded Lottie (Tier 3)

When a graphic needs organic illustrated motion, complex vector morphs, or designer-crafted logo reveals that come out of After Effects — things no agent can author from scratch — point `source` at a **`.json`** Bodymovin/LottieFiles file instead of a `.html` or `.js` file. kino plays it deterministically via `@remotion/lottie` (which drives the animation off `useCurrentFrame()`, the same frame-seek discipline as the rest of the pipeline).

```json
{ "kind": "motion", "source": "motion/confetti.json", "text": "We just shipped it." }
```

Tier-3 Lottie works in **all three motion slots**: a full-screen `kind:"motion"` beat, a `motionOverlay` on an `avatar` beat, and a `motionOverlay` on an `app` beat.

### Playback

By default the animation plays **once, stretched** so its full duration spans the beat — matching the system's "everything is progress across the beat" model. Add `"loop": true` (a sibling of `source`) to loop the animation at native speed instead:

```json
{ "kind": "app", "asset": "screens/dashboard.png", "text": "...", "caption": "...",
  "motionOverlay": { "source": "motion/sparkle.json", "loop": true } }
```

### Word-fire: sync bursts to the narration

Give a Lottie graphic **`triggers`** and it switches to *fire mode*: each trigger pops a fresh one-shot of the animation at that (beat-local) time, instead of stretching one play across the beat. Build the VO, run `kino inspect` to read the per-word times, then place a trigger on each word you want to punctuate — so the Lottie moves **in time with the words**:

```json
{ "kind": "motion", "source": "motion/pop.json", "text": "Real. Time. Sync.",
  "triggers": [{ "at": 0.31, "action": "play" }, { "at": 0.92, "action": "play" }, { "at": 1.48, "action": "play" }] }
```

Each burst plays once at its native duration and unmounts, so use a **short, transparent** burst asset (~0.3–0.5s); bursts may overlap if words land closer than the burst length. Triggers take precedence over `loop`. (The `action` string is informational — every trigger fires.)

### Authoring rules

The build **rejects** assets that violate kino's determinism/safety contract:

- **Embed images** — any image assets must be base64 `data:` URIs (`e:1` in the Bodymovin JSON). External URL refs don't resolve during render.
- **Outline text to shapes or embed the font** — external/system fonts are host-dependent and rejected. Headless Chromium has no guaranteed system fonts, so text would render with an unpredictable fallback.
- **No After Effects expressions** — AE expressions (`x` fields holding JS source strings) evaluate JavaScript at render time. They're rejected as both non-deterministic and an eval surface. Re-export with expressions baked or removed.
- **Transparent background for overlays** — when used as a `motionOverlay`, the Lottie renders above the avatar/app video. An opaque full-frame solid (a common AE export default) completely occludes the presenter or screenshot. Export with a transparent background, or use the Lottie as a full-screen `kind:"motion"` beat instead.
- **Keep focal content clear of the lower-third caption band** — kino can't reflow a brought-in Lottie; captions win on z-order and sit on top, but the animation's content can sit behind them. Use `--kino-caption-bottom` guidance only for HTML/CSS Tier-1 graphics; for Lottie, design the asset with caption-safe framing.
- **3 MB cap** — the serialized JSON ships inline in Remotion's inputProps. Simplify or split animations that exceed the limit.

> `.lottie` (dotLottie binary) support and brand color-token recoloring are documented follow-ons and are not yet implemented.

### Sourcing from LottieFiles

> **Licensing** — LottieFiles templates carry the original creator's license (free-tier templates
> are typically free for personal/commercial use with restrictions that vary by creator; some
> require attribution, some are paid-tier only). Cleaning a template (removing the background layer,
> fixing the HSB artifact) does **not** change its license. Before adding a new template to the
> shared `assets-lib/lottie/` library — which ships inside the published npm package — verify the
> source template's license permits redistribution as-is. When in doubt, prefer CC0 sources or
> author the animation from scratch.

A shared library of pre-cleaned, brand-neutral animations lives in `assets-lib/lottie/` — copy a file
into a project's `assets/motion/` and reference it like any Lottie. When adapting new downloads
(download as **Lottie JSON**, not `.lottie`), templates from the LottieFiles creator
(`meta.g: @lottiefiles/creator`) are the best-behaved family: no expressions, fonts embedded as
`data:` TTFs, glyph outlines baked in `chars`, and customization slots named in layer names
(`Edit_*`, `Replace_Background`, `Logo_Here`, `Click_*`). Four gotchas found the hard way:

- **Red-text HSB artifact** — creator exports stamp every text animator with `fh:0, fs:100, fb:100`
  (fill hue/saturation/brightness). The LottieFiles player ignores the block; lottie-web honors it,
  and full saturation at hue 0 tints **all text red**. Delete `fh`/`fs`/`fb` from `t.a[].a` so the
  authored `fc` fill color renders.
- **Opaque full-frame background is near-universal** — usually a top-level layer named `Background`/
  `BG` (or an opaque card). Delete the layer to composite over kino's faceless background or use the
  asset as an overlay.
- **Text is glyph-limited** — text renders from the baked `chars` outlines, so edits are limited to
  glyphs the export already contains; missing characters fall back to the embedded font with a
  console warning. Treat template copy as fixed (or hide text layers) rather than rewriting freely.
- **Aspect** — most templates are 1920×1080 or 1080×1080; in a 9:16 frame they letterbox into a
  centered band (contain-fit). Fine for mid-frame content; check the storyboard before shipping.

To rebrand an image slot (e.g. the `Logo_Here` placeholder), replace the image asset's base64 `p`
payload with your own PNG data URI — the animation's masks and motion carry over unchanged.

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

## Shared library

Original, brand-neutral Tier 1 motion graphics ready to copy into a project's `assets/motion/` live
in [`assets-lib/motion/`](../assets-lib/motion/) — card reveals, dials, counters, a type-only reveal,
an ink-drawn illustration. All original work (unlike the Lottie library, nothing here is adapted from
a third-party template), so there's no external license to track.

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
