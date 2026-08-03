# Blind-board gap analysis

**Method.** Three subagents each wrote a beat-by-beat board for a different ad, with no access to
this repo and no knowledge that kino exists — instructed to direct the piece they actually wanted
and never to soften an ask for buildability. The only constraint was "digital/animated, no live
shoot, no licensed music." Each returned a tiled beat board plus an exhaustive numbered list of the
technical capabilities the board demands, with a failure note per item.

| Board | Piece | Reqs |
|---|---|---|
| `blind-board-kettle.md` | 30s vertical, fast-cut fintech app ad — riso/receipt world, coin physics | 43 |
| `blind-board-relay.md` | 45s landscape, developer-tool product film — 8 fabricated UI surfaces, 2 cuts | 44 |
| `blind-board-vesper.md` | 30s vertical, cinematic wearable brand film — titanium, near-black, one VO line | 36 |

123 demands total. Every one was adjudicated against the spec schema, the compositor source, or a
real render. Boards and probe evidence: see the session scratchpad and `projects/dogtest/specs/{css3d,prim,dark}-probe.json`.

---

## 1. Audio is three fixed slots, and every board treated sound as structure

This is the strongest signal in the exercise: **all three boards independently made the sound edit
load-bearing**, and all three are inexpressible.

`Music` is `.strict()` — `{ src, volume, duck, fadeInSec, fadeOutSec, startSec }`
(`src/spec/schema.ts:226`). One track, one level, no automation track of any kind.
`SfxEvent` is `.strict()` — `{ src, at, volume }` (`src/spec/schema.ts:220`).

What the boards asked for:

- **Relay 40** — a composed arc with named events: sub-bed throughout, bell ostinato in at 5s, kick
  in at 20.2s, full dropout at 33.6s, return at 39s, four frames of silence at 42.4s. Needs a
  volume automation curve, or stems. Neither exists.
- **Vesper 32** — a *subtractive* edit: four ambience layers (mains hum, HVAC, 8kHz whine, traffic)
  removed one at a time on picture cues at 3.1s / 4.0s / 5.0s. Needs four independent beds. There
  is one.
- **Kettle 17** — hard audio gating as an instrument: total dropouts at 9.00s and four frames before
  the shear. `duck` fires automatically on VO spans; there is no way to gate the bed at an authored
  time.
- **Kettle 37** — 63 coin-drop samples panned to each coin's on-screen x. `sfx` has no pan.
- **Relay 12** — voice-limited, pitch-randomized playback for 60 tile-flips in 2.6s; without
  randomization it's "a machine-gun of identical clicks." `sfx` has no pitch/rate.
- **Relay 20** — the click SFX must land on the mousedown *frame*. `sfx[].at` is absolute seconds
  on the main timeline; motion `keyframes`/`triggers` accept `atWord` and ride real TTS with no
  retune, but **`sfx` does not** — so every effect needs a `kino retune` pass after real VO. This
  asymmetry is the cheapest fix on this page.
- **Vesper 34 / Relay 42** — VO mixed *under* the bed. `duck` only lowers the bed; VO has no gain.

The engine already has `kino sync` (beat-grid retiming) and `kino audio-markers` (onsets, peaks,
RMS, bpm grid) — the analysis side is strong. The *authoring* side stops at three slots.

## 2. Nothing in the render can react to the audio

Kettle 23 (counter and logo scale ±1.5–3% on the kick) and Kettle 24 (transient-driven camera shake,
explicitly "random shake feels applied; transient-driven shake feels caused") both need a per-frame
audio envelope in the motion graphic. There is none — no `--kino-audio`, no `env.audio`.

Notable because `kino audio-markers` **already computes** `rms[]`, `onsets[]`, `peaks[]` and a
kick-band `grid`. The gap is a bridge, not an analysis: sample the envelope per frame and inject it
alongside `--pulse`. Today the only path is hand-placing a `trigger` per transient from the markers
JSON.

## 3. The grade is three scalars

`gradePass` (`src/render/native/page/compositor/effects/grade.ts`) is exactly
`brightness` → `contrast` → `saturation`, applied identically to all channels.
`EFFECT_KINDS` is `["blur", "glow", "grade", "motionBlur"]`.

- **Relay 29** — a night→morning colour-*temperature* ramp (7200K → 5000K) across a composited UI,
  *with the syntax greens and status reds protected*. No temperature/tint axis; no hue-selective
  qualifier. The beat is a 1.8s six-hour ellipsis carried entirely by the grade, and it can't be built.
- **Vesper 12** — a filmic transform with a controlled toe holding separation in the bottom 5%.
  70% of that film sits below 10 IRE. `contrast` pivots around 0.5 and clamps; there is no toe,
  no lift/gamma/gain, no curve, no LUT.

Also worth knowing: `postFx` is whole-video and has **no keyframe track**. The only grade you can
animate is a per-segment `effects: [{ kind: "grade", keyframes: [...] }]`.

## 4. Film grain is one scalar for the whole video

**Vesper 14** wants grain coarse and alive in beat 1 and near-zero at the ident, with per-beat
intensity *and size*. `film` is a single `0..1`; the `film` adjustment layer is base-group and spans
the whole composition by construction (`fromSec`/`segment`/`opacity` are all rejected alongside
`adjust`). So per-beat grain isn't expressible, and grain *size/response* isn't a parameter at all.

Adjacent, same beat: **Vesper 15** wants wavelength-aware halation (red bleeding furthest);
`postFx.bloom` is achromatic. **Vesper 16** wants veiling glare that lifts blacks only while a bright
element is on screen — "glare that responds to content is how the audience believes there is a lens;
constant glare is a preset."

## 5. No state between frames, so no simulation of any kind

Tier-2 is a pure `(env) → string` evaluated fresh every frame, with `Math.random`/`Date.now`/timers
lint-rejected. That is the right call for determinism, and it is also a hard ceiling:

Kettle 5, 6, 7, 9, 10, 12, 15 (rigid-body fragment, 63-piece fracture, multi-hundred coin sim with
restitution and roll-to-rest, zero-G reversal, magnetic funnelling, fluid steam, thin-shell paper
crumple with self-collision) and Relay 11 (60 tiles re-clustering under spring physics with mass and
damping) all need integrated state.

The sanctioned substitutes do exist — closed-form damped springs from `env.progress`,
`env.lib.noise2D/3D/4D` for stateless organic motion, and a **baked** sim array embedded in the
`.js` file and indexed by frame. Relay 11 is fully reachable that way. None of that is written down
anywhere, so an agent hits the lint and concludes "physics is impossible" rather than "physics is
precomputed." This is a docs/recipe gap sitting on top of a real engine boundary.

## 6. Near-black gradients band — measured

Vesper's #2 load-bearing ask is a 16-bit dithered pipeline, because "beats 1, 7 and 8 are all
near-black gradients." Rendered `#000 → #0a0a10 → #000` full-frame and sampled the centre column:

- 22 distinct values over 1920 rows
- single-value plateaus of **30–48px** between steps

Chromium contributes some ordered dither at the gradient itself (the 1–2px alternating runs), but
there is no dither stage in the compositor or at encode, and the plateaus are plainly visible in the
still. Reproduce: `projects/dogtest/specs/dark-probe.json`.

## 7. No shared data across beats

**Relay 36** requires `19/412`, `4.6%`, `50ms`, `61–74ms`, `68ms`, `300 runs`, `#4192`, `#4207` to
agree across eight surfaces — "engineers pause films like this; one contradiction and the product
looks like it doesn't work." Each motion file is standalone and `params` are per-beat, so those
figures get retyped in five files and drift silently. A spec-level constants block readable by every
motion graphic would close it.

## 8. The five-role palette is caption-sized, not UI-sized

Motion graphics receive exactly `--kino-bg/-fg/-accent/-accent2/-deep`. **Relay 35** enforces
reserved-colour grammar across eight fabricated surfaces: green and red for build state only, amber
for Relay's own voice, plus dim-fg, borders, and a purple merged state — eight or nine semantic
roles. Past five you hard-code hexes into the HTML and the brand stops driving the look.

## 9. Two moving clips can't be on screen at once

`planMediaJobs` (`src/render/native/videoFrames.ts:54`) frame-extracts only: avatar windows, a
`video` beat's own source, `regionShader.masks[]`, and `regionShader.backdrop`. Beats are sequential;
declared layers reject footage outright with a build error; `regionShader` splits one frame by a
*segmentation* mask, not an analytic rect. So the only two-source composite is
cutout-subject-over-backdrop. No rectangular split-screen, no picture-in-picture.

## 10. Per-element motion blur inside a motion graphic

The `motionBlur` effect derives `angle`/`distance` from measured **layer** travel, and
`transitionCamera.blur` smears across a cut. Neither reaches an element moving *inside* a motion
graphic — Kettle 26/27 (whip-spun blade, flipping coin, 4000px/s type) get nothing.

---

## Traps found while probing — none of these are in the boards, all are in the docs' blind spot

**`backface-visibility` is silently ignored — and nothing else about CSS 3D is.** A first pass
suggested `preserve-3d` was broken too; an isolating probe (`projects/dogtest/specs/css3d-diag.json`)
showed otherwise. `perspective`, `rotateX/Y`, `translateZ` and `transform-style: preserve-3d` all
work, including a nested counter-rotated child inside a rotated parent — a child at `translateZ(240px)`
really does render larger than one at `-240px`. Only the backface cull is dropped, so a flip paints
both faces and DOM order wins. That is the worst possible combination: the author gets working 3D
*just far enough* to trust it, and the failure hides until the card turns. Nothing in `docs/` or
`skills/` mentioned `perspective`, `preserve-3d` or `backface` at all.

**FIXED** — `lintBackfaceVisibility` (`src/render/motionLint.ts`) now rejects it on both tiers with a
message naming the verified substitute (gate each face's `opacity` off the flip driver; keeps real
3D, correct perspective, non-mirrored back face — `projects/dogtest/specs/flip-fix.json`).
`docs/motion-graphics.md` gained a [CSS 3D](motion-graphics.md#css-3d-what-works-and-the-one-thing-that-doesnt)
section covering both halves.

**`backdrop-filter` is dead** (matches the known compositor matrix; `kino-lens` is the substitute).

**Nine common primitives that all work** — worth documenting as a green list, since agents avoid them
on suspicion: `mix-blend-mode`, `filter: blur()`, `clip-path` off `--progress`, SVG `<textPath>`,
`-webkit-text-stroke`, `mask-image` gradients, `box-shadow` glow, animated `conic-gradient`, and
`perspective`/`rotateY`. Repro: `projects/dogtest/specs/prim-probe.json`.

**`motionBlur` is undocumented.** It is a real fourth effect kind (`src/render/maskSpec.ts:69`) and
there is a top-level `motionBlur: boolean` spec field (`src/spec/schema.ts:521`,
`src/render/props.ts:285`). Neither appears in the spec-reference effects table or the top-level
field table — the only mention is an aside at `docs/spec-reference.md:298` about keyframing it.

**Two dangling skill symlinks.** `.claude/skills/3d-scenes` and `.claude/skills/segmentation` both
point at `skills/` targets that don't exist, so neither skill loads in this checkout.

**The 0.32s inter-beat gap freezes the outgoing raster.** Documented, but it is precisely what
Relay 2 and 39 need to survive: a blinking cursor and a "stillness that stays alive" die at every
boundary unless `carryMotion: true`. Three of Relay's best beats and four of Vesper's depend on it.

---

## What kino won

The boards were blind, so where they demanded something kino already does well, that's a clean
validation rather than a coincidence:

- **Relay's #1 top-3 ask** — per-character terminal/diff typing at machine cadence with real content
  — is kino's flagship `env.words` burst typewriter, and `atWord` anchoring resolves against real
  TTS with no retune. Relay 41 and Kettle 20 both asked for frame-accurate VO-to-UI sync at named
  words; kino does it better than either board imagined it would be done.
- **Kettle 19** (frame-accurate edit-to-music lock on a 150 BPM grid) is `kino sync`.
- **Kettle 42** (seamless loop, frame 1 ≡ final frame) is `seamlessLoop`, PSNR-gated.
- **Relay 27 / Kettle 24** (motion-blurred whip between panes) is `transitionCamera` with `whip-*`,
  `blur` and `hold`.
- **Kettle 30** (match-cut on silhouette) is a custom `transitionSource` shader.
- **Relay 13/15** (scatter and line charts drawing on) is `env.lib.shape` + `env.lib.color`.
- **Vesper 29** (no reserved platform-chrome bands) is already house doctrine.

## Out of scope by design — naming it so it isn't mistaken for a gap

Vesper 1–11, 17–20, 22–24 and Kettle 8/32 want a path tracer: anisotropic multi-lobe GGX with swept
brush grain, complex-IOR titanium, authored HDRI with reflection parallax, inter-reflection bounces,
in-camera aperture DOF with bokeh shape, volumetric media, cloth sim with fibre sheen. A raymarched
`.frag` background (or a `shader` declared layer) reaches a surprising amount of this — GGX, an
authored three-light environment, thin-film iridescence and shaped bokeh are all writable in GLSL —
but it is shader authoring, not a scene graph, and nothing in the skills points an agent there for
*product hero* work specifically. The honest boundary: kino is a deterministic browser compositor
with a shader escape hatch, not a DCC.

---

## Backlog, sorted by difficulty

Difficulty is grounded in the actual implementation, not guessed. Two structural facts make the
audio tier much cheaper than it looks: `musicVolumeAt` (`src/render/audio.ts`) is already a **pure
per-sample gain function**, and `buildAudioTrack` already runs **before** the frame loop
(`src/render/native/engine.ts:553`, in a `Promise.all` with media prep) — so anything derived from
audio can reach the renderer without reordering the pipeline.

### Tier 0 — docs only, no engine work ✅ done

1. ~~**Document the CSS-3D boundary.**~~ Done — and the finding narrowed on isolation: everything
   works except `backface-visibility`.
2. ~~**Green-list the working primitives.**~~ Done — nine verified, plus `backdrop-filter` marked dead.
3. ~~**Document `motionBlur`.**~~ Done — effects table row (params verified against
   `effects/motionBlur.ts` and `layers.ts`, not the doc aside) plus the top-level field.
4. ~~**Write the baked-simulation recipe.**~~ Done — frame-indexed array + the size caveat.
5. ~~**Document closed-form springs.**~~ Done — exact damped-oscillator solution, so per-element mass
   needs no state.

### Tier 1 — one schema field + one filter string or a few shader lines

6. **`sfx` pan.** The sfx chain is a single interpolated string (`audioMix.ts:60`); add `pan=stereo|…`.
   Unblocks Kettle 37.
7. **`sfx` rate/pitch.** Same line — `asetrate`/`atempo`. Unblocks Relay 12's pitch-randomized
   60-event burst.
8. **`sfx` fade in/out.** Same line — `afade`.
9. **Grade temperature + tint.** `grade.ts` is a 25-line shader with three uniforms; add two.
   Half of Relay 29.
10. **Grade lift/gamma/gain (or a shadow/highlight split).** Same shader, a few more lines.
    Vesper 12's filmic toe.
11. **Per-channel bloom radius** for halation (red bleeding furthest). Bloom pass already exists.
    Vesper 15.
12. **Spec-level shared constants.** A `data` block merged into every motion host as vars /
    `env.data`. Closes Relay 36's cross-surface consistency problem. Props already carry per-beat
    params; this is the same wiring one level up.
13. ~~**Lint on `backface-visibility`.**~~ ✅ done — `lintBackfaceVisibility`, both tiers, comments
    excluded so a commented-out line doesn't fail the build. Not `preserve-3d`: that works.
14. **Extra palette roles.** Injection is mechanical; the design question (which roles a spoof-UI
    design system needs) is the actual work. Relay 35.

### Tier 2 — small new plumbing, pipeline already cooperates

15. **Music volume automation.** Add a `keyframes` track to `MusicVolumeOpts` and evaluate it inside
    `musicVolumeAt`. ~20 lines. **Single best ratio on this page** — it alone unblocks Relay 40's
    named arc, Kettle 17's silence gates, and most of Vesper 33.
16. **Multiple music beds / stems.** `music` becomes an array; `shapeMusicBed` runs per bed and each
    adds a `mixLabel`. The mix graph is already N-input. Unblocks Vesper 32's subtractive edit.
17. **`atWord` on `sfx[]`.** The resolver exists for motion keyframes; the only real work is deciding
    the schema shape, since a top-level sfx has no implicit beat (`{ segment, atWord }`). Kills a
    whole `retune` pass on every spec with placed effects.
18. **VO gain.** Vesper 34 / Relay 42 both want the voice mixed *under* the bed; `duck` only moves
    the bed.
19. **Output dither.** Encode is `-pix_fmt yuv420p` at `-crf 18` with no dither stage; measured
    30–48px plateaus in near-black. Either an ordered-dither pass in the final compositor stage or an
    encode-side flag.
20. **Audio envelope var** (`--kino-audio` / `env.audio`). `kino audio-markers` already computes
    RMS/onsets/kick-grid, and `shapeMusicBed` already decodes the bed to PCM before frames render.
    The work is computing a per-frame envelope there and threading it into props beside `--pulse`.
    Unblocks Kettle 23 and 24.

### Tier 3 — real work, well-scoped

21. **Per-beat film grain.** The `film` adjustment layer is base-group and spans the whole
    composition by construction — `fromSec`/`segment`/`opacity` are all rejected alongside `adjust`.
    Windowing it means touching that emission path. Vesper 14.
22. **Grain size / response parameters.** Currently a single intensity scalar with no controllable
    structure.
23. **Content-responsive veiling glare.** Needs a luminance measure of the composite feeding the
    lens stage. Vesper 16.
24. **Declared video layers → real footage.** `planMediaJobs` walks segments and avatar windows but
    never `spec.layers`; the build error says so explicitly. Fixing it unlocks declared video layers
    generally **and** is the prerequisite for split-screen / PiP.
25. **`mask.source.kind: "file"`.** `planMaskJobs` already extracts the frames; nothing ever binds
    them into a texture, so validation rejects the kind outright. A binding gap, not a missing feature.
26. **Hue-selective grade qualifier.** The other half of Relay 29 — protecting the CI greens and reds
    through a temperature ramp needs a qualifier, not just more global axes.

### Tier 4 — architecture

27. **Per-element motion blur inside a motion graphic.** `motionBlur` derives from measured *layer*
    travel; an element moving inside the raster gets nothing. Needs either sub-frame rasterization
    (N× raster cost per frame) or a velocity buffer out of the DOM. Kettle 26/27.
28. **Two live clips in one frame** (rectangular split-screen / PiP). Depends on #24, then needs a
    compositing model for concurrent footage layers — beats are sequential today.
29. **`captionAnimation` in the native raster.** Already documented as a known architecture gap: the
    keyed word-raster only ever captures the settled pose, so entrance springs need per-frame dynamic
    cadence or an animated quad.
30. **A real simulation pathway.** Not "make Tier-2 stateful" — determinism is correct and worth
    keeping. The honest version is an offline bake step: run a solver once, emit a frame-indexed data
    file, replay it deterministically. Tier 0 item #4 is the cheap 80% of this.
