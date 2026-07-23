# Motion graphics

Motion graphics let an agent author a **self-contained HTML/CSS file** whose animation is driven entirely by **kino-set CSS custom properties**. kino renders it deterministically in headless Chromium, mounted in a sandboxed Shadow DOM. The JSON spec owns the clock; your HTML is a stateless canvas that reads variables and paints the current frame.

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

kino renders by seeking to frame *N* and screenshotting. There is no real timeline running — so anything that animates on the **wall clock** (raw CSS `transition`, unscrubbed `@keyframes`, `requestAnimationFrame`, `Date.now()`) renders to a frozen or non-deterministic frame. kino's contract makes motion a pure function of frame state:

- **JSON owns the clock** — `params`, `keyframes`, and `triggers` in the spec.
- **HTML is a stateless canvas** — one markup file + one inline `<style>`, reading the variables kino sets every frame.

At build time the file is **lint-checked** (determinism + safety) and **sanitized** (DOMPurify), then mounted in a **Shadow DOM** so its styles never leak into the composition.

## The CSS-variable contract

kino sets these custom properties on the graphic's host **every frame**. Read them with `var(...)` and combine in `calc()` (and `sin()`/`clamp()`/`round()` — all CSS math is fair game).

| Variable | Value |
|---|---|
| `--frame` | integer frame within the beat |
| `--t` | seconds within the beat — **use for real-time clocks** (scrubbers, elapsed timers); ticks 1:1 with render time |
| `--progress` | `0 → 1` across the beat (linear — prefer eased vars below for entrances; **not** for playback clocks) |
| `--kino-in` | ease-in cubic of `--progress` (slow start) |
| `--kino-out` | ease-out cubic of `--progress` (soft landings) |
| `--kino-inout` | smoothstep of `--progress` |
| `--kino-overshoot` | back-out of `--progress` (may briefly exceed `1` — great for `scale`) |
| `--kino-spring` | elastic-out of `--progress` (may briefly exceed `1`) |
| `--kino-edge` | `sin(progress·π)` — `0` at beat start/end, `1` mid (seam-safe wash/breath) |
| `--pulse` | `0 → 1` envelope fired by spec triggers (`{ at, action: "pulse" }`) — fast attack (~45ms) then exponential decay |
| `--<param>` | every key in the spec's `params`, tweened by `keyframes` (e.g. `--pct`) |
| `--kino-mint` `--kino-green` `--kino-night` `--kino-white` `--kino-gold` | brand palette |
| `--kino-font` | brand font family |
| `--kino-label-font` | brand `labelFont` (falls back to `--kino-font`) |
| `--kino-caption-bottom` | px from the frame bottom where kino's caption band sits (`0px` when this beat has no caption) — keep your own text clear of it, e.g. `bottom:calc(var(--kino-caption-bottom) + 24px)` |
| `--kino-words-shown` | **continuous** count of the beat's spoken words shown at this frame — each word contributes its elapsed fraction (0→1 across its spoken span), reaching exactly *k* when word *k* finishes. Gated reveals like `clamp(0, calc(var(--kino-words-shown) - i), 1)` ease through the word instead of stepping at its start |
| `--kino-word-count` | total spoken words in this beat |

> The gold accent **is** auto-injected as `--kino-gold`. You don't need to pass it as a param.

### Typed-in-sync text (the caption engine can't style; this can)

kino computes the beat's per-word VO timings and hands them to the motion graphic, so a **stylised**
surface (terminal, code editor, chat bubble, monospace prompt with a block caret — anything the caption
presets can't express) can type text locked to the speech, with zero drift.

Agent playbooks: recipes (caption-free montage, spoof chat window, camera-follows-typing) →
**`skills/speech-synced-ui/SKILL.md`**; look/composition/anti-generic craft →
**`skills/motion-design/SKILL.md`**.

- **CSS-only (word grain)** — reveal per-word by comparing each word's index to `--kino-words-shown`. Word `i` (0-based):
  `opacity: clamp(0, calc(var(--kino-words-shown) - <i>), 1)`. The var is continuous, so each word
  eases in across its spoken span (no step-lag). Fine for chips and gated lines; for a "being typed"
  feel prefer the JS burst typewriter below.
- **JS `render(env)`** — `env.words` is the beat's `{ word, start, end }[]` (times are **beat-relative** seconds,
  matching `env.t`). Prefer a **burst typewriter** (chars land ~45ms apart at the front of each word span, then hold)
  over joining whole words at `start <= t` (word blocks) or metering evenly across the whole span (metronome feel):

  ```js
  var KEY = 0.045, words = env.words || [], out = "", typing = false;
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    if (env.t < w.start) break;
    var n = Math.min(w.word.length, Math.floor((env.t - w.start) / KEY) + 1);
    out += w.word.slice(0, n) + (i < words.length - 1 ? " " : "");
    typing = n < w.word.length;
  }
  var caretOn = typing || Math.floor(env.frame / 15) % 2 === 0;
  return '<span style="font-family:var(--kino-label-font);color:var(--kino-night)">' + out +
    '<b style="opacity:' + (caretOn ? 1 : 0) + '">█</b></span>';
  ```

  Works in a full-screen `kind:"motion"` beat **and** as a `motionOverlay` on an `app`/`avatar` beat (the
  overlay gets its host beat's words).

### Camera zoom / pan inside a motion graphic

Motion beats/overlays do **not** read `zoomKeyframes` (that track is for `app` footage + frame chrome).
Drive a wrapper with CSS:

```css
.cam {
  transform: scale(calc(1 + 0.08 * var(--progress)))
             translateY(calc(-2% * var(--progress)));
  transform-origin: 50% 46%;
}
```

Or set a custom `--typed` / `--cam` from JS (typed-char fraction) or a keyframed `params` value for eased holds.
**If typed text is a `motionOverlay` on a static PNG window**, zooming the overlay alone desyncs text from
chrome — draw chrome + text in **one** motion graphic and transform that unit.

### Overlay + host fade

Overlays paint at full opacity from frame 0. If the host `app`/`frame` fades in (default transition),
typed text can float over the blurred ground. Use `"transition": "cut"` on that beat, or fade the overlay
with the same envelope.

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

`ease` ∈ `linear | easeIn | easeOut | easeInOut | easeInQuad | easeOutQuad | easeInOutQuad | easeInCubic | easeOutCubic | easeInOutCubic | easeInQuart | easeOutQuart | easeInOutQuart | easeInExpo | easeOutExpo | easeInOutExpo | overshoot | spring`. Each param surfaces as `--<key>`; a `pulse` trigger surfaces as a decaying `--pulse` envelope.

**Anchor to spoken words, not seconds.** Every motion keyframe/trigger accepts `atWord` in place of
`at`: a word (`"atWord": "match"` — first occurrence, case/punctuation-insensitive) or a word index
(`"atWord": 3`). Anchors resolve against the build's actual VO timings, so they ride real TTS with
**no mock→real retune** — prefer them wherever the moment belongs to a spoken word:

```json
"keyframes": [{ "atWord": "match", "params": { "pct": 86 }, "ease": "overshoot" }],
"triggers":  [{ "atWord": "match", "action": "pulse" }]
```

A typo'd `atWord` fails the build naming the beat's words. Plain `at` seconds remain for moments
with no word (mid-gap settles); sync those with `kino inspect`, or preview a word's moment directly
with `kino still <spec> --segment N --word match`.

The base `params` values act as an **implicit t=0 keyframe**: a lone keyframe tweens from the base
value to its target (so `"params": { "pct": 0 }` + one keyframe at `"atWord": "match"` counts up and
lands on the word — no start keyframe needed).

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

**`kino-pulse`** — maps the `--pulse` envelope to an opacity + scale pop. Place spec `triggers` with `action:"pulse"` at the VO word times (from `kino inspect`) and the element punches on each word. The envelope attacks in ~45ms then decays (punchier than a soft half-life fade).

**Do not put `kino-pulse` on always-visible primary chrome** (play buttons, nav bars, hero labels).
The class sets `opacity: var(--pulse, 0)` — the element is **hidden** whenever `--pulse` is 0 (almost
the entire beat). Use it only on accent elements meant to flash on a spoken word (dots, chips, rings
behind a control). For a persistent control that should subtly react to a trigger, drive
`transform`/`box-shadow` off `var(--pulse)` in your own class instead.

```html
<style>.dot { width:24vw; height:24vw; border-radius:50%; background:var(--kino-green); }</style>
<div class="dot kino-pulse"></div>
```
```jsonc
// in the spec, on this beat's motion / motionOverlay:
"triggers": [{ "at": 0.31, "action": "pulse" }, { "at": 0.92, "action": "pulse" }]
```

**Eased progress (no JS)** — drive camera / opacity off curves instead of linear `--progress`:

```css
.cam { transform: scale(calc(1 + 0.08 * var(--kino-out))); }
.wash { opacity: calc(0.2 + 0.15 * var(--kino-edge)); } /* seam-safe life */
.pop  { transform: scale(var(--kino-overshoot)); }       /* may exceed 1 mid-beat */
```

**`kino-camera`** — velocity-blur on camera moves. Keyframe a `cam` param (`0→1` over ~2s) in the spec;
kino injects `--cam-vel` and `--cam-blur` each frame. Frame 0 is blurred when `cam=0` (rest softness +
forward velocity lookahead); blur peaks mid-move and clears on settle.

```html
<div class="cam kino-camera" style="transform:scale(calc(1.38 - 0.38 * var(--cam)))">…</div>
```
```jsonc
"motionOverlay": {
  "params": { "cam": 0, "camBlur": 14 },
  "keyframes": [
    { "at": 0, "params": { "cam": 0 } },
    { "at": 2, "params": { "cam": 1 }, "ease": "easeInOut" }
  ]
}
```

Optional `camBlur` (default 12) scales strength. Tier-2 gets `env.camVel` / `env.camBlur`.

Tier-2 gets the same numbers as `env.out` / `env.inout` / `env.overshoot` / `env.spring` / `env.edge`.

**Playback clocks (scrubbers, elapsed timers)** — drive from `--t`, not `--progress`. `--progress`
maps the whole beat to `0→1`; a scrubber keyed to `progress * N` outruns the timestamp when real VO
changes beat length. Use one shared elapsed clock for both the label and the bar:

```css
.wrap {
  --track-secs: 198;   /* e.g. 3:18 */
  --start-secs: 42;    /* e.g. 0:42 at beat start */
  --elapsed: calc(var(--start-secs) + var(--t));
}
.bar  { width: calc(var(--elapsed) / var(--track-secs) * 100%); }
.knob { left:   calc(var(--elapsed) / var(--track-secs) * 100%); }
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

### Liquid glass (`kino-glass`)

Add `class="kino-glass"` to a positioned element and the engine renders a **true refraction mirror**
behind it: each frame the background canvas region under the element is sampled through an SDF lens
(WebGL) — warp + blur concentrated at the rim, frosted body (`--glass-frost`), per-channel chromatic
dispersion, luminous film. Default silhouette is a rounded rect (`--glass-morph: 2`); morph/tilt knobs
can lerp triangle → circle → round-rect and rotate the SDF in-shader. This is the real Apple Liquid
Glass material, and the only way to get it: Chromium's compositor cannot run `feImage` displacement
maps inside `backdrop-filter` (they silently degrade to a uniform white-map shift), so backdrop-filter
can never do more than frosted blur + axial `feOffset` approximations.

```html
<div class="card kino-glass" style="border-radius:8vw">…content at z-index ≥ 1…</div>
```

Rules and knobs:

- **Keep the element's own `background` transparent** — the film is drawn inside the mirror
  (`--glass-film`). The mirror injects at `z-index:-1`; give your content `z-index: 1+`.
- Silhouette is **SDF alpha** (not CSS `border-radius` clip) — outside the shape is transparent.
  For morph demos use a square container large enough for tilt clearance; set `border-radius` for
  the round-rect corner size when morphing toward rect.
- **Do not CSS-`transform: rotate()` the glass element** — that breaks backdrop sampling. Tilt via
  `--glass-tilt` instead (SDF rotates in local px; element stays axis-aligned).
- Works over **shader (`.frag`) and Canvas2D draw-fn backgrounds**. As a `motionOverlay` on
  avatar/app beats there is no canvas backdrop, so the mirror is skipped gracefully (style a film
  fallback if the panel must read there).
- All knobs are CSS custom properties read per frame — tweenable via `params`/`keyframes`:

| Var | Default | Meaning |
|---|---|---|
| `--glass-strength` | `26` | max rim displacement (px) |
| `--glass-band` | `max(radius, 48)` | rim band width (px) |
| `--glass-chroma` | `0.07` | RGB dispersion spread |
| `--glass-profile` | `2.2` | lens falloff exponent (higher = tighter rim) |
| `--glass-frost` | `0` | body frost blur radius (px) — frosted glass fill |
| `--glass-edge-blur` | `0` | extra blur at the rim (px), on top of frost |
| `--glass-film` | `rgba(255,255,255,0.13)` | luminous film over the refraction |
| `--glass-saturate` | `1.25` | backdrop saturation boost |
| `--glass-brightness` | `1.06` | backdrop brightness boost |
| `--glass-morph` | `2` | continuum: `0` triangle → `1` circle → `2` round-rect. **Pair mode** (when `--glass-from` ≥ 0): `0..1` blend between from→to |
| `--glass-from` | _(unset / `-1`)_ | optional shape id `0\|1\|2`. Set ≥0 to morph **directly** between two shapes (skips the continuum middle) |
| `--glass-to` | `2` | pair-mode target shape id `0\|1\|2` |
| `--glass-tilt` | `0` | SDF rotation in degrees (no CSS rotate) |

Pair-mode morph is `0→1` along one edge only. To chain (rect→tri→circ), finish the first blend (`morph: 1`), then **retarget** `from`/`to`/`morph: 0` on the next keyframe with `"ease": "hold"` so shape ids snap instead of lerping through illegal middles.

Pair with a bright border / diagonal sheen for quiet rect cards; morphing shapes get a soft lit rim
from the SDF itself. Copyable reference: `assets-lib/motion/liquid-glass.html` (bare id
`liquid-glass`). Needs a STRUCTURED, colorful background to refract (e.g.
`backgroundComponent: "liquid-orb"`); refraction of a flat field is invisible. Uniform corner radii
only (the first corner value is used for morph=2).

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

`env = { frame, t, progress, out, inout, overshoot, spring, edge, pulse, params, palette:{mint,green,night,white,gold,font}, width, height, words?, durationFrames, duration }`.
`words` is the beat-relative VO timing array (same as the caption engine); omit/empty when the beat has no speech.
End-of-beat / seam logic should still prefer `env.progress` / `env.edge` thresholds (e.g. `progress > 0.95`) —
`progress` never equals exactly `1.0` (max ≈ `(frames - 1) / frames`).

It runs in the browser render (no Node `process`/`fs`/env reachable) and must be a **pure `(env) → string`**:
the build lints the source and rejects `Date.now`/`Math.random`/timers/`fetch`/`import`/`require`/`process`
and direct `document`/`window` access. **Comments and string/template-literal contents are blanked
before the scan**, so filenames like `"prompt-window.js"` or a comment mentioning `window.location`
are not flagged — they don't execute. Expressions inside `${…}` are still scanned
(`` `${window.location}` `` is banned). Keep banned tokens out of executable code.
Reference it from the spec exactly like a `.html` graphic.

## Embedded Lottie (Tier 3)

When a graphic needs organic illustrated motion, complex vector morphs, or designer-crafted logo reveals that come out of After Effects — things no agent can author from scratch — point `source` at a **`.json`** Bodymovin/LottieFiles file instead of a `.html` or `.js` file. kino plays it deterministically with a frame-seeked Lottie player (`goToAndStop` per frame — the same frame-seek discipline as the rest of the pipeline).

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
- **3 MB cap** — the serialized JSON ships inline in the render-page config. Simplify or split animations that exceed the limit.

> `.lottie` (dotLottie binary) support and brand color-token recoloring are documented follow-ons and are not yet implemented.

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

- **Make it move — default to richer animation.** Agents under-animate: a card that only fades
  `opacity` with `--progress` then holds is unfinished. Target **≥3 layers**: entrance (staggered
  `kino-pop` / scrubbed `@keyframes` / overshoot params) + **continuous life** off `--t` or a looping
  Lottie + speech lock (`triggers` / `env.words` / `kino-pulse`) and/or a CSS camera push. Stagger
  whenever ≥2 elements share the frame. Multi-step UIs should light off `env.words` when the VO
  names those steps (fixed clocks leave dead tails after real TTS). Brand calm ≠ motionless.
  Playbook: `skills/video-production` § Make motion graphics move / Real VO retune / Seamless loops.
- **Preview in a loop — `kino still` + `--around` are the main tools.** A midpoint still hides
  typewriter grain, Lottie phase, and camera push. `--segment N` ≠ t=0 — use `--at 0` for ready
  posters. After every non-trivial edit: `kino still <spec> --segment N` (layout) then
  `kino still <spec> --around <t>` (progression; tune `--span` / `--count`). Prefer **per-beat harness
  specs** so you aren't waiting on a full video encode. **Read the sheet**. After real VO:
  `kino frames <mp4> --around <t>` and retune. Typed UI: `skills/speech-synced-ui`.
- **Seamless loops:** paint a **static** full-bleed `.bg` in every motion graphic (brand `mesh`/`aurora`
  drift on the global frame and break first≡last). Gate encoded seams with PSNR/RMSE, not raw AE.
- **Use `vw` units for resolution independence.** The render canvas is 1080px wide, so `1vw = 10.8px`; sizing everything in `vw` makes the graphic render pixel-identical in the video *and* scale cleanly when the raw file is previewed at any width (a fixed-px graphic overflows a narrow preview pane).
- **Match brand amplitude, not "no motion".** Quiet brands: soft `easeInOut`, long entrances (~1s),
  slow `--t` life. Punchy brands: `overshoot`/`spring`, word-fire Lottie, harder pops. Either way,
  something should still be alive after the entrance settles.
- **Inline images as `data:` URIs** — external/relative `url()` won't resolve in the render.
- **Sync to the voiceover** — read per-word start/end with `kino inspect` and place your keyframe `at` times on the words; verify with `--around` at those times, not inspect alone.

## Shared library

Original motion graphics ready to copy into a project's `assets/motion/` live in
[`assets-lib/motion/`](../assets-lib/motion/):

- **Tier 1 (HTML)** — card reveals, dials, counters, a type-only reveal, an ink-drawn illustration.
- **Tier 2 (JS, speech-synced UI)** — `prompt-type.js`, `json-type.js`, `build-pipeline.js`,
  `loop-ready.js` — the typed prompt / JSON editor / build terminal / loop-seam pages extracted
  from the kino advert. They read `env.words` (see [Typed-in-sync text](#typed-in-sync-text) and the
  `speech-synced-ui` skill). Edit the knobs at the top of each file, then copy into the project.

All original work (unlike the Lottie library, nothing here is adapted from a third-party template).

## Worked examples

[`examples/motion-ui/`](../examples/motion-ui/) renders the speech-synced UI pages (library files,
mock `env.words`) through the real pipeline:

```bash
npx tsx examples/motion-ui/render-ui.ts            # stills → examples/motion-ui/out/
FLEX_VIDEO=1 npx tsx examples/motion-ui/render-ui.ts # short 9:16 mp4
```

[`examples/motion-flex/`](../examples/motion-flex/) is a Tier 1 / procedural showcase:

- `hero.html` — a kinetic title (blur-rise headline via scrubbed `@keyframes`, gradient shimmer).
- `stat.html` — a count-up stat (pure-CSS `counter` driven by `--pct`, staggered keywords, `kino-cliptext`).
- `orbit.html` — an orbiting particle system with a popping wordmark.

Render them:

```bash
npx tsx examples/motion-flex/render-flex.ts            # verification stills → examples/motion-flex/out/
FLEX_VIDEO=1 npx tsx examples/motion-flex/render-flex.ts # the full mp4
```

See also: [Spec reference](spec-reference.md) · [CLI reference](cli-reference.md) · [Backgrounds & overlays](backgrounds-and-overlays.md).
