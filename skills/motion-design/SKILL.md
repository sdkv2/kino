---
name: motion-design
description: >
  Use when authoring or critiquing kino motion graphics (Tier-1 HTML, Tier-2 JS,
  motionOverlay, library pages) — composition, color, type, camera/choreography,
  spoof-UI craft, and anti-generic checks. Companion to speech-synced-ui (VO lock)
  and video-production (trailer structure). Not for ordinary captions or footage edit.
---

# Designing motion graphics in kino

Contract and lint live in `docs/motion-graphics.md` / `kino motion`. VO lock and
typed chrome live in `speech-synced-ui`. **This skill is the visual brief** — how a
beat should look and move so it feels authored for *this* brand, not like a stock
template dropped on 9:16.

Edit real `assets/motion/*` (or bare-id library sources). Prove with `kino still` /
`--around` / `frames`. Do not ship a vibe described only in markdown.

## When to Read this

- New `kind:"motion"` or `motionOverlay` from scratch
- Polish that is about hierarchy, palette use, chrome craft, or “why does this feel AI”
- Choosing camera / entrance / life after the mechanic already works
- Pre-ship visual pass before `adversarial-critique`

**Hand off elsewhere:** VO wording → `ad-voice`. Beat list / cold open → `video-production`.
Character burst typing / retune → `speech-synced-ui`. Overlap with captions/logo →
`adversarial-critique`.

## Type (shape of the claim)

Use `--kino-font` / `--kino-label-font`. Size in **`vw`** so 9:16 and preview panes stay honest.

Hierarchy: usually **three** levels on a beat — hook (hero), bridge (kicker/unit), detail (chips,
gutter, foot meta). Flat scales look uncommitted; more than three fights the VO.

Hero numerals / italic display: optically heavy enough to survive H.264.

System/default stacks are fine for product spoofs when brand.md says so; brand film should not
default to the same safe sans every project.

Keep graphic text clear of the caption band: `--kino-caption-bottom`. Prefer omitting captions on
dense typed beats (`speech-synced-ui`).


## Motion is character (frame-scrubbed)

In kino, motion is a **pure function of frame state** (`--progress`, eased `--kino-*` curves,
`--pulse`, `env.words`, params/keyframes). Wall-clock CSS transitions lie at render time.

Prefer **eased progress** over linear `--progress` for entrances and camera:

| Var / `env.*` | Curve | Use |
|---|---|---|
| `--kino-out` / `env.out` | ease-out cubic | Soft landings, camera push |
| `--kino-inout` / `env.inout` | smoothstep | Symmetric ramps |
| `--kino-overshoot` / `env.overshoot` | back-out (may >1) | Scale pops |
| `--kino-spring` / `env.spring` | elastic-out (may >1) | Rare punchy brand moments |
| `--kino-edge` / `env.edge` | `sin(π·progress)` | Seam-safe wash/breath (0 at beat edges) |

`--pulse` attacks in ~45ms then decays — pair with `.kino-pulse` on **accent-only** elements (dots,
chips, rings), or drive `var(--pulse)` in your own CSS for subtle reacts. **Never** `.kino-pulse` on
always-visible primary chrome — it sets `opacity: var(--pulse, 0)` and hides the control between
triggers. Do not hand-roll `(1-p)*(1-p)` when `env.out` / `--kino-out` already exists.

**Tier-2 stdlib (`env.lib`)** — don't hand-roll geometry, easing ramps of color, or wobble either:
`env.lib.shape` (d3-shape line/area/arc/pie + `curve*` factories, returns SVG path strings),
`env.lib.color` (culori — `interpolate([...], "oklch")` for perceptual ramps, `formatHex`), and
`env.lib.noise2D(x, y)` / `seedNoise(seed)` (deterministic simplex — organic drift with zero
`Math.random`). A real chart is `env.lib.shape.line().curve(...)` over data, not 40 lines of
hand-built `<div>` bars.

**Physics is precomputed, not impossible.** `render(env)` keeps nothing between frames, so an
integrator cannot live in it — but it does not have to. Point the beat's `sim` block at a solver
(`"sim": { "source": "motion/coins.sim.js" }`) and it runs ONCE at build time, stateful and
iterative, emitting one row per frame; the proc reads `env.sim.at` and stays pure. Rigid-body
bounces, fracture, particle settling, spring clustering with real mass — all reachable. `sim.random()`
is seeded so the bake reproduces; `Math.random` in a solver is rejected for that reason. Check one
with `kino bake <solver>` before rendering — a solver's output is numbers, and "every row is
identical" is the common failure. Closed-form damped springs from `env.t` are still the right answer
when each element just needs its own mass.

**Don't hand-roll a relaxation loop** — `sim.lib.force` is d3-force, bundled (a solver has no
`require`, so `sim.lib` is the only way a library reaches it). Tiles re-clustering, labels pushing
apart, a graph finding its shape: `.stop()` once, then one `.tick()` per frame, and return the node
positions. It converges rather than collides — no restitution or rotation — so a pile of bouncing
coins is still a hand-written integrator, which `sim.dt` keeps short. `kino bake` prints the full
contract.

**Colours a fabricated UI needs**: past the five brand roles there are six more —
`--kino-surface` (a panel raised off the page), `--kino-line` (borders, rules), `--kino-muted`
(secondary ink), and `--kino-ok` / `--kino-warn` / `--kino-danger` (the semantic triad). All derived
from the brand unless it names them, so reach for these instead of hard-coding a hex; a hard-coded
grey is a surface that stops following the palette. Figures quoted on more than one beat belong in
`spec.data`, read as `var(--<key>)` / `env.data.<key>`, so they cannot drift between surfaces.

### Real-time clocks (`--t`, not `--progress`)

**`--progress`** spans `0 → 1` over the **whole beat** — right for entrances, camera, and ambient
wash. **Wrong** for UI that should tick 1:1 with render time (scrubbers, elapsed timers, playback
position).

**`--t`** is **seconds within the beat** (same clock as the render). Use it for anything that should
advance one real second per video second:

```css
.player {
  --track-secs: 198;    /* total duration, e.g. 3:18 */
  --start-secs: 42;     /* position when beat begins, e.g. 0:42 */
  --elapsed: calc(var(--start-secs) + var(--t));
}
.scrub .fill { width: calc(var(--elapsed) / var(--track-secs) * 100%); }
.scrub .knob  { left:   calc(var(--elapsed) / var(--track-secs) * 100%); }
/* timestamp counters read the same --elapsed */
```

**Rules:**
- **One clock** for the label and the scrubber — both from `--elapsed`, never separate formulas.
- **Do not** drive elapsed time with `var(--progress) * N` — when mock VO ≠ real VO the beat length
  changes and the bar outruns (or lags) the timestamp.
- **Do not** hard-code bar `%` offsets (`21% + progress * 52%`) — derive position from
  `elapsed / track × 100%` so knob and label stay locked.
- Ambient motion (album wash, Ken Burns) can stay on `--progress` or `--t` — only the **clock UI**
  must use `--t`.

Motion may say: this arrived, this is the spoken step, this is processing, this settled for loop,
this is the pulse on that noun. Motion may not say “look at me” with no cause.

### Timing taste

- Entrances: short enough that VO is not waiting on chrome; long enough to feel intentional
- Speech-locked reveals beat fixed clocks (mock VO lies — retune after real TTS)
- Exits / settles faster than entrances; loop posters return to **native scale**
- Life after settle: quiet brands breathe via `--kino-edge`; punchy brands keep a soft wash or caret
- Prefer transform/opacity (and deliberate blur/mask). Layout thrash costs encode quality.

Weight: big windows and full-bleed washes move slower than carets and chips. Elastic/bounce is a
rare brand joke, not a default on every pulse.

**Focus and anchor are motion too.** A `blur` with `focusRadius` keyframed across the beat is a
rack focus — attention moving without the camera moving. An `anchorX`/`anchorY` away from `0.5`
makes a scale-up grow *toward* something instead of ballooning from the middle: anchor a card at
the edge it is docked to, anchor a hero numeral at its baseline. Both read as intent; a centred
uniform scale reads as a default. Neither is free — one focal move per beat, same budget as camera.
Spec surface: `docs/spec-reference.md` § Timed effects / blur focal region / Tween channels.

**Glows follow alpha, not the visible shape.** CSS `drop-shadow()` blurs the element's full
alpha silhouette — on an image plane that carries a baked or feathered shadow (a render
extract, a matte with soft falloff), the glow halos the whole soft rectangle, not the
artwork inside it. Spotlight such planes with a shaped sibling (a `border-radius` div +
`box-shadow`) hugging the real content box; keep `drop-shadow()` for elements whose alpha
IS their visible shape (text, tight-cut sprites, full rects).

Stagger only when order must be understood (pipeline steps, chip list synced to VO). Uniform
mechanical delays feel generated — vary slightly or drive from word starts.

Camera lives in a `.cam` wrapper driven by a **`cam` param** (`0→1` over 1.5–2.5s). **One camera move
per beat** — no chained pan-then-counter-pan acts. Add `.kino-camera` for velocity-blur (peaks
mid-move, sharp on settle). After `cam` reaches 1, micro-life uses `--t` / `--kino-edge` only — no
more scale changes.

**Camera easing** — set `ease` on the `cam` keyframe (spec `keyframes`, not CSS):

| Ease | Feel | Use |
|---|---|---|
| `easeOut` / `easeOutCubic` | fast start, soft land | default zoom-out settle |
| `easeOutQuart` | heavier decel | premium product reveals |
| `easeOutExpo` | snap then glide | punchy cold opens |
| `easeIn` / `easeInCubic` | slow start, fast finish | pull-back exits |
| `easeInOut` / `easeInOutCubic` | symmetric S-curve | gentle both-ends |
| `easeInQuad` / `easeOutQuad` | lighter than cubic | subtle nudges |
| `overshoot` / `spring` | bounce past target | playful brands only |

Also available in CSS: `--kino-in`, `--kino-out`, `--kino-inout`, `--kino-ease-in`, `--kino-ease-out`.

## The startframe beat (frame 0 is the thumbnail)

Feeds show **frame 0** as the cover. A piece whose first beat fades in from a blank field ships a
blank thumbnail — the most-seen frame of the video is the one nobody designed. When the piece needs
a real cover (any feed placement, any "poster first" brief), open with a **startframe beat**: a
short beat (~1.5–2.5s) that is a fully-dressed poster from its very first frame.

The discipline inverts every entrance rule above:

- **Nothing enters.** Every element renders at full opacity, final position, final size at
  `env.frame === 0` / `--progress: 0`. No rises, no fades, no draw-ons.
- **Numbers are final.** A count-up on a poster is a spoiler of its own beat — bake the end values.
  Let the *next* beat re-reveal them with motion if the piece needs the ceremony.
- **Life is ambient only.** Drive everything from `env.t` / `--t` and `env.edge`: speck drift,
  slow ramp-hue drift, a breathing halo. The poster must read alive in motion yet complete as a
  still — both are shipping surfaces.
- **Compose it as the piece's index.** Sample the hero claim plus one artifact from each act
  (the stat, the chart motif, the mark) — a cover that could only belong to this video.
- **Hand off with a shaped transition.** If the next beat shares the poster's layout, a plain
  dissolve overlaps two same-position lockups into mud for several frames — cut through an `iris`
  or another shaped reveal instead.

QA: `kino still <spec> --at 0` — judge frame 0 as a poster (hierarchy, balance, legibility at
thumbnail size), then `--around` the handoff to confirm the poster never visibly "arrives".

## Spoof UI as interaction theater

Ads are not clickable, but the surface still needs **readable states** across the beat:

| Beat-time state | Design for it |
|---|---|
| Idle / ready | Loop poster, empty field, solid caret policy |
| Entering | Opacity/scale path that finishes before the first critical word |
| Speaking / typing | Burst type or word gates; caret solid while keys land |
| Highlighted step | Pulse + chip/row emphasis on the spoken noun |
| Settling | Clear thresholds on `progress` (never `=== 1`); seam match |

Empty and “done” must look intentional. A half-typed field with a dead caret at loop point is a bug.

On-screen microcopy follows `ad-voice`: one clear verb on CTAs, no filler, sentence case, no
desperate punctuation. Chrome labels must use the **same nouns the VO speaks** or chips will lie.

## Liquid glass (real refraction, not frosted blur)

`backdrop-filter: blur()` is *frosted* glass (glassmorphism) — a uniform fog. Apple **Liquid Glass**
*refracts*: it bends/magnifies the background at the edges, disperses color, and catches light on
a lit rim. In kino this is an engine material: add **`class="kino-lens"`** to a positioned
element and the engine renders a true per-pixel refraction mirror behind it (WebGL rounded-rect
SDF lens over the frame's background canvas: warp at the rim, clear center, chromatic dispersion,
luminous film). Copyable reference: **`assets-lib/motion/liquid-glass.html`** (bare id `liquid-glass`).

Do NOT hand-roll it with backdrop-filter: Chromium's compositor cannot run `feImage` displacement
maps in backdrop chains (they silently degrade to a uniform shift with mirror-fold artifacts), and
feOffset strip approximations ghost on hard edges. `kino-lens` is the only correct path.

Craft rules:
- Element background stays transparent — the film lives in the mirror (`--glass-film`); content at
  `z-index ≥ 1`; pair with a bright ~`0.55` border + diagonal sheen (`::before`) for the lit edge.
- Knobs (per-frame CSS vars, tweenable via params/keyframes): `--glass-strength` (px, 26),
  `--glass-band` (px, max(radius,48)), `--glass-chroma` (0.07), `--glass-profile` (2.2),
  `--glass-frost` (px, 0 — body frost), `--glass-edge-blur` (px, 0 — extra rim blur),
  `--glass-film`, `--glass-saturate` (1.25), `--glass-brightness` (1.06).
- Silhouette follows `border-radius` — keep the glass node axis-aligned (no CSS `rotate`/`skew`).
- Needs a STRUCTURED, colorful background (shader like `liquid-orb`, or a Canvas2D draw fn) —
  refraction of a flat field is invisible. Over avatar/app footage the mirror skips gracefully.
  Authoring the stage itself → `skills/shader-backgrounds` (vesper / old-light craft bar).
- Stress-test with a straight-line background (grid/stripes shader): rim must BEND lines into
  curves, not shear or ghost them.
- Mask-shaped refraction on footage → `region-glass.frag` (`docs/segmentation.md`), not motion morph knobs.

Deterministic (synchronous WebGL inside the seek), sanitizer-clean (it's just a class). It's a
statement material — don't reach for it on every panel; frosted `blur()` is still right for quiet,
dense UI.

## Generic-tell sniff (fix the reflex, not the pixel)

If a stranger could say “AI ad template” in two seconds, stop polishing glow and change the
decision that caused it.

Common kino odors:

- Violet/cyan energy gradients / stock **mesh** behind caption cards with no custom stage
- Equal feature tiles / chip rows with no spoken priority
- Frosted glass everywhere instead of a depth plan
- Oversized orphan stats with no product artifact
- Bounce/elastic on every pulse
- Centered everything because no composition was chosen
- Domain costume only (journal = cream serif; CLI = pure green phosphor) with zero specific artifact
- Chrome recycled from the last promo (wrong mark, wrong filename, wrong kicker)

Wanted instead: a color commitment level, type with a reason, one domain artifact, motion that
explains speech or settle, and a first frame that could only be this product.

## Craft loop (truthful completion)

1. Sketch the beat job + artifact in one sentence.
2. Implement in `assets/motion/…` using brand tokens + `vw`.
3. `kino still <spec> --segment N` — hierarchy / safe zone / caption clearance. Overlay a mental
   3×3 grid: any empty row/column or ≥25% dead band → fix fill budget + alignment before moving on.
   For centering/alignment specifically, add `--measure` (with `data-measure` tags) and read the exact
   Δ-from-center — don't eyeball it.
4. `kino still … --around <t>` (or harness) — entrance, speech lock, camera, pulse.
5. Real VO → `build --tts` (caches it) → `inspect --real` → `retune` → `frames <mp4> --around <t>`.
6. Loop ads: still at 0 vs settle end; trust PSNR/seam, not raw AE.
7. Only claim “improved hierarchy / motion / color” when the sheet or mp4 shows it.

**Run this loop more than once.** A still sheet costs ~1.7s (see `video-production`), so the budget
is not the constraint — the instinct to stop after the first render is. If you have looked at one
sheet, you have not iterated; you have checked. Expect several passes on anything that ships.

**A passing check is not a good frame.** The most common way this loop fails is building a
*correctness* measure — did it animate, did the physics settle, are the elements on screen — and
then trusting it past its remit. Those questions all answer yes on a frame that is flat, unlit,
badly composed and dead in the last third. When you write a harness to verify a beat, it measures
what you told it to; it has nothing to say about whether the shot is any good, and only your eye on
the sheet does. Ask both questions separately, and ask the second one out loud:

> Composition — is anything anchored, or did elements land where the code happened to put them?
> Material — is there light direction, contact shadow, depth, edge? Or flat fills on a flat plane?
> Staging — does the geometry the code knows about (walls, guides, bounds) appear in the frame at
> all? A viewer who cannot see what an element is reacting to reads the motion as arbitrary.
> Timing — does anything happen in the last third, or did it all arrive at once and stop?

Scope: if the user asks to fix one caret, do not restyle the whole window. If they ask for a visual
pass on the beat, run the full checklist above.

## Related

- `docs/motion-graphics.md` — CSS/JS contract, lint, helpers
- `skills/speech-synced-ui` — typing grain, camera, seamless loop, retune
- `skills/video-production` — trailer structure, brand discovery, ship gate
- `skills/adversarial-critique` — overlap / safe-zone frame QA
- `skills/shader-backgrounds` — WebGL `.frag` stages, texture sampling, glass pairing
- `assets-lib/motion/` — copyable pages to adapt, not paste blindly
