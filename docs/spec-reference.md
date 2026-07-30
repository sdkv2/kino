# Spec reference

A **spec** is the JSON file that describes one video. kino validates it, generates voiceover, optionally renders a presenter, and composites everything with its deterministic frame engine. This page documents every field of the spec, plus the `brand.md` and `project.json` configs it resolves against.

The schema is enforced by [`src/spec/schema.ts`](../src/spec/schema.ts) (zod) — invalid specs fail the build with a precise error.

- [Top-level fields](#top-level-fields)
- [Segments](#segments) — [scene](#scene-segment) · [video](#video-segment) · [motion](#motion-segment)
- [Captions](#captions)
- [Text overlays](#text-overlays)
- [Masks and effects](#masks-and-effects) — [timed effects](#timed-effects) · [blur focal region](#blur-focal-region) · [tween channels](#tween-channels)
- [Layers](#layers) — [source kinds](#source-kinds) · [z scale](#z-scale) · [adjustment layers](#adjustment-layers)
- [Post FX](#post-fx)
- [Keyframes & triggers](#keyframes--triggers)
- [Backgrounds](#backgrounds)
- [Sound effects & music](#sound-effects--music)
- [brand.md](#brandmd) · [project.json](#projectjson)
- [Examples](#examples)

## Top-level fields

| Field | Type | Required | Meaning |
|---|---|---|---|
| `title` | string (kebab-case) | ✅ | Output basename; must match `^[a-z0-9-]+$`. |
| `segments` | [Segment](#segments)[] | ✅ | The beats, in order (≥ 1). |
| `brand` | string | — | Brand name; falls back to the project's `project.json` brand. |
| `format` | `("9:16"\|"3:4"\|"16:9"\|"9:16-4k"\|"3:4-4k"\|"16:9-4k")[]` | — | Output formats. Default `["9:16"]` (1080-class). `*-4k` = UHD **output** (e.g. `9:16-4k` → 2160×3840) composed at the 1080-class canvas — same frame, 4× the pixels. Motion layouts adapt via `--kino-aspect`. |
| `fps` | int 1–120 | — | Composition frame rate. Default `30` — fine for talking-head and motion work, and cheap. Raise it when the source cadence matters: 60fps footage (and a 60fps `kino segment` mask tracking it) is otherwise sampled every other frame. Render cost scales with it — every frame is a real browser paint. |
| `voice` | string | — | ElevenLabs voice id or a `brand.voiceAliases` alias. |
| `fontWeights` | int[] 100–900 | — | Extra cuts of the brand font to stage, so `font-weight` in a motion page selects a real face instead of silently reusing the single caption cut. The caption weight is always included. **Overrides** brand `fontWeights` rather than merging — pass `[]` to opt a lean spec out of a type-heavy brand's set. Each cut is base64-inlined into every raster, so ask only for what you use. |
| `voiceModel` | string | — | ElevenLabs TTS model. Default is v3 (inline audio tags `[excited]`, `[whispers]`, `[short pause]`, … work in segment `text`; tags are stripped from word-synced captions). Set `eleven_multilingual_v2` for more timing-stable / metronome-critical reads. |
| `film` | number | — | Cinematic-finish intensity (vignette + grain over photographic/app beats), `0..1`. Default `1` (graded film look). Set `0` for clean flat edges — e.g. a light "paper" video where the edge vignette reads as a dark border. Motion-graphic beats are never graded. |
| `avatarLook` | string | — | HeyGen: look alias/id · Hedra/Replicate: portrait image path/url. |
| `provider` | `none\|heygen\|hedra\|replicate` | — | Presenter engine for `avatar:` sources; overrides `brand.defaultProvider`. See [Avatars & presenters](avatars.md). |
| `background` | `glow\|image\|mesh\|aurora\|particles\|grid\|solid\|custom` | — | Faceless background; overrides `brand.background`. Prefer `custom` + `backgroundComponent` over stock `mesh` for brand identity. |
| `backgroundComponent` | string | — | Draw-fn for `custom`: bare id (`brand-wash`) or path. Spec overrides `brand.backgroundComponent`. |
| `backgroundTextures` | (string \| `{source, param}`)[] | — | Up to 4 texture channels for a shader background (`uTex0`..`uTex3`): image paths upload as-is; `.html` files are sanitized + rasterized DOM (fonts/palette apply). `{source, param: "name"}` re-rasterizes the html every frame at that background param's value (0..1 → the markup's 1s CSS `@keyframes`) — true per-frame animation. Shader backgrounds only. |
| `backgroundIntensity` | number | — | 0..1 motion-strength override. |
| `backgroundKeyframes` | [BgKeyframe](#keyframes--triggers)[] | — | Tween background params over time. |
| `backgroundTriggers` | [BgTrigger](#keyframes--triggers)[] | — | One-shot background actions (e.g. `pulse`). |
| `captionStyle` | `stroke\|highlight\|gradient\|minimal` | — | Caption look preset; overrides `brand.captionStyle.style`. Default `stroke`. See [Captions](#captions). |
| `captionAnimation` | `pop\|rise\|typewriter\|wave\|blur-in\|none` | — | Caption entrance preset; overrides `brand.captionStyle.animation`. Unset = the surface's native entrance (`pop`; `rise` for presenter-less hero text). See [Captions](#captions). |
| `captionReveal` | `word\|all` | — | Words-mode reveal: `word` (default, one word at a time) or `all` (whole line laid out, active-word highlight tracks VO). See [Captions](#captions). |
| `captionMode` | `phrase\|words` | — | Caption mode; overrides `brand.captionMode`. See [Captions](#captions). |
| `sfx` | [SfxEvent](#sound-effects--music)[] | — | Free-placed sound effects. See [Sound effects & music](#sound-effects--music). |
| `music` | [Music](#sound-effects--music) | — | Music bed under the VO, auto-ducked while segments speak. See [Sound effects & music](#sound-effects--music). |
| `seamlessLoop` | boolean | — | Loop-ad contract: last beat must be `kind:"motion"`; validate warns if `film` unset/`>0` or first/last motion sources aren't a ready-state pair; post-build compares first/last frame RGB (warn only). Prefer `"film": 0`. Not the same as segment `loop` (Lottie playback). |
| `postFx` | [PostFx](#post-fx) | — | Full-frame post stage over the finished composite (compositor only). See [Post FX](#post-fx). |
| `layers` | [DeclaredLayer](#layers)[] | — | Author-declared layers, slotted into the built-in stack by z. See [Layers](#layers). |

> There is no built-in `logo`/`logoSize`/`logoPosition`/`logoKeyframes` field anymore. A persistent
> brand mark is now an ordinary [declared layer](#layers) — with strictly more control (rect,
> opacity, blend, mask, effects, its own keyframe track):
> ```jsonc
> "layers": [{
>   "id": "brandmark", "z": 1000,
>   "source": { "kind": "image", "src": "logo.png" },
>   "rect": { "x": 44, "y": 4, "w": 12, "h": 12 },
>   "keyframes": [{ "at": 0, "params": { "opacity": 0 } }]
> }]
> ```

## Segments

Every segment is one beat. `kind` selects the beat type; **omit it for a `scene`**, the ordinary beat. Two fields recur and are easy to confuse:

- **`text`** — the **spoken** voiceover for the beat (drives VO + timing). **Optional.** Omit it for a
  purely visual beat — a title card, a logo sting, a shape morph — and give **`dur`** instead: the beat
  then speaks nothing, produces no words and no caption, and occupies `dur` on the audio timeline.
  **`dur` is not the beat's rendered length.** Beats are separated by a fixed **0.32s** gap, and a
  beat's visuals are held until the next beat starts so nothing blinks off during that silence — so
  every beat except the last renders for `dur + 0.32`, and `--progress` spans that longer window.
  `"dur": 3.4` renders for 3.72s, which is what `kino inspect` reports as `durSec` (alongside
  `interBeatGapSec`); derive `--around` times and keyframe `at` values from that, not from `dur`.
  Under real TTS an
  omitted `text` makes no API call, so a spec can speak on some beats and stay silent on others.
  A beat with neither `text` nor `dur` (nor a `voFile`) is rejected — nothing would define its length.
  Note that an unspoken beat also has no word timings, so nothing anchored to words (`atWord`,
  `--kino-words-shown`, `env.words`) fires on it — drive that beat off `--progress` instead.
- **`caption`** — the **on-screen** text. Optional on every kind: omit it and the beat renders no caption line at all (the VO still speaks `text`). In `captionMode: "words"` the synced spoken words render regardless of `caption` — under a words-mode brand, set `"captionMode": "phrase"` on the beat (and omit `caption`) for a fully caption-free beat.

### `scene` segment
The default beat: voiceover and captions over a [background](#backgrounds), optionally with an AI presenter composited on top. Omit `kind` and you get one.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `kind` | `"scene"` | — | Default when `kind` is omitted. |
| `source` | presenter scheme | — | Put a presenter on this beat: `"avatar:"` uses the configured provider, `"heygen:look-id"` / `"hedra:portraits/founder.png"` / `"replicate:"` pin one (anything after the colon is the look). Omit for no presenter. A file path here is an error — that is a [`video`](#video-segment) beat. |
| `text` | string | — | Spoken VO. Omit for a silent beat (then `dur` is required). |
| `caption` | string | — | On-screen caption; omit for none. |
| `voFile` | string | — | Imported real VO for this beat: project audio asset used instead of TTS (word timings via Scribe or local whisper.cpp — see [Audio](audio.md#imported-real-voiceover-vofile)). |
| `cta` | boolean | — | Mark as a call-to-action / end-card beat. With no presenter: centered hero (not lower-third). Default `false`. |
| `shot` | [Shot](#enums) | — | Camera move. |
| `captionMode` | `phrase\|words` | — | See [Captions](#captions). |
| `emphasis` | string[] | — | Words to emphasise in `words` mode. |
| `captionKeyframes` | BgKeyframe[] | — | Tween the caption — see [Tween channels](#tween-channels). |
| `motionOverlay` | [MotionRef](#motion-segment) | — | Layer a motion graphic over this beat. |
| `captionStyle` | `stroke\|highlight\|gradient\|minimal` | — | Caption look preset for this segment; see [Captions](#captions). |
| `captionAnimation` | `pop\|rise\|typewriter\|wave\|blur-in\|none` | — | Caption entrance preset for this segment; see [Captions](#captions). |
| `captionReveal` | `word\|all` | — | Words-mode reveal for this segment; see [Captions](#captions). |
| `texts` | `{ text, at, dur?, position?, size?, style?, animation? }[]` | — | Standalone text overlays; `at` is seconds from segment start. See [Text overlays](#text-overlays). |
| `blend` | `normal\|screen\|multiply\|add` | — | Accepted by the schema, but a `scene` beat has no content layer of its own to apply it to (background + optional presenter only) — it validates and threads through, with no visible effect. Use `video`/`motion` for a beat that should actually blend. |

### `video` segment
Footage, a screenshot, or any other video source cut in full-frame, with an optional caption (and optional kicker label).

| Field | Type | Required | Meaning |
|---|---|---|---|
| `kind` | `"video"` | ✅ | |
| `source` | string | ✅ | Project asset path (`.mp4`/`.mov`/`.jpg`/`.png`). A presenter scheme (`"heygen:…"`) is also accepted here and resolves to a [`scene`](#scene-segment) with that presenter. |
| `text` | string | — | Spoken VO. Omit for a silent beat (then `dur` is required). |
| `caption` | string | — | On-screen caption; omit for none. |
| `voFile` | string | — | Imported real VO for this beat: project audio asset used instead of TTS (word timings via Scribe or local whisper.cpp — see [Audio](audio.md#imported-real-voiceover-vofile)). |
| `kicker` | `{ text, color }` | — | Small label; `color` ∈ `accent\|deep\|accent2` (default `accent`; legacy `mint\|green\|gold` still accepted for the same slots). |
| `shot` | [Shot](#enums) | — | Camera move (e.g. `scroll` for long screenshots). |
| `transition` | [Transition](#enums) | — | In/out transition for the cut-in. |
| `clipFrom` | number ≥ 0 | — | Start reading a video asset at this source second. |
| `clipTo` | number | — | End of source window (must be `> clipFrom` when both set). |
| `speed` | number > 0 | — | Playback rate (default `1`). `<1` = slow-mo. Tune after beats exist. |
| `pauseAt` | number ≥ 0 | — | Seconds from **segment start** — freeze that frame for the rest of the beat. |
| `frame` | `{ src, inset: { x,y,w,h } }` | — | Chrome overlay: footage in `inset` (% of composition); `src` is full-bleed PNG/WebP on top. `x+w` and `y+h` ≤ 100. |
| `captionMode` | `phrase\|words` | — | See [Captions](#captions). |
| `emphasis` | string[] | — | Emphasised words (`words` mode). |
| `captionKeyframes` | BgKeyframe[] | — | Tween the caption — see [Tween channels](#tween-channels). |
| `kickerKeyframes` | BgKeyframe[] | — | Tween the kicker — see [Tween channels](#tween-channels). |
| `zoomKeyframes` | BgKeyframe[] | — | Camera push/pan on the whole footage+chrome group (canvas zoom for inset device footage); beat-relative track like `captionKeyframes` — `at` is seconds from this segment's start, so it rides the beat when VO timing shifts (see [Tween channels](#tween-channels)). |
| `motionOverlay` | [MotionRef](#motion-segment) | — | Layer a motion graphic over this beat. |
| `captionStyle` | `stroke\|highlight\|gradient\|minimal` | — | Caption look preset for this segment; see [Captions](#captions). |
| `captionAnimation` | `pop\|rise\|typewriter\|wave\|blur-in\|none` | — | Caption entrance preset for this segment; see [Captions](#captions). |
| `captionReveal` | `word\|all` | — | Words-mode reveal for this segment; see [Captions](#captions). |
| `texts` | `{ text, at, dur?, position?, size?, style?, animation? }[]` | — | Standalone text overlays; `at` is seconds from segment start. See [Text overlays](#text-overlays). |
| `blend` | `normal\|screen\|multiply\|add` | — | Compositing mode for this beat's footage layer (not its chrome frame or kicker) against what's beneath it. Default `normal`. Same vocabulary as a declared layer's `blend` — see [Layers](#layers). |
| `regionShader` | `{ mask?, masks?, subject?, background?, object?, params?, keyframes?, textures? }` | — | Split this beat's frame by a segmentation mask: subject region (`mask>0.5`) runs one `.frag`, background region another. `mask` = mask asset dir (`manifest.json` + `mask.png`/`mask.mp4` from [`kino segment`](segmentation.md)). `object` picks which packed object channel (0..3). Need at least one of `subject`/`background`; omit a side to pass that region's original pixels through. `masks` (up to 4) takes several mask sources in one beat, each optionally with its own `subject`; later entries paint over earlier ones. Unknown keys are rejected. See [Segmentation](segmentation.md). |
| `regionShader.params` | `{ name: number\|string }` | — | Author params shared by **every** body in the beat (`subject`, `background`, and each `masks[].subject`) — they compile into one program with one uniform bank. Numeric names alias to `u_<name>` in GLSL, packed alphabetically into `uParam0..3`; `colorA`/`colorB`/`colorC` (hex) and `intensity` drive their own uniforms and cost no slot. Max **4** numeric names across `params` + `keyframes`; more is a build error, not a silent drop. |
| `regionShader.keyframes` | `{ at, params, ease? }[]` | — | Tweens those params over the beat. **`at` is beat-relative seconds** (0 = this beat's start), like `zoomKeyframes`/`captionKeyframes` — *not* absolute like `backgroundKeyframes`. Region shaders have no `triggers` surface, so `uPulse` always reads 0. |
| `regionShader.textures` | `string[]` | — | Up to **2** extra sampler channels every body in the beat can read: `textures[i]` → `uTex{i+2}` (`uTex0` is the beat asset, `uTex1` the cutout `backdrop`). An image path uploads once; a Tier-1 motion `.html` (library id or `assets/` path, same sources `motionOverlay` takes) rasterizes at composition size every frame, scrubbed by the beat progress and given the same `--progress`/`--kino-*` vars, palette, fonts and filter library it gets as an overlay — a motion graphic the shader can refract or mask instead of one stacked on top. Tier-2 `.js` / Tier-3 Lottie are overlay-only (build error). Unbound channels sample transparent black. |

Long source recordings: see [Importing footage](importing-footage.md) for clipping, chrome frames, and retiming.

### `motion` segment
A full-screen custom motion graphic (HTML/CSS you author), driven by kino-set CSS variables. See [Motion graphics](motion-graphics.md) for the authoring contract; [multi-element choreography](motion-graphics.md#multi-element-choreography) for stacked layers and shared `params` drivers.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `kind` | `"motion"` | ✅ | |
| `source` | string | ✅ | Path under the project (`motion/hook.html`) **or** a bare library id with no `/` or `.` (e.g. `"prompt-type"` → `assets-lib/motion/prompt-type.js`). See `kino motion` for bundled ids. |
| `text` | string | — | Spoken VO. Omit for a silent beat (then `dur` is required). |
| `caption` | string | — | Optional on-screen caption. |
| `voFile` | string | — | Imported real VO for this beat: project audio asset used instead of TTS (word timings via Scribe or local whisper.cpp — see [Audio](audio.md#imported-real-voiceover-vofile)). |
| `loop` | boolean | — | Tier-3 Lottie: loop at native speed instead of stretching once across the beat (default). |
| `params` | `Record<string, number\|string>` | — | Base CSS-variable values (read as `--<key>`). Also an **implicit t=0 keyframe**: a lone keyframe tweens from the base value instead of holding. |
| `keyframes` | MotionKeyframe[] | — | Tween params over the beat. Each entry sets exactly one of `at` (beat-relative seconds) or **`atWord`** (a spoken word — first case/punctuation-insensitive occurrence — or a word index), resolved against the build's VO timings so anchors ride real TTS with no retune. |
| `triggers` | MotionTrigger[] | — | One-shot `pulse` envelopes (`--pulse`). Same `at` / `atWord` anchoring as keyframes. |
| `captionMode` | `phrase\|words` | — | See [Captions](#captions). |
| `emphasis` | string[] | — | Emphasised words (`words` mode). |
| `captionKeyframes` | BgKeyframe[] | — | Tween the caption — see [Tween channels](#tween-channels). |
| `captionStyle` | `stroke\|highlight\|gradient\|minimal` | — | Caption look preset for this segment; see [Captions](#captions). |
| `captionAnimation` | `pop\|rise\|typewriter\|wave\|blur-in\|none` | — | Caption entrance preset for this segment; see [Captions](#captions). |
| `captionReveal` | `word\|all` | — | Words-mode reveal for this segment; see [Captions](#captions). |
| `texts` | `{ text, at, dur?, position?, size?, style?, animation? }[]` | — | Standalone text overlays; `at` is seconds from segment start. See [Text overlays](#text-overlays). |
| `blend` | `normal\|screen\|multiply\|add` | — | Compositing mode for this beat's motion-graphic layer against what's beneath it. Default `normal`. |

> **MotionRef** (used by `motionOverlay` and the `motion` segment's own motion fields) = `{ source, params?, keyframes?, triggers?, loop? }`. The `loop` field applies to Tier-3 Lottie (`.json`) sources; it is inert for Tier-1 HTML and Tier-2 procedural JS. `atWord` anchoring works in all motion slots (full-screen beats and overlays); other keyframe tracks (`backgroundKeyframes`, `zoomKeyframes`, `captionKeyframes`, …) remain seconds-only and keep their one-keyframe-holds idiom.

## Masks and effects

Every segment kind accepts `mask`, `effects` and `blend`. A mask clips the beat's rendered layers
before compositing; effects run in array order before the masked result is composited.

`mask.source` supports three sources:

**Analytic shape** — `rect`, `circle`, or `ellipse`, positioned in frame pixels. Rectangles may
set a corner `radius`; every shape may set `rotate` in degrees.

```json
"mask": {
  "source": {
    "kind": "shape",
    "shape": { "kind": "rect", "x": 120, "y": 360, "w": 840, "h": 720, "radius": 48 }
  },
  "feather": 12
}
```

**File** — an image or video mask under `/public`; `channel` is `r`, `g`, `b`, `a`, or `luma`.

**`kind: "file"` does not work on a segment (or declared-layer) mask today.** `planMaskJobs`
(`src/render/native/videoFrames.ts`) extracts the node-generated SDF/coverage frames for it, but
nothing in `registry.ts` or `renderer.ts` ever turns those frames into a bound texture —
`compositeLayerInnerWithBackdrop`'s mask branch only fills a real `MaskBinding.mask` for a
`layer`-kind source; every other kind, "file" included, gets `binding: { mask: null, sdf: null,
sdfMax: 0 }`. Sampling a null texture reads `(0,0,0,1)`, so every channel — including the `luma`
default — gives coverage `0` and the masked beat's layers render invisible. Validation rejects it
loudly instead:

```
beat 0: mask.source.kind "file" is not supported on a segment mask yet — the compositor has no
binding for it (renderer.ts's applyMask always gets a null texture for a "file" source, so
uSourceKind=1 samples nothing and every layer of this beat would render invisible); use
mask.source.kind "shape" or "layer" instead
```

Use `kind: "shape"` (analytic, no texture needed) or `kind: "layer"` (another layer's own render)
instead. A declared layer's `mask` (see [Layers](#layers)) shares this exact gap — it resolves
through the same renderer code path — and is rejected the same way, naming the layer id.

**Layer** — another compositor layer's alpha or luma. For example, `seg0` targets segment 0's
main layer.

```json
"mask": {
  "source": { "kind": "layer", "layerId": "seg0", "channel": "a" },
  "invert": true
}
```

Mask controls:

- `feather` softens the edge by that many true frame pixels. Values above **128px** are rejected
  because they exceed the SDF encode range.
- `expand` grows a positive distance or shrinks a negative distance, also in true frame pixels
  (range `-128..128`).
- `invert` swaps the kept and cut regions.

A `layer` mask whose target is off-screen has no coverage and hides the masked layer entirely.
This includes targets outside their active beat window.

`effects` is an ordered array. Built-in kinds and parameters:

| Kind | Params | Defaults |
|---|---|---|
| `blur` | `radius` (px) | `radius: 0` |
| `glow` | `radius` (px), `intensity`, `threshold` | `radius: 8`, `intensity: 1`, `threshold: 0.6` |
| `grade` | `brightness`, `contrast`, `saturation` | all `1` |

```json
"effects": [
  { "kind": "blur", "params": { "radius": 8 } },
  { "kind": "grade", "params": { "contrast": 1.1, "saturation": 0.9 } }
]
```

### Timed effects

Each effect takes an optional `keyframes` track that tweens its own params over time, using the
same `{ at, params, ease? }` shape as every other keyframe track. Base `params` act as an implicit
t=0 keyframe, so a lone keyframe tweens from the authored base:

```jsonc
"effects": [{
  "kind": "blur",
  "params": { "radius": 0, "focusRadius": 0.15 },
  "keyframes": [{ "at": 1.2, "params": { "focusRadius": 0.9 }, "ease": "easeOutQuart" }]
}]
```

`at` is relative to the effect's owner — the beat's start for a segment's `effects`, the layer's
own start for a declared layer's `effects`, and the composition start for an `adjust` chain (an
adjustment layer always spans the whole accumulator). On a `motionBlur` effect with `auto`,
`angle`/`distance`/`radial` are still derived from measured layer travel and a keyframe on them is
overridden; keyframe `shutter` or `samples` instead.

### `blur` focal region

`blur` is spatially uniform until `focusRadius` is set above `0`, which turns on a focal region:
sharp inside, ramping to the full `radius` outside. Distances are in units of frame **height**,
with x aspect-corrected so a radial region is a circle rather than an ellipse.

| Param | Meaning | Default |
|---|---|---|
| `radius` | maximum blur, at full defocus | `0` |
| `focusX` / `focusY` | focal centre, 0–1 of the frame (`focusY` measured from the top) | `0.5` |
| `focusRadius` | radius of the fully sharp region — **`0` disables the focal region entirely** | `0` |
| `focusFeather` | distance over which sharp ramps to full blur | `0.35` |
| `falloff` | exponent shaping that ramp; `>1` holds sharpness longer, then falls faster | `1` |
| `focusMode` | `radial` or `band` (tilt-shift) | `radial` |
| `focusAngle` | band orientation in degrees, `band` mode only (`0` = horizontal band) | `0` |

Keyframe `focusRadius` (or `focusX`/`focusY`) for a rack focus. Two things worth knowing before
you pick numbers:

- **`focusRadius` saturates well below `1`.** It is measured from the focal centre in frame
  heights, so the value at which the region covers the whole frame is the distance to the corner:
  **≈0.57 on 9:16**, ≈1.02 on 16:9. Past that everything is sharp and further increases do nothing.
  The useful range on a vertical frame is roughly `0 → 0.6`.
- **A front-loaded ease finishes the visible move early.** `easeOutQuart` is ~68% travelled at a
  quarter of its duration, so a rack keyframed `0.12 → 0.95` at `at: 2.4` is visually done by
  ~0.6s. Either keyframe within the useful range, or use a gentler ease, or place the keyframe
  where you actually want the focus to land.

Sharpness bleeds slightly outward across the focal boundary — taps in the blurred region still
reach into the sharp one. That is inherent to a 2D depth-of-field stand-in and is not visible at
the radii layer effects use.

A radial region on a tall frame softens the top and bottom symmetrically, which reads as depth
when there is a clear subject at the focal centre and as a toy tilt-shift when there is not. Use
`focusMode: "band"` when the subject spans the full width.

### Tween channels

`captionKeyframes`, `kickerKeyframes`, `zoomKeyframes` and a declared layer's own `keyframes` all
drive one transform, so they share a channel set:

| Channel | Unit | Default |
|---|---|---|
| `x` / `y` | percent of frame | `0` |
| `scale` | multiplier, about the anchor | `1` |
| `scaleX` / `scaleY` | per-axis multipliers on top of `scale` | `1` |
| `rotate` | degrees, clockwise, about the anchor | `0` |
| `anchorX` / `anchorY` | the fixed point of scale and rotation, as a fraction of the layer rect — `0` top-left, `0.5` centre, `1` bottom-right | `0.5` |
| `opacity` | `0`–`1` | `1` |

An anchor away from `0.5` is what makes a scale-up grow *toward* something rather than ballooning
from the middle. Values outside `0..1` are legal — an anchor beyond the rect is a valid pivot.

```jsonc
// A card that grows from the edge it is docked to, tilting slightly as it lands.
"keyframes": [
  { "at": 0,   "params": { "scale": 0.9, "rotate": -3, "anchorX": 0, "anchorY": 1 } },
  { "at": 1.2, "params": { "scale": 1,   "rotate": 0 }, "ease": "easeOutQuart" }
]
```

`blend` — one of `normal` (default), `screen`, `multiply`, `add` — sets how a beat's own content
layer composites against whatever is beneath it; declared layers share the same vocabulary (see
[Layers](#layers)). It applies to a `video` beat's footage and a `motion` beat's graphic; a `scene`
beat has no content layer of its own (background + optional presenter only), so `blend` there
validates but has no visible effect.

## Layers

`spec.layers[]` declares extra layers that slot into the built-in stack — backdrop, beats,
captions, the cinematic finish — at an author-chosen z. A light leak under the captions, a
full-frame grade over the footage but under the type, a persistent brand mark, a sticker that
survives a beat's crossfade untouched: each is one entry, positioned by z rather than by where it
sits in the array.

```json
"layers": [
  {
    "id": "leak",
    "z": 350,
    "source": { "kind": "image", "src": "fx/leak.png" },
    "blend": "screen",
    "opacity": 0.6
  }
]
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | ✅ | Unique among declared layers; cannot match a built-in id pattern (`backdrop`, `scrim`, `film`, `disclosure`, `platformGuide`, `grid`, or a numbered built-in like `seg0`/`caption3`/`motion2`/`text0_1`). |
| `z` | number | ✅ | Paint order — sorts against every built-in layer's z, see [Z scale](#z-scale) below. Cannot equal a reserved constant; pick a value between two of them. Layers sharing a z paint in authored order. |
| `source` | [source kind](#source-kinds) | one of `source`/`adjust` | The layer's pixels. Mutually exclusive with `adjust` — a layer either draws something or grades what's beneath it, never both. |
| `adjust` | effect[] | one of `source`/`adjust` | No pixels of its own; runs this effect chain over everything composited beneath it. See [Adjustment layers](#adjustment-layers). |
| `blend` | `normal\|screen\|multiply\|add` | — | Compositing mode against what's beneath it. Default `normal`. Rejected together with `adjust`. |
| `fromSec` / `toSec` | number | — | Visible window on the main timeline. Omit `toSec` to run to the end of the composition. Rejected with `adjust`; superseded by `segment` when both are set. |
| `segment` | int | — | Bind the window to a beat's `startSec`/`endSec` instead of authoring `fromSec`/`toSec` by hand, and pull the layer into that beat's crossfade group. |
| `hold` | boolean | — | Keep the layer out of the beat's crossfade group while still using its window — steady through a transition the beats beneath it are dissolving through. Requires `segment`. |
| `rect` | `{x,y,w,h}` | — | Placement, % of frame. Default full-bleed. |
| `opacity` | number 0–1 | — | Default `1`. |
| `mask` | mask | — | Same mask model as segments — see [Masks and effects](#masks-and-effects). |
| `effects` | effect[] | — | Same effect chain as segments, run before compositing — see [Masks and effects](#masks-and-effects). |
| `keyframes` | BgKeyframe[] | — | Tweens the layer's own transform — see [Tween channels](#tween-channels) for the full list. `at` is relative to the layer's own start (its `fromSec`, or its bound segment's `startSec`), not absolute like `backgroundKeyframes`. |

Exactly one of `source`/`adjust` is required. Every field below `adjust` in the table above is
rejected on an adjustment layer — see [Adjustment layers](#adjustment-layers) for why.

### Source kinds

`source.kind` picks the provider; `src` is an author-facing reference, resolved at build time into
whatever that provider actually consumes — the render page never reads a file path itself, same as
every other source in kino (a background carries resolved `shaderCode`, a `motionOverlay` carries
sanitized `html`).

| Kind | `src` | Accepts | Notes |
|---|---|---|---|
| `image` | asset path | `.png` / `.jpg` / `.jpeg` / `.webp` | Staged like any other asset. |
| `shader` | asset path or bare id | `.frag` / `.glsl`, or an `assets-lib/backgrounds` id that resolves to a shader (not a Canvas2D draw fn like `brand-wash`) | Same uniform contract as a [shader background](#shader-backgrounds-frag--glsl) (`iResolution`/`iTime`/`iFrame`/`uPulse`/`uColorA-C`/`uParam0-3`), driven by this layer's own `params`/`keyframes`/`triggers` — not the spec's `backgroundKeyframes`/`backgroundTriggers`. |
| `motion` | asset path or library id | `.html` / `.js` (Tier 1/2) | `params`/`keyframes`/`triggers` behave like a `motionOverlay` [MotionRef](#motion-segment). No `loop` field. |
| `lottie` | asset path or library id | `.json` (Tier 3) | Same `params`/`keyframes`/`triggers` idiom. No `loop` field — unlike a `motion` segment's own Lottie, a declared Lottie layer always stretches once across its window rather than looping. |
| `video` | asset path | in practice, a still image only — see below | **Does not play back real footage.** |

`params`/`keyframes`/`triggers` on `source` only matter for `shader`/`motion`/`lottie` — `image` and
`video` read `url` and ignore the rest.

**`kind: "video"` does not work for real footage today.** Validation accepts a `.mp4`/`.mov` `src`
(the shape check can't tell a working source from a broken one), but the build rejects it loudly:
`planMediaJobs` (`src/render/native/videoFrames.ts`) decides which clips get per-frame extraction
by walking `props.segments` and `props.avatarWindows` — it never walks `props.layers` — so a
declared video layer has no frames to draw. `resolveDeclaredLayers` (`src/commands/build.ts`)
throws rather than staging a file nothing will ever read:

```
layer "bg": source.src "clip.mp4": a declared "video" layer needs per-frame extraction, which is
not wired up yet (videoFrames.ts's planMediaJobs walks segments/avatarWindows, not spec.layers) —
use a still image (.png/.jpg/.jpeg/.webp) for a declared "video" layer for now
```

Point it at a still frame instead. `kind: "image"` and `kind: "video"` resolve identically for a
still, so prefer `image` for one. Real per-frame video in a declared layer needs a job planner that
walks `spec.layers`, which does not exist yet.

### Z scale

Every built-in layer's z (`src/render/layers.ts`), so a declared layer can be slotted exactly where
it needs to go:

| Constant | z | Built-in layer |
|---|---|---|
| `Z.backdrop` | 0 | Background |
| `Z.scrim` | 100 | Scrim over the backdrop |
| `Z.avatar` | 200 | Presenter clip |
| `Z.seg` | 300 | Beat content — video/scene |
| `Z.frame` | 310 | Device chrome |
| `Z.kicker` | 320 | Kicker label |
| `Z.film` | 700 | Cinematic finish (adjustment layer, see below) |
| `Z.overlayVideoBehind` | 750 | `motionOverlay` on a video beat, placed behind the footage |
| `Z.segBehind` | 760 | Beat content, when its `motionOverlay` sits behind it |
| `Z.overlayMotionBehind` | 800 | `motionOverlay` on a motion beat, placed behind |
| `Z.motion` | 810 | Beat content — motion |
| `Z.overlay` | 820 | `motionOverlay`, default (in front) |
| `Z.text` | 900 | Standalone `texts` overlays |
| `Z.caption` | 1100 | Captions |
| `Z.disclosure` | 1200 | AI disclosure |
| `Z.qa` | 9000 | Storyboard/platform QA guides (above everything — a safe-zone guide a caption can cover is useless) |

A declared `z` equal to any value above is a build error, naming the layer. `z: 1000` — the old
built-in brand logo's slot, between `Z.text` and `Z.caption` — is ordinary now; a persistent brand
mark declared there paints exactly where the retired built-in used to.

### Adjustment layers

A layer with `adjust` and no `source` has no pixels of its own — it runs an effect chain over
everything composited beneath it, like a full-frame grade rather than a texture. It is always
base-group and spans the whole composition, so `fromSec`/`toSec`/`segment`/`hold`/`rect`/`opacity`/
`mask`/`effects`/`keyframes`/`blend` are all rejected alongside it: the emission path that draws an
adjustment layer never reads any of them, so accepting them would validate clean and then silently
do nothing.

```json
{ "id": "warmth", "z": 650, "adjust": [{ "kind": "grade", "params": { "brightness": 1.05, "saturation": 0.95 } }] }
```

`adjust` takes the same kinds as segment `effects` (see [Masks and effects](#masks-and-effects)),
plus one more: `film`, the cinematic finish. kino **emits a `film` adjustment layer at `Z.film` by
default** — top-level `film` / `theme.film` (default `1`) supplies its intensity when `postFx.film`
is absent — so an existing spec keeps its graded look without ever declaring a layer for it. Drop
it with `"film": 0`; nothing else may declare `z: Z.film`.

Everything below `Z.film` is grained; everything at or above stays clean. A declared adjustment
layer placed above `Z.film` grades the clean type instead of the footage — usually not the intent.

## Post FX

`postFx` applies a fixed full-frame chain **after** every beat is composited.
Stages always run in this order — it is not authorable:

`grade` → `bloom` → `lens` → `film`

| Stage | Params | Range | Meaning |
|---|---|---|---|
| `grade` | `brightness`, `contrast`, `saturation` | `0..4` each (default `1`) | Full-frame colour grade. |
| `bloom` | `threshold`, `intensity`, `radius` | `threshold` `0..1`, `intensity` `0..4`, `radius` `0..128` px | Separable bright-pass bloom. |
| `lens` | `distortion`, `chroma` | `distortion` `-1..1`, `chroma` `0..0.05` | Barrel/pincushion distortion plus chromatic aberration. |
| `film` | `intensity` | `0..1` | Vignette + grain over the whole frame. |

Omit a stage and it does not run — **except `film`**: when `postFx.film` is absent, intensity
falls back to top-level `film` / `theme.film` (default `1`), so existing specs keep their
cinematic finish without authoring `postFx`.

```json
{
  "title": "graded-hook",
  "film": 1,
  "postFx": {
    "grade": { "brightness": 1.05, "contrast": 1.1, "saturation": 0.92 },
    "bloom": { "threshold": 0.75, "intensity": 0.35, "radius": 24 },
    "lens": { "distortion": 0.04, "chroma": 0.003 }
  },
  "segments": [{ "text": "Ship it.", "caption": "Ship it." }]
}
```

Three things authors trip on:

1. **Order is fixed** — you cannot put grain before bloom or lens; the chain is baked in.
2. **`film` defaults from `theme.film`** — omit `postFx.film` and the post stage still applies
   vignette/grain at the same intensity as the legacy CSS film finish.
3. **Whole-video, not per beat** — one `postFx` object grades the entire output. Per-beat grading
   still belongs on segment `effects`.

### Enums

- **Shot:** `push-in`, `pull-out`, `pan-left`, `pan-right`, `tilt-up`, `scroll`, `scroll-up`, `static`
- **Transition:** `fade`, `dissolve`, `fly-left`, `fly-up`, `wipe-down`, `pop`, `cut`. Auto-vary is
  asset-aware: video assets (`.mp4`/`.mov`) rotate through the soft pair (`dissolve`/`fade` — footage
  with a punchy fly/pop entrance reads as a glitch), stills keep the punchy rotation. Override wins
  either way. **`motion` beats are not in the auto-vary rotation at all** — they default to
  `dissolve` and only change if the beat sets `transition` explicitly.
  The **wipe family** is the reveal: a lit edge travels across the frame and uncovers the incoming
  beat behind it, instead of sliding a whole frame in from off-screen (`fly-*`) or cross-fading two
  layouts on top of each other (`fade`/`dissolve`). Set it on the **incoming** beat.

### Wipe transitions

`wipe-down` / `wipe-up` / `wipe-left` / `wipe-right` are shorthands for a direction; bare `wipe` plus
an `angle` covers everything else, diagonals included. One shader serves them all, and every part of
the edge is tunable via a sibling **`transitionParams`** object (all fields optional):

| Field | Range | Default | Meaning |
|---|---|---|---|
| `angle` | degrees | from the name | Direction of travel: `0` down, `90` right, `180` up, `270` left. Any angle is valid — the projection is normalised per-angle, so a diagonal still starts and finishes fully off-frame instead of clipping mid-sweep. Overrides the direction implied by a `wipe-<dir>` name. |
| `softness` | `0..0.5` | `0.018` | Feather on the reveal edge, as a fraction of the frame. Small = a crisp cut-in; large = closer to a gradient wipe. Floored just above `0` — a literal hard edge aliases into a staircase on a diagonal. |
| `edgeWidth` | `0..0.5` | `0.013` | Width of the lit band riding the edge. **`0` = no lit band**, i.e. a clean, invisible reveal. |
| `edgeColor` | hex | brand `accent` | Colour of the lit band. |
| `edgeGain` | `0..4` | `0.55` | Brightness of the lit band. `0` also disables it. |

```jsonc
{ "kind": "motion", "source": "motion/b.html", "dur": 3,
  "transition": "wipe-down" }                                  // brand-mint edge, defaults

{ "kind": "motion", "source": "motion/c.html", "dur": 3,
  "transition": "wipe",                                        // 55° diagonal, wide gold edge
  "transitionParams": { "angle": 55, "softness": 0.06, "edgeWidth": 0.05,
                        "edgeColor": "#d99a20", "edgeGain": 1.6 } }

{ "kind": "video", "source": "screens/x.png",
  "transition": "wipe-left", "transitionParams": { "edgeWidth": 0 } }   // unlit, works on video too
```

The lit band's strength is scaled by `sin(π·p)`, so it is exactly zero at both ends of the window —
the transition still resolves to precisely the outgoing frame at `p=0` and the incoming one at `p=1`,
with no hairline of light left behind to pop on the next beat.

### Reversing a transition

**`transitionInvert: true`** runs any transition backwards — a reveal becomes a conceal. An iris that
opens instead closes; `wipe-down` sweeps up; `geo-facade`'s flip wave runs the other way. It sits
beside `transition` on the incoming beat and works on **every** transition, built-in or custom:

```jsonc
{ "kind": "motion", "source": "motion/b.html", "dur": 3,
  "transition": "custom", "transitionSource": "iris", "transitionInvert": true }
```

It is implemented in the compositor as a *double* flip — the two beats are swapped **and** the
shader is fed `1 - p` — never inside a shader. Two things follow, and both are the reason it is done
this way. Every transition gets a reverse for free, including author-supplied ones: no shader knows
it is being inverted, so none of them can implement it wrongly. And the endpoint contract survives
by construction — at `p=0` the shader sees `p=1` and returns its `uTo`, which *is* the real outgoing
beat. A shader that is exact at its own endpoints is automatically exact at the inverted ones.

### Carrying a camera through the cut

**`transitionCamera`** keeps the camera moving across the boundary: the outgoing beat continues as
it leaves, and the incoming beat arrives already in motion and settles. That is what makes a cut read
as one shot rather than two clips. It is a different thing from a camera move *inside* a beat (a
`.cam` transform in a motion graphic), which starts and ends within one composition and so dies at
every cut.

```jsonc
{ "kind": "motion", "source": "motion/b.html", "dur": 3,
  "transition": "custom", "transitionSource": "organic-inkbleed",
  "transitionCamera": { "move": "tilt-down", "amount": 1.4 } }
```

| Field | Meaning |
|---|---|
| `move` | `push` · `pull` · `pan-left` · `pan-right` · `tilt-up` · `tilt-down` · `whip-left` · `whip-right` |
| `zoom` | `-0.9..2`; `>0` pushes in, `<0` pulls out. Overrides the preset's zoom. |
| `panX` / `panY` | `-1.5..1.5`, fraction of the frame. Overrides the preset's pan. |
| `amount` | `0..4`, scales the whole move. |
| `blur` | `0..4` directional smear along the travel. `0` = a clean move. A whip defaults to double, since the smear *is* the whip. |
| `hold` | `0..0.95`, default `0.5`. Fraction of each side spent **at** full extent rather than travelling to it. |

**It composes with everything** — every built-in, every custom shader, and `transitionInvert` — because
it is applied inside the shared `kinoFrom` / `kinoTo` sampling helpers that all transitions read their
two beats through. No shader knows a camera is present, so none of them can conflict with one.

Both sides carry the **same zoom sign** so the camera never reverses at the boundary (a push that
became a pull halfway is exactly the artefact that gives a fake cut away), while pan is **mirrored**
so the incoming beat arrives from the opposite edge — one direction of travel, two offsets.

**`hold` is what makes it a punch rather than a drift.** With `hold: 0` the move ramps across the
whole side, so it only reaches full extent exactly at the boundary and immediately starts back — the
frame never sits anywhere. A hold splits each side into ramp / plateau / ramp: the camera pushes in,
**stays there through the cut**, then eases out. The smear follows suit automatically, because it is
derived from how far the frame actually moves at that instant rather than from elapsed time — so it
peaks on the ramps and disappears during the hold, instead of blurring a stationary frame.

Adding a camera cannot break a transition's endpoint contract. Each side is scaled by its own
distance from its own endpoint — the outgoing by `p`, the incoming by `1 - p` — so at each endpoint
the transform is exactly identity and the sample is the untouched beat.

### Authoring your own transition

`transition: "custom"` + **`transitionSource`** runs a shader you wrote. `transitionSource` resolves
exactly like `backgroundComponent`: a **bare id** from `assets-lib/transitions/`, or a path under the
project's `assets/`. Run **`kino transitions`** for the built-in list plus this contract.

```jsonc
{ "kind": "motion", "source": "motion/b.html", "dur": 3,
  "transition": "custom",
  "transitionSource": "iris",                        // bare id, or "transitions/my.frag"
  "transitionParams": { "softness": 0.04 } }         // numeric keys → u_<name> uniforms
```

Write a ShaderToy-style `mainImage` — the same entry point background shaders use, so there is one
shader dialect to learn, not two:

```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = kinoUv(fragCoord);
  fragColor = mix(kinoFrom(uv), kinoTo(uv), step(uv.x, uP));
}
```

In scope:

| | |
|---|---|
| `kinoFrom(uv)` / `kinoTo(uv)` | the outgoing / incoming beat, already composited |
| `kinoUv(fragCoord)` | `fragCoord` → normalised uv |
| `uP` | `0` at the first overlapping frame, `1` at the last |
| `uRes` / `iResolution` | framebuffer size |
| `u_<name>` | every **numeric** `transitionParams` key, up to 8, aliased in sorted order |

**The endpoint contract is yours to keep: exactly `kinoFrom` at `uP=0`, exactly `kinoTo` at `uP=1`.**
A transition that is a hair off at either end pops on every beat boundary. Reach both ends
deliberately — `assets-lib/transitions/iris.frag` starts its radius below zero and finishes past the
far corner for exactly this reason. Copy it as a starting point.

`transitionParams` accepts unknown keys so a custom shader can name its own uniforms, so validation
catches typos by *transition kind* instead: an unrecognised knob on a `wipe` fails the build rather
than being silently ignored, and `transitionSource` without `transition: "custom"` is an error too.
- **Provider:** `none`, `heygen`, `hedra`, `replicate`

## Captions

`captionMode` controls how the caption renders:

- **`phrase`** — a short editorial block shown for the beat.
- **`words`** — the spoken text is revealed word-by-word, synced to the real VO timestamps, with the active word highlighted (and the brand name rendered green). `emphasis: [...]` lists words to pop/glow.

An optional **backplate** (translucent panel behind lower-third captions for legibility over light app screenshots) is configured on the brand: `captionStyle.background { color?, opacity?, appOnly? }`.

**Caption look** (`captionStyle`) — layered `segment ?? spec ?? brand.captionStyle.style ?? "stroke"`:

| style | words mode | phrase / hero mode |
|---|---|---|
| `stroke` (default) | white ink, black stroke, mint active-word highlight | same |
| `highlight` | active word (and the brand name) in a rounded mint box, night ink | whole line on an opaque night plate |
| `gradient` | mint→green gradient fill (stroke dropped — clashes with the fill); drop-shadow for legibility | same |
| `minimal` | weight 700, no stroke, soft shadow; active/brand word mint | same |

**Caption entrance** (`captionAnimation`) — layered `segment ?? spec ?? brand.captionStyle.animation`; unset = the surface's native entrance (`pop` for lower-third + words captions, `rise` for presenter-less hero text):

| animation | behaviour |
|---|---|
| `pop` | spring scale-in |
| `rise` | translateY cascade |
| `typewriter` | staggered instant reveal, no motion |
| `wave` | pop entrance, then a gentle per-word sine bob |
| `blur-in` | blur → 0 + fade |
| `none` | static, no entrance |

In `words` mode the reveal timing (when each word appears) always stays VO-driven — the animation preset only shapes each word's entrance motion, never its timing.

## Text overlays

Per-segment `texts: [{ text, at, dur?, position?, size?, style?, animation? }]` places standalone captions anywhere on the frame, independent of the segment's own caption.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `text` | string | ✅ | Overlay copy. |
| `at` | number | ✅ | Seconds from segment start. |
| `dur` | number | — | Seconds visible. Default = to the segment end. |
| `position` | `top\|center\|bottom\|left\|right` | — | Slot on the frame. Default `center`. |
| `size` | `small\|medium\|big` | — | Multiplier of the caption font size (`0.7\|1\|1.5`). Default `medium`. |
| `style` | [CaptionStyle](#captions) | — | Defaults to the segment's resolved caption style. |
| `animation` | [CaptionAnimation](#captions) | — | Defaults to the segment's resolved caption animation, falling back to `pop`. |

Overlays are clamped to their segment (an overlay never outlives its beat) and dropped if `at` falls at/after the segment ends.

## Keyframes & triggers

All tweenable layers (background, declared layers, captions, kickers, motion params) share one keyframe model. Times are **absolute on the main timeline** — read per-word start/end with `kino inspect`.

```ts
BgKeyframe = { at: number, params: Record<string, number | string>, ease?: "linear" | "easeInOut" | "overshoot" | "spring" }
BgTrigger  = { at: number, action: string }   // e.g. { at: 1.2, action: "pulse" }
```

`ease` defaults to linear interpolation between successive keyframes of the same param. Triggers fire a one-shot envelope (a `pulse` surfaces as `--pulse` in motion graphics / `env.pulse` in custom backgrounds).

## Backgrounds

`background` selects the engine; `backgroundKeyframes`/`backgroundTriggers` animate it; `backgroundIntensity` sets motion strength. Per-preset params and actions are documented in [Backgrounds & overlays](backgrounds-and-overlays.md).

### Shader backgrounds (`.frag` / `.glsl`)

When `background` is `"custom"` and `backgroundComponent` points at a `.frag` or `.glsl` file, kino renders a WebGL2 fullscreen-quad shader instead of a Canvas2D draw fn. Author only the ShaderToy entry point:

```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) { /* … */ }
```

| Uniform | Type | Source |
|---------|------|--------|
| `iResolution` | `vec3` | `[width, height, 1]` |
| `iTime` | `float` | `frame / fps` (frame-derived — no wall clock) |
| `iFrame` | `int` | current frame index |
| `iTimeDelta` | `float` | `1 / fps` |
| `uPulse` | `float` | trigger envelope from `backgroundTriggers` |
| `uColorA` / `uColorB` / `uColorC` | `vec3` | brand `backgroundColors` (hex → RGB) |
| `uIntensity` | `float` | `backgroundIntensity` (0..1) |
| `uParam0`..`uParam3` | `float` | extra numeric params (sorted by key) |
| `uTex0`..`uTex3` | `sampler2D` | `backgroundTextures` channels (see below) |
| `uTexSize0`..`uTexSize3` | `vec2` | texture size in css px; `(0,0)` when the channel is unbound |

Motion is deterministic: `iTime` comes only from the frame index, same contract as Canvas2D backgrounds. Bare library id or project path both work:

```json
{ "background": "custom", "backgroundComponent": "aurora-flow" }
```

```json
{ "background": "custom", "backgroundComponent": "backgrounds/my-plasma.frag" }
```

**Texture channels** — `backgroundTextures` feeds up to four samplers to the shader. An image path
uploads as-is. A `.html` path is sanitized (same DOMPurify pass as motion sources) and rasterized
ONCE at load via `foreignObject` (2×): brand fonts are inlined and the `--kino-*` palette vars are
set, so a texture can be an actual styled UI element. `v=0` is the bottom row (matches `fragCoord`
orientation). Size the root element in **px** (it is texture pixels, not viewport layout) and keep
the page background transparent. Rasterization happens before the first frame — sampling is
deterministic.

**Sampling a full-bleed backdrop** — for a texture that should fill the frame (a photo, a
starfield), sample it **cover-fit at the pixel's own coordinate** (`fragCoord/iResolution`,
corrected for the `uTexSize`/frame aspect ratio) — do **not** project a ray direction into a
centre patch of the texture (`0.5 + dir.xy*k`): that magnifies ~25% of the image across the whole
frame and looks blurry *no matter the source resolution*. For a refractive/reflective object, make
the lookup a **displacement** of that same local uv by the bent ray (`sampleTex(baseUV +
bentDir.xy*throw)`), not a re-projection — it stays full-res and reads as glass. Channels wrap
`CLAMP_TO_EDGE`, so offset samples that leave `[0,1]` smear the edge texel into scanline streaks;
mirror-fold them: `uv = 1.0 - abs(1.0 - fract(uv*0.5)*2.0)`. Oversized images are auto-downscaled
to the GPU's max texture size at upload, so a full-res original is safe to point a channel at.

**Animated DOM textures** — author ordinary CSS `@keyframes` at the `1s` scrub convention, then
pass `{ "source": "motion/card.html", "param": "fill" }`: each frame the engine re-rasterizes the
markup at the current value of the `fill` background param (0..1 → animation time), cached by
value, before the frame is captured. The shader just samples `texture(uTex0, uv)` — the pixels
already match the frame, true per-frame motion, no stepping. Drive `fill` with
`backgroundKeyframes` like any param.

Library examples: `orb-badge` wraps `uTex0` around a raymarched metaball as a
rotating cylindrical decal; `ui-hero` floats the DOM card in a 3D scene — perspective sway, glossy
floor reflection, and a shard-dissolve materialize driven by a `reveal` param
(`backgroundKeyframes` → `uParam0`):

```json
{
  "background": "custom",
  "backgroundComponent": "orb-badge",
  "backgroundTextures": ["motion/badge.html"]
}
```

## Sound effects & music

Free-placed SFX events and an auto-ducked music bed. Place timestamps against real audio
structure: run `kino audio-markers <file>` on the VO track or the music file to get JSON
markers (onsets, peaks, silences) plus waveform/spectrogram PNGs. For the full picture —
voiceover, ducking model, sourcing beds — see [Audio](audio.md).

```json
"sfx": [
  { "src": "sfx/click.mp3", "at": 0.45, "volume": 0.22 },
  { "src": "sfx/impact.mp3", "at": 7.9, "volume": 0.7 }
],
"music": { "src": "music/bed.mp3", "volume": 0.12, "duck": 0.04, "fadeOutSec": 2 }
```

- `src` (both `sfx[]` and `music`) — a bare id (no slash/extension) resolves from the shared
  library (`assets-lib/sfx/<id>.mp3|.wav`, ships empty — add your own); a path resolves from
  the project's `assets/`. Omit `sfx` for silent cuts (preferred short-form default — no
  bundled cut whoosh).
- `sfx[].at` — seconds on the main timeline. `volume` 0–1 (default `1`).
- `music` plays under the VO for the whole video: `volume` is the bed level (default `0.12`),
  `duck` the level while a segment is speaking (default `0.04`, with 0.3s linear ramps in/out
  of each VO span), `fadeOutSec` the linear tail fade to silence at the end of the video
  (default `2`), and `startSec` (default `0`) the offset into the source file the bed plays
  from — sample-accurate, so a beat-aligned offset stays beat-aligned. `kino sync --offset auto`
  sets it to the loudest on-grid stretch of the track; hand-set it to skip an intro.
- **`kino sync <spec>`** retimes the visual beats (those with an authored `dur`) so every cut —
  and the video's end — lands on the music bed's beat grid: it detects bpm/phase over the
  stretch that will actually play, then rewrites `dur`s (`--grain bar` default, `--grain beat`
  for faster cutting; `--dry-run` to preview). VO-driven beats keep their spoken length; the
  next visual beat re-anchors the timeline. Run it after the real VO exists on spoken specs
  (same rule as `retune`); all-visual specs sync for free. `kino audio-markers` reports the
  same grid (`grid: { bpm, periodSec, phaseSec, strength }`) for any track.

## brand.md

The brand config lives at `brands/<name>/brand.md`: a YAML **frontmatter** block (between `---` fences) followed by a free-form **guidelines body**. The frontmatter supplies palette, typography, disclosures, and avatar/voice defaults (validated by [`src/config/brand.ts`](../src/config/brand.ts)); the body is prose for the driving agent. The frontmatter is merged over `DEFAULT_BRAND`, so every field is optional — anything omitted uses kino's defaults. The guidelines body carries no schema and is surfaced to the agent via `kino brand <name>`.

```md
---
name: acme
colors: { bg: "#0b1020", accent: "#80e2b4", deep: "#0c8d64" }
# disclosure: AI-generated   # optional — shown on every video when set
# defaultVoice: <elevenlabs-voice-id>   # or set per spec
bannedPhrases: [get the job, guaranteed interview, land more interviews]
---
# acme — brand guidelines

## Tone / Voice

- **Register:** plain
- **Person:** you
- **Pace:** punchy
- **Energy:** medium
- **Proof style:** specific numbers
- **CTA style:** direct
- **Say like this:**
  - "Paste the job post. We'll rebuild the bullets that actually match."
- **Never say like this:**
  - "Unlock your career potential with our innovative platform."
- **Banned (brand):** passionate, journey, dream job
- **Preferred words:** match, paste, rebuild, callbacks, bullets

_Tone / Voice is agent guidance (see `skills/ad-voice`). Not parsed by the renderer._

## Look

- Palette usage, gradients, what to avoid

## Captions

- Phrase vs word-by-word; what to emphasise
```

The frontmatter fields:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `name` | string | — | Brand name. |
| `colors` | `{ bg, fg, accent, accent2, deep }` | — | Palette, keyed by ROLE: `bg` page base · `fg` text ink · `accent` primary · `accent2` secondary/bright · `deep` deep fill / active word. The pre-rename literal names (`night/white/mint/gold/green`) are accepted forever as aliases for the same slots; a role key wins over its alias. |
| `font` | string | — | Registry font name (downloaded) or raw CSS family. Default `Helvetica, ...`. |
| `labelFont` | string | — | Registry font for storyboard/montage labels (default: caption font). |
| `captionStyle` | `{ fontSize?, strokeWidth?, background?, style?, animation? }` | — | `fontSize` 74, `strokeWidth` 9; `background` = the caption backplate `{ color?, opacity? (0..1, def .82), appOnly? (def true) }`; `style`/`animation` = brand-level defaults for [caption look/entrance](#captions) (segment/spec override). |
| `disclosure` | string | — | AI disclosure shown on ordinary beats. |
| `presenterDisclosure` | string | — | Disclosure shown instead whenever a presenter is composited (falls back to `disclosure`). |
| `backdrop` | string | — | Background image (when `background="image"`). |
| `background` | preset | — | Default background engine. |
| `backgroundComponent` | string | — | Path or bare id for custom Canvas2D draw fn (when `background="custom"`). |
| `backgroundColors` | string[] | — | Palette for animated backgrounds (else accent/deep/accent2). |
| `backgroundIntensity` | number | — | 0..1 motion strength (default 0.5). |
| `captionMode` | `phrase\|words` | — | Default caption style. |
| `bannedPhrases` | string[] | — | Phrases that **fail the build** (compliance). Default `[]`. |
| `defaultVoice` / `defaultLook` / `defaultProvider` | string / string / provider | — | Avatar/voice defaults. |
| `avatarImage` | string | — | Portrait source for Hedra/Replicate. |
| `hedraModelId`, `replicateModel`, `replicateImageField`, `replicateAudioField`, `replicateInput` | — | Engine-specific avatar settings. |
| `voiceAliases` / `lookAliases` | `Record<string,string>` | — | Friendly-name → id maps for `voice` / `avatarLook`. Default `{}`. |

## project.json

Assigns a brand to a project and sets default overrides (validated by [`src/config/projectConfig.ts`](../src/config/projectConfig.ts)).

| Field | Type | Required | Meaning |
|---|---|---|---|
| `brand` | string | ✅ | Brand to use for specs in this project. |
| `provider` | provider | — | Default presenter engine. |
| `background` | preset | — | Default background. |
| `font` | string | — | Default font override. |
| `captionMode` | `phrase\|words` | — | Default caption style. |

## Examples

**Minimal** (one motion hook + one VO beat):

```json
{
  "title": "lie-test",
  "background": "aurora",
  "segments": [
    { "kind": "motion", "source": "motion/hook.html", "text": "Most cover letters get rejected in six seconds." },
    { "text": "Here's how to fix yours.", "caption": "Fix yours" }
  ]
}
```

**Richer** (animated + pulsed background, word captions, a video cut-in, and a motion overlay):

```json
{
  "title": "acme-demo",
  "format": ["9:16", "3:4"],
  "background": "aurora",
  "backgroundIntensity": 0.6,
  "backgroundKeyframes": [
    { "at": 0,   "params": { "intensity": 0.3 } },
    { "at": 2.5, "params": { "intensity": 0.7 }, "ease": "easeInOut" }
  ],
  "backgroundTriggers": [{ "at": 2.5, "action": "pulse" }],
  "segments": [
    {
      "text": "Recruiters spend six seconds on your resume.",
      "caption": "6 seconds.",
      "captionMode": "words",
      "emphasis": ["six", "seconds"]
    },
    {
      "kind": "video",
      "source": "assets/dashboard.png",
      "text": "Acme scores it instantly.",
      "caption": "Instant score",
      "kicker": { "text": "LIVE", "color": "gold" },
      "shot": "scroll",
      "transition": "fly-up",
      "motionOverlay": { "source": "motion/badge.html", "params": { "pct": 0 }, "keyframes": [{ "at": 0.3, "params": { "pct": 98 }, "ease": "easeInOut" }] }
    },
    {
      "kind": "motion",
      "source": "motion/cta.html",
      "text": "Try it free today.",
      "caption": "acme.com",
      "params": { "pct": 0 },
      "keyframes": [{ "at": 0.4, "params": { "pct": 100 }, "ease": "overshoot" }],
      "triggers": [{ "at": 0.4, "action": "pulse" }]
    }
  ]
}
```

See also: [CLI reference](cli-reference.md) · [Motion graphics](motion-graphics.md) · [Backgrounds & overlays](backgrounds-and-overlays.md).
