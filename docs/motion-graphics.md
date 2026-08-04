# Motion graphics

Motion graphics let an agent author a **self-contained HTML/CSS file** whose animation is driven entirely by **kino-set CSS custom properties**. kino renders it deterministically in headless Chromium, mounted in a sandboxed Shadow DOM. The JSON spec owns the clock; your HTML is a stateless canvas that reads variables and paints the current frame.

Run `kino motion` for the same contract inline.

- [Why it's shaped this way](#why-its-shaped-this-way)
- [The CSS-variable contract](#the-css-variable-contract)
- [Driving it from the spec](#driving-it-from-the-spec)
- [A first example](#a-first-example)
- [Scrubbed @keyframes](#scrubbed-keyframes)
- [Staggering reveals](#staggering-reveals)
- [Multi-element choreography](#multi-element-choreography)
- [Gradient-clipped text (`kino-cliptext`)](#gradient-clipped-text-kino-cliptext)
- [Helper classes (reveals, pulse, easing)](#helper-classes-reveals-pulse-easing)
- [Procedural graphics (Tier 2)](#procedural-graphics-tier-2)
- [Embedded Lottie (Tier 3)](#embedded-lottie-tier-3)
- [Determinism & safety (the lint)](#determinism--safety-the-lint)
- [Authoring tips](#authoring-tips)
- [Worked examples](#worked-examples)

## Why it's shaped this way

kino renders by seeking to frame *N* and capturing the composited stage. There is no real timeline running — so anything that animates on the **wall clock** (raw CSS `transition`, unscrubbed `@keyframes`, `requestAnimationFrame`, `Date.now()`) renders to a frozen or non-deterministic frame. kino's contract makes motion a pure function of frame state:

- **JSON owns the clock** — `params`, `keyframes`, and `triggers` in the spec.
- **HTML is a stateless canvas** — one markup file + one inline `<style>`, reading the variables kino sets every frame.

At build time the file is **lint-checked** (determinism + safety) and **sanitized** (DOMPurify), then **rasterized into a compositor layer** (SVG `foreignObject` for most markup; `kino-lens` runs an extra mirror pass) so its styles never leak into the composition.

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
| `--kino-accent` `--kino-accent2` `--kino-deep` `--kino-bg` `--kino-fg` | brand palette, by role (primary accent · secondary/bright · deep fill · page base · text ink). The legacy literal names (`--kino-mint/-gold/-green/-night/-white`) stay injected as aliases for the same slots. |
| `--kino-surface` `--kino-line` `--kino-muted` | the UI roles for fabricating a product surface: a panel raised off the page · borders and rules · secondary ink. Derived from the five above unless the brand or spec names them. |
| `--kino-ok` `--kino-warn` `--kino-danger` | the semantic triad — pass · caution · failure. Reserved colours, deliberately independent of the brand accents, and darkened automatically on a light scheme. See [UI roles](spec-reference.md#ui-roles). |
| `--<key>` from `spec.data` | [shared constants](spec-reference.md#shared-constants) — a figure quoted on several surfaces, stated once. A beat's own `params` override a key of the same name. |
| `--kino-font` | brand font family |
| `--kino-label-font` | brand `labelFont` (falls back to `--kino-font`) |
| `--kino-caption-bottom` | px from the frame bottom where kino's caption band sits (`0px` when this beat has no caption) — keep your own text clear of it, e.g. `bottom:calc(var(--kino-caption-bottom) + 24px)` |
| `--kino-words-shown` | **continuous** count of the beat's spoken words shown at this frame — each word contributes its elapsed fraction (0→1 across its spoken span), reaching exactly *k* when word *k* finishes. Gated reveals like `clamp(0, calc(var(--kino-words-shown) - i), 1)` ease through the word instead of stepping at its start |
| `--kino-word-count` | total spoken words in this beat |

> The secondary accent **is** auto-injected as `--kino-accent2` (alias `--kino-gold`). You don't need to pass it as a param.

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

  Works in a full-screen `kind:"motion"` beat **and** as a `motionOverlay` on a `video`/`scene` beat (the
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

### Beat handoffs

Consecutive motion beats hand off with **shader transitions** during the overlap
window (`MOTION_XFADE_FRAMES`), not a CSS opacity crossfade. Set `transition` on the **incoming**
beat; the vocabulary is `fade`, `dissolve`, `fly-left`, `fly-up`, `pop`, `cut`, the `wipe`
family, and `custom` (your own shader). `kino transitions` lists them all.

**Motion beats default to `dissolve` and are not part of the app auto-vary rotation.** (They used to
fall through to it and silently get `fly-left` — a horizontal slide on every motion handoff in every
spec. A motion beat owns its whole frame, so shoving that frame sideways reads as a compositing
glitch rather than an authored move.)

**The `wipe` family** is what to reach for when a handoff should read as motion graphics: a lit edge
travels across the frame and *uncovers* the incoming beat behind it. Prefer it over `fade`/`dissolve`
between two authored compositions — a cross-fade mushes two layouts on top of each other, which is
especially bad when the beats share a layout skeleton (same kicker slot, same title position), since
the two titles then ghost through each other in place.

`wipe-down` / `-up` / `-left` / `-right` are direction shorthands; bare `wipe` + `transitionParams`
gives an arbitrary `angle` plus control over `softness`, `edgeWidth`, `edgeColor` and `edgeGain`
(`edgeWidth: 0` = an unlit, invisible reveal). Full table in
[spec-reference § Wipe transitions](spec-reference.md#wipe-transitions).

Any transition can be **reversed** with `"transitionInvert": true` beside it — a reveal becomes a
conceal, an opening iris becomes a closing one. It works on built-ins and custom shaders alike
because it is a compositor-side flip (swap the beats, feed `1-p`), not something a shader implements.

**`transitionCamera`** carries a camera move through the handoff — `{ "move": "whip-left" }`,
`{ "move": "push" }`, or a raw `zoom`/`panX`/`panY` vector — so the outgoing beat keeps moving as it
leaves and the incoming arrives already in motion. It stacks onto any transition and onto
`transitionInvert`. Full table in
[spec-reference § Carrying a camera through the cut](spec-reference.md#carrying-a-camera-through-the-cut).

Not enough? **Write your own**: `transition: "custom"` + `transitionSource` (a bare id from
`assets-lib/transitions/`, or an `assets/` path) runs your `.frag`, with `kinoFrom(uv)` / `kinoTo(uv)`
/ `uP` in scope and your `transitionParams` as `u_<name>` uniforms. Run **`kino transitions`** for the
contract, or copy `assets-lib/transitions/iris.frag`.

Don't hand-roll a sweeping band inside the graphic to fake this. A CSS band plus the engine's real
transition is two transitions fighting, and the band can't reveal anything — it only draws *over*
the outgoing beat, because the incoming beat is a separate page the graphic cannot mask against.
What the beat should do either side of a handoff is stop being frozen: give it a small settle so the
frame the wipe uncovers is easing rather than static.

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

### The two things authors get wrong here

**1. The class goes on the element that carries the animation — never on a wrapper.** kino only
scrubs elements that have the class. Put it on a parent and the child is left with CSS's default
`animation-duration: 0s`, so it paints its **end state from frame 0**. The beat doesn't look broken,
it looks *already finished* — which is why it survives a midpoint still and the under-animation
probe. This is lint-rejected now, but the shape is worth recognising:

```html
<div class="wrap kino-anim">                <!-- ✗ scrub on the wrapper does nothing -->
  <span class="ch">O</span>                 <!--   .ch{animation-name:fall} never scrubs -->
</div>
<div class="wrap">
  <span class="ch kino-anim">O</span>       <!-- ✓ scrub on the animated element -->
</div>
```

**2. Percentages are fractions of the BEAT, not of an entrance.** The scrub pins
`animation-duration` to `1s` and maps that second across the whole beat
(`animation-delay: calc((var(--progress) - var(--kino-delay, 0)) * -1s)`). So a `0% → 100%` entrance
takes the *entire beat* to arrive. Compress the motion into low percentages and hold:

```css
@keyframes fall {
  0%   { transform: translateY(-78%); opacity: 0 }
  12%  { transform: translateY(11%) }            /* overshoot */
  19%  { transform: translateY(0) }              /* landed, ~a fifth of the way in */
  100% { transform: translateY(0); opacity: 1 }  /* hold for the rest of the beat */
}
```

**`--kino-delay` is in progress units (`0..1` = the beat), not seconds.** `--kino-delay: .1` means
"start a tenth of the way through this beat" — on a 4s beat that's 400ms, on a 2s beat 200ms. A
keyframe stop `X%` therefore fires at `progress = delay + X/100`.

## Staggering reveals

Don't let everything land at once. Three idioms:

```css
/* 1. Auto-stagger a whole list with sibling-index() — one rule, no extra params */
.item { --d: calc((sibling-index() - 1) * .08);
        opacity: clamp(0, calc((var(--progress) - .2 - var(--d)) * 8), 1); }

/* 2. Give each element its own slice of --progress */
.a { opacity: clamp(0, calc(var(--progress) * 10), 1); }
.b { opacity: clamp(0, calc((var(--progress) - .12) * 10), 1); }

/* 3. Stagger scrubbed @keyframes with --kino-delay (pairs with sibling-index).
      Units are PROGRESS (0..1 = the whole beat), not seconds: .1 = a tenth of the beat. */
.kw { animation-name:rise; --kino-delay: calc((sibling-index() - 1) * .1); }
```

For per-element spring/overshoot, expose a param per element (`--w1`, `--w2`, …) and offset the keyframe `at` times.

## Multi-element choreography

When a beat has **several moving parts** (stacked cards, a row of chips, HUD layers), you do **not** need a new keyframe system — the existing `params` / `keyframes` surface is enough. The convention is:

1. **JSON owns a small set of shared drivers** — scalar params the whole graphic reads (`fan`, `lift`, `enter`, `cam`, …).
2. **HTML maps drivers to each element** — one CSS rule per class, combining drivers in `calc()` (and `sin(var(--t))` for cheap organic drift).
3. **`z-index` + DOM order set stack order** — later siblings / higher `z-index` paint on top.

Every param in the spec becomes `--<key>` on the motion host each frame (see [Driving it from the spec](#driving-it-from-the-spec)). Tween them with `keyframes`; anchor to speech with `atWord` when the moment belongs to a word.

### Param naming

| Pattern | When | Example |
|---|---|---|
| **Shared driver** | Several elements move together or in a fixed ratio | `--fan`, `--lift` → each panel gets a different `calc()` multiplier |
| **Per-element param** | Independent timing or range | `--w1`, `--w2` with staggered keyframe `at` times |
| **Glass knobs** | Refraction lens only | `--glass-strength`, `--glass-band`, `--glass-chroma`, … (read by the mirror shader) |

Prefer **few shared drivers** over many per-element params — easier to retune and speech-lock one motion.

### Layout and motion rules

```css
/* Shared drivers from the spec — host sets --fan, --lift every frame */
.back  { z-index: 1; transform: translate(calc(var(--fan) * -52px), calc(var(--lift) * -36px)); }
.mid   { z-index: 2; transform: translate(calc(var(--fan) * 16px),  calc(var(--lift) * 12px)); }
.front { z-index: 3; transform: translate(calc(var(--fan) * 64px),  calc(var(--lift) * 48px)); }
```

- **`transform: translate()` is fine** on any element, including `kino-lens` — the mirror tracks `getBoundingClientRect()` each frame.
- **Do not `transform: rotate()` or `skew()` a `kino-lens` element** — that breaks backdrop sampling. Keep the lens axis-aligned; use `border-radius` for the silhouette.
- **Content above the mirror** — keep labels/CTAs at `z-index: 2+`; the mirror injects at `z-index: -1` inside the glass element.
- **Optional `sin(var(--t))` drift** — combine with keyframed params for motion that doesn't need its own spec key (see `.back` below in the worked example).

### Stacked `kino-lens` (same beat)

Multiple `kino-lens` panels in **one** motion HTML are supported. The engine walks panels **bottom → top** (`z-index`, then DOM order) and, for each panel, samples whatever is already drawn beneath it in that beat — compositor layers under the motion beat **plus** the same-layer base raster **plus** mirrors from lower panels.

| Setup | What the first glass panel refracts |
|---|---|
| Full-screen motion with a busy field **in the HTML** (stripes, photo, gradient) | Compositor backdrop **merged with** the base raster — put the field in `.stage`, not only in the global `background` |
| `motion` + `motionOverlay` | Compositor composite **including the motion layer beneath** the overlay — use when glass must refract another motion graphic |

Put a **structured, high-contrast field** behind the stack (stripes, shader, photo). Refraction of a flat wash is invisible.

Reference: `projects/compositor-demo/assets/motion/liquid-glass-stack.html` + beat 5 of `specs/glass-refraction-demos.json`.

### Worked example — stacked glass, fan + lift

**HTML** — three panels, shared `--fan` / `--lift`, light `--t` wobble on the back panel:

```html
<style>
  .stage { position:absolute; inset:0;
    background:repeating-linear-gradient(90deg,#000 0 32px,#fff 32px 64px); }
  .panel { position:absolute; border-radius:40px; background:transparent;
    border:2px solid rgba(255,255,255,.75); display:flex; align-items:center; justify-content:center; }
  .panel span { position:relative; z-index:2; font-size:44px; font-weight:800; color:#fff; }
  .back  { left:10%; top:22%; width:80%; height:28%; z-index:1;
    transform:translate(calc(var(--fan)*-52px + sin(var(--t)*.9)*8px), calc(var(--lift)*-36px)); }
  .mid   { left:18%; top:36%; width:64%; height:24%; z-index:2;
    transform:translate(calc(var(--fan)*16px), calc(var(--lift)*12px)); }
  .front { left:26%; top:48%; width:48%; height:20%; z-index:3;
    transform:translate(calc(var(--fan)*64px), calc(var(--lift)*48px)); }
</style>
<div class="stage">
  <div class="panel back kino-lens"><span>Back</span></div>
  <div class="panel mid kino-lens"><span>Mid</span></div>
  <div class="panel front kino-lens"><span>Front</span></div>
</div>
```

**Spec** — panels fan apart mid-beat, then settle:

```json
{
  "kind": "motion",
  "source": "motion/liquid-glass-stack.html",
  "dur": 4,
  "params": { "fan": 0, "lift": 0 },
  "keyframes": [
    { "at": 0, "params": { "fan": 0, "lift": 0 } },
    { "at": 2, "params": { "fan": 1, "lift": 0.85 }, "ease": "easeInOut" },
    { "at": 4, "params": { "fan": 0.2, "lift": 0.3 }, "ease": "easeInOut" }
  ]
}
```

Preview: `kino still projects/compositor-demo/specs/glass-refraction-demos.json --beat 5 --around 2` or build beat 5 with `--draft`.

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

### Liquid glass / lens (`kino-lens` · `kino-lens`)

Add `class="kino-lens"` **or** `class="kino-lens"` to a positioned element and the engine renders a
**true refraction mirror** behind it: each frame the under-composite is sampled through a lens
material (WebGL) — warp + blur at the rim, frosted body (`--glass-frost`), chromatic dispersion,
luminous film. Default material is `assets-lib/effects/liquid-glass.frag`. Override per element with
`data-lens="<id|path>"` (bare id → `assets-lib/effects/<id>.frag`, else project/workspace path).
Chromium cannot run `feImage` displacement inside `backdrop-filter`, so this path is the only real
Apple-style liquid glass.

Post-raster effects run via `motionPostEffects/` after the foreignObject raster. On the compositor
path the renderer publishes a GPU backdrop snap (`needsCompositorBackdrop`); stacked lenses render
on the **compositor GL context** (`glassGpu.ts`) — no cross-context texture bind, no GPU→CPU readback.

```html
<div class="card kino-lens" style="border-radius:8vw">…content at z-index ≥ 1…</div>
<!-- alias + custom material -->
<div class="card kino-lens" data-lens="liquid-glass" style="border-radius:8vw">…</div>
```

Rules and knobs:

- **Keep the element's own `background` transparent** — the film is drawn inside the mirror
  (`--glass-film`). The mirror injects at `z-index:-1`; give your content `z-index: 1+`.
- **Silhouette = `border-radius`**, child `svg.kino-lens-shape`, or `--glass-path*` / `clip-path`.
- **Do not CSS-`transform: rotate()` or `skew()` the glass element** — that breaks backdrop sampling.
- Works over **shader (`.frag`) and Canvas2D draw-fn backgrounds**. On the **GL compositor** path,
  `motionOverlay` glass refracts the true composite beneath the overlay (including the host motion
  layer). Put a busy field in the layer stack or in the overlay's own HTML so refraction is visible.
- All knobs are CSS custom properties read per frame — tweenable via `params`/`keyframes` (see
  [Multi-element choreography](#multi-element-choreography) for stacked panels):

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

**SVG silhouette:** add a direct child `<svg class="kino-lens-shape" viewBox="…">` with filled paths (`path`, `circle`, `rect`, …). The lens follows that alpha mask instead of `border-radius`. Keep the SVG invisible (`opacity: 0` — injected by `.kino-lens-shape`). Content stays in sibling elements at `z-index ≥ 1`.

**Path morph (CSS):** set `--glass-path-from`, `--glass-path-to`, and tween `--glass-morph` (0→1) via `params` / `keyframes` (same command count in both paths). Optional `--glass-viewbox` (default `0 0 100 100`).

**Path morph (SMIL):** put `<animate attributeName="d">` inside `.kino-lens-shape` with `values` + `keyTimes`; kino samples and lerps path `d` at `--progress` (Chromium SMIL playback is inert in the render engine).

**clip-path:** `clip-path: url(#id)` (prefer `clipPathUnits="objectBoundingBox"`) or `clip-path: path('…')` on `.kino-lens` — used when there is no child shape SVG.

**Stroke-only silhouettes:** paths with `fill="none"` and a `stroke-width` rasterize the stroke as the lens mask.

```html
<div class="hero kino-lens">
  <svg class="kino-lens-shape" viewBox="0 0 100 100" aria-hidden="true">
    <path fill="#fff" d="M50 4 L61 38 H97 … Z"/>
  </svg>
  <h1 style="position:relative;z-index:2">Title</h1>
</div>
```

```html
<!-- CSS path morph -->
<div class="kino-lens" style="--glass-viewbox:0 0 100 100;
  --glass-path-from:'M12 12 H88 V88 H12 Z';
  --glass-path-to:'M50 8 L92 50 L50 92 L8 50 Z';">
  …
</div>
<!-- keyframes: { "at": 2, "params": { "glass-morph": 1 } } -->
```

Demos: `projects/compositor-demo/assets/motion/liquid-glass-path-morph.html`, `liquid-glass-smil-morph.html`, `liquid-glass-clip.html`, `liquid-glass-wave.js` (beats 7–10 in `glass-refraction-demos.json`).

Pair with a bright border / diagonal sheen for quiet rect cards. Copyable reference:
`assets-lib/motion/liquid-glass.html` (bare id `liquid-glass`). Needs a STRUCTURED, colorful
background to refract (e.g. `backgroundComponent: "liquid-orb"`); refraction of a flat field is
invisible. For mask-shaped refraction on footage beats, use `region-glass.frag` (`docs/segmentation.md`)
— a separate path from motion `kino-lens`.

## CSS 3D: what works, and the one thing that doesn't

A motion graphic is rasterized through an SVG `foreignObject`. That path supports more of CSS 3D
than authors assume, and exactly one property less — which is the trap, because the missing one
fails silently.

**Works** (verified against the render): `perspective`, `rotateX` / `rotateY` / `rotate3d`,
`translateZ`, and `transform-style: preserve-3d`, including a nested, counter-rotated child inside a
rotated parent. A child at `translateZ(240px)` really does render larger than its sibling at
`translateZ(-240px)`; foreshortening is correct.

**Does not work:** `backface-visibility: hidden`. The cull is dropped, so **both** faces of a flip
paint and whichever is later in DOM order wins. At rest this looks perfect — the front face happens
to cover the back — and it only goes wrong once the card turns, at which point the back never
appears and the front reads mirrored. It survives a poster still and shows up in the finished
render. It is lint-rejected now, but recognise the shape:

```html
<!-- ✗ the standard flip: renders both faces stacked, no error -->
<div class="face front" style="backface-visibility:hidden"></div>
<div class="face back"  style="backface-visibility:hidden; transform:rotateY(180deg)"></div>
```

Keep the real rotation and gate each face's opacity off the same driver. The multiplier just needs
to be steep enough to read as a hard switch at the halfway point:

```html
<style>
  .card  { transform-style:preserve-3d; transform:rotateY(calc(var(--flip) * 180deg)); }
  .face  { position:absolute; inset:0; }
  .front { opacity: clamp(0, calc((0.5 - var(--flip)) * 60), 1); }
  .back  { transform: rotateY(180deg);
           opacity: clamp(0, calc((var(--flip) - 0.5) * 60), 1); }
</style>
<div class="card"><div class="face front">FRONT</div><div class="face back">BACK</div></div>
```

```jsonc
"params": { "flip": 0 },
"keyframes": [{ "at": 2, "params": { "flip": 1 }, "ease": "easeInOut" }]
```

The `rotateY(180deg)` on `.back` is what keeps its content readable rather than mirrored — it is
counter-rotating against the card, which `preserve-3d` composes correctly.

### Other primitives that work

Agents routinely avoid these on suspicion that the raster can't take them. All verified:

| | |
|---|---|
| `mix-blend-mode` | works (`screen`, `multiply`, … between siblings) |
| `filter: blur()` / `drop-shadow()` | works |
| `clip-path` driven by `var(--progress)` | works |
| `mask-image` gradients | works |
| SVG `<textPath>` | works |
| `-webkit-text-stroke` | works |
| `box-shadow`, including `inset` | works |
| `conic-gradient` with an animated `from` angle | works |
| **`backdrop-filter`** | **dead** — use [`kino-lens`](#liquid-glass--lens-kino-lens--kino-lens) |

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

`env = { frame, t, progress, out, inout, overshoot, spring, edge, pulse, params, data, palette:{bg,fg,accent,accent2,deep, surface,line,muted,ok,warn,danger, mint,green,night,white,gold,font}, width, height, words?, durationFrames, duration, lib, sim }`.
`data` is the spec's [shared constants](spec-reference.md#shared-constants) (`{}` when it declares none) and `sim` is the beat's [baked solve](spec-reference.md#simulation) (`sim.at` is this frame's row, `null` with no solver).
`words` is the beat-relative VO timing array (same as the caption engine); omit/empty when the beat has no speech.
End-of-beat / seam logic should still prefer `env.progress` / `env.edge` thresholds (e.g. `progress > 0.95`) —
`progress` never equals exactly `1.0` (max ≈ `(frames - 1) / frames`).

`env.lib` is the proc standard library — three pure, pre-bundled libraries (procs still can't
`import` anything):

- **`env.lib.shape`** — [d3-shape](https://d3js.org/d3-shape): `line`/`area`/`arc`/`pie`/`stack`
  generators plus curve factories (`curveCatmullRom`, `curveBasis`, …) and `symbol`s. Headless —
  generators return SVG path strings, no DOM.
- **`env.lib.color`** — [culori](https://culorijs.org): parse, convert, `mix`, `interpolate`
  (perceptual `"oklch"` ramps beat naive hex-lerp for chart scales and gradients), `formatHex`.
- **`env.lib.noise2D/3D/4D(x, …)`** — simplex noise in [−1, 1], pre-seeded deterministically (same
  spec → same field on every machine). `env.lib.seedNoise(seed)` mints an independent field, e.g.
  one per series.

```js
// assets/motion/spark.js — a real chart in a few lines
const data = [12, 30, 22, 44, 38, 52];
const pts = data.map((v, i) => [60 + i * 60, 240 - v * 3 * env.out]);
const d = env.lib.shape.line().curve(env.lib.shape.curveCatmullRom)(pts);
const tint = env.lib.color.formatHex(
  env.lib.color.interpolate([env.palette.mint, env.palette.gold], "oklch")(env.progress));
return `<svg viewBox="0 0 480 270" style="position:absolute;inset:0;width:100%;height:100%">
  <path d="${d}" fill="none" stroke="${tint}" stroke-width="4"/></svg>`;
```

### Motion that needs state: springs, and baking a simulation

`render(env)` is called fresh every frame and can keep nothing between calls. That rules out
*integrating* anything — a physics step, a particle system with history, a solver that settles.
It does **not** rule out the results, and agents regularly stop one step too early here.

**A spring is a closed form, not an integration.** A damped oscillator has an exact solution at time
`t`, so a settle with real mass and overshoot is a pure function of `env.t` and needs no state:

```js
// critically-ish damped settle: 0 → 1, overshoots once, rings down. omega = stiffness, zeta = damping.
function settle(t, omega, zeta) {
  if (t <= 0) return 0;
  const wd = omega * Math.sqrt(Math.max(1e-6, 1 - zeta * zeta));
  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + (zeta * omega / wd) * Math.sin(wd * t));
}
// per-element mass: vary omega by index and they settle at their own rates, deterministically.
const y = settle(env.t - i * 0.04, 18, 0.45);
```

`ease: "spring"` on a spec keyframe gives you the same thing when one shared driver is enough;
reach for the closed form when each element needs its own mass.

**Everything else: bake it**, and the engine will run the bake for you. Point the beat's `sim` block
at a solver and it runs ONCE at build time, stateful and iterative, emitting one row per frame; the
proc reads `env.sim.at` and stays pure:

```jsonc
// spec
{ "kind": "motion", "source": "motion/coins.js", "dur": 2,
  "sim": { "source": "motion/coins.sim.js" } }
```

```js
// motion/coins.sim.js — an integrator. Frame N depends on frame N-1, which is the whole point.
const coins = Array.from({ length: 12 }, () => ({ x: sim.random() * sim.width, y: -200, vy: 0 }));
const floor = sim.height * 0.78;
return (frame) => {
  for (const c of coins) {
    c.vy += 2200 * sim.dt;
    c.y = Math.min(floor, c.y + c.vy * sim.dt);
    if (c.y === floor) c.vy *= -0.42;
  }
  return coins.map((c) => [Math.round(c.x), Math.round(c.y)]);
};
```

```js
// motion/coins.js — Tier 2, unchanged in kind: a pure (env) => string that indexes an array.
return (env.sim.at || [])
  .map(([x, y]) => `<div class="coin" style="left:${x}px;top:${y}px"></div>`).join("");
```

`env.sim.at` is this frame's row (already indexed on the beat's own clock — no arithmetic, and it
holds its last row through a handoff); `env.sim.rows` is the whole solve, for trails and lookahead.
`sim.random()` is seeded and the seed is recorded, so the bake reproduces exactly — `Math.random`
in a solver is linted out for that reason. `frames` defaults to the beat's real length, so a bake
authored under mock VO still covers the beat under `--tts`. Run `kino bake <solver>` to see the rows
before a render. Full contract: [Simulation](spec-reference.md#simulation).

Watch the size either way: the rows ship inline in the render-page config, so decimate long sims and
round coordinates. Hand-inlining a `const FRAMES = [...]` array in the `.js` still works and is fine
for a short, fixed sim — but it re-inlines those bytes into every raster, and it cannot follow a beat
whose length changed.

**For organic motion that doesn't need to be a specific sim**, `env.lib.noise2D/3D/4D` is pre-seeded
and deterministic — drift, flicker, jitter and crowd variation all come out of it with no state and
no bake. `env.lib.seedNoise(seed)` mints an independent field per series.

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

Tier-3 Lottie works in **all three motion slots**: a full-screen `kind:"motion"` beat, a `motionOverlay` on a `scene` beat, and a `motionOverlay` on a `video` beat.

### Playback

By default the animation plays **once, stretched** so its full duration spans the beat — matching the system's "everything is progress across the beat" model. Add `"loop": true` (a sibling of `source`) to loop the animation at native speed instead:

```json
{ "kind": "video", "source": "screens/dashboard.png", "text": "...", "caption": "...",
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
| `backface-visibility: hidden` | The raster drops the backface cull, so both faces paint and DOM order wins. Keep the 3D; gate each face's `opacity` — see [CSS 3D](#css-3d-what-works-and-the-one-thing-that-doesnt). |

**Allowed:** `@keyframes` and the `animation-*` longhands (except `animation-play-state`), all CSS custom properties + `calc()`/`sin()`/`clamp()`/`round()`/`counter()`, `sibling-index()`, `data:` URIs, and `#fragment` `url()`. After linting, the HTML is sanitized with DOMPurify (keeps your `<style>` + structural markup; strips `script`/`iframe`/`object`/`embed`/`link`/`meta`/`base`).

## Authoring tips

- **Don't emit images you're hiding with CSS.** A motion layer is rasterized through an SVG
  `foreignObject`, and an SVG-as-image is an isolated document that decodes **every** image it
  references — including ones inside `display:none` subtrees. `display: ${show ? "grid" : "none"}`
  hides a section visually while still paying its full decode on every frame of the render. Mirror
  the visibility at emission for anything carrying a payload:

  ```js
  const gridOn = showYt && !watchIn;               // same condition the CSS uses
  `<div class="thumb">${gridOn ? `<img src="/public/motion/${thumb}"/>` : ""}…</div>`
  ```

  Measured on `compositor-demo`: nine thumbnails that were CSS-hidden for ~800 of 1094 frames cost
  `raster:decode` 30.9 → 17.6 ms/frame once gated, and the beat went 79.0s → 52.9s with output
  bit-identical. Text and layout in a hidden subtree are cheap; **bitmaps are not**. Keep the gate
  expression identical to the CSS one, or the two drift and content vanishes when it should show.

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
