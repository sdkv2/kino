# Spec reference

A **spec** is the JSON file that describes one video. kino validates it, generates voiceover, optionally renders a presenter, and composites everything with its deterministic frame engine. This page documents every field of the spec, plus the `brand.md` and `project.json` configs it resolves against.

The schema is enforced by [`src/spec/schema.ts`](../src/spec/schema.ts) (zod) — invalid specs fail the build with a precise error.

- [Top-level fields](#top-level-fields)
- [Segments](#segments) — [scene](#scene-segment) · [video](#video-segment) · [motion](#motion-segment)
- [Captions](#captions)
- [Text overlays](#text-overlays)
- [Masks and effects](#masks-and-effects)
- [Keyframes & triggers](#keyframes--triggers)
- [Backgrounds](#backgrounds), [logo & overlays](#logo--overlay-tweening)
- [Sound effects & music](#sound-effects--music)
- [brand.md](#brandmd) · [project.json](#projectjson)
- [Examples](#examples)

## Top-level fields

| Field | Type | Required | Meaning |
|---|---|---|---|
| `title` | string (kebab-case) | ✅ | Output basename; must match `^[a-z0-9-]+$`. |
| `segments` | [Segment](#segments)[] | ✅ | The beats, in order (≥ 1). |
| `brand` | string | — | Brand name; falls back to the project's `project.json` brand. |
| `format` | `("9:16"\|"3:4"\|"16:9")[]` | — | Output formats. Default `["9:16"]`. Motion layouts adapt via `--kino-aspect`. |
| `fps` | int 1–120 | — | Composition frame rate. Default `30` — fine for talking-head and motion work, and cheap. Raise it when the source cadence matters: 60fps footage (and a 60fps `kino segment` mask tracking it) is otherwise sampled every other frame. Render cost scales with it — every frame is a real browser paint. |
| `voice` | string | — | ElevenLabs voice id or a `brand.voiceAliases` alias. |
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
| `logoSize` | `small\|medium\|big` \| number | — | Logo size; overrides brand. |
| `logoPosition` | `top\|bottom\|left\|right\|center` \| `{x,y}` | — | Logo placement (% of frame); overrides brand. |
| `logoKeyframes` | [BgKeyframe](#keyframes--triggers)[] | — | Tween logo `x/y/scale/opacity`. |
| `captionStyle` | `stroke\|highlight\|gradient\|minimal` | — | Caption look preset; overrides `brand.captionStyle.style`. Default `stroke`. See [Captions](#captions). |
| `captionAnimation` | `pop\|rise\|typewriter\|wave\|blur-in\|none` | — | Caption entrance preset; overrides `brand.captionStyle.animation`. Unset = the surface's native entrance (`pop`; `rise` for presenter-less hero text). See [Captions](#captions). |
| `captionReveal` | `word\|all` | — | Words-mode reveal: `word` (default, one word at a time) or `all` (whole line laid out, active-word highlight tracks VO). See [Captions](#captions). |
| `captionMode` | `phrase\|words` | — | Caption mode; overrides `brand.captionMode`. See [Captions](#captions). |
| `sfx` | [SfxEvent](#sound-effects--music)[] | — | Free-placed sound effects. See [Sound effects & music](#sound-effects--music). |
| `music` | [Music](#sound-effects--music) | — | Music bed under the VO, auto-ducked while segments speak. See [Sound effects & music](#sound-effects--music). |
| `seamlessLoop` | boolean | — | Loop-ad contract: last beat must be `kind:"motion"`; validate warns if `film` unset/`>0` or first/last motion sources aren't a ready-state pair; post-build compares first/last frame RGB (warn only). Prefer `"film": 0`. Not the same as segment `loop` (Lottie playback). |

## Segments

Every segment is one beat. `kind` selects the beat type; **omit it for a `scene`**, the ordinary beat. Two fields recur and are easy to confuse:

- **`text`** — the **spoken** voiceover for the beat (drives VO + timing). Required on every kind.
- **`caption`** — the **on-screen** text. Optional on every kind: omit it and the beat renders no caption line at all (the VO still speaks `text`). In `captionMode: "words"` the synced spoken words render regardless of `caption` — under a words-mode brand, set `"captionMode": "phrase"` on the beat (and omit `caption`) for a fully caption-free beat.

### `scene` segment
The default beat: voiceover and captions over a [background](#backgrounds), optionally with an AI presenter composited on top. Omit `kind` and you get one.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `kind` | `"scene"` | — | Default when `kind` is omitted. |
| `source` | presenter scheme | — | Put a presenter on this beat: `"avatar:"` uses the configured provider, `"heygen:look-id"` / `"hedra:portraits/founder.png"` / `"replicate:"` pin one (anything after the colon is the look). Omit for no presenter. A file path here is an error — that is a [`video`](#video-segment) beat. |
| `text` | string | ✅ | Spoken VO. |
| `caption` | string | — | On-screen caption; omit for none. |
| `voFile` | string | — | Imported real VO for this beat: project audio asset used instead of TTS (word timings via Scribe or local whisper.cpp — see [Audio](audio.md#imported-real-voiceover-vofile)). |
| `cta` | boolean | — | Mark as a call-to-action / end-card beat. With no presenter: centered hero (not lower-third). Default `false`. |
| `shot` | [Shot](#enums) | — | Camera move. |
| `captionMode` | `phrase\|words` | — | See [Captions](#captions). |
| `emphasis` | string[] | — | Words to emphasise in `words` mode. |
| `captionKeyframes` | BgKeyframe[] | — | Tween the caption (`x/y/scale/opacity`). |
| `motionOverlay` | [MotionRef](#motion-segment) | — | Layer a motion graphic over this beat. |
| `captionStyle` | `stroke\|highlight\|gradient\|minimal` | — | Caption look preset for this segment; see [Captions](#captions). |
| `captionAnimation` | `pop\|rise\|typewriter\|wave\|blur-in\|none` | — | Caption entrance preset for this segment; see [Captions](#captions). |
| `captionReveal` | `word\|all` | — | Words-mode reveal for this segment; see [Captions](#captions). |
| `texts` | `{ text, at, dur?, position?, size?, style?, animation? }[]` | — | Standalone text overlays; `at` is seconds from segment start. See [Text overlays](#text-overlays). |

### `video` segment
Footage, a screenshot, or any other video source cut in full-frame, with an optional caption (and optional kicker label).

| Field | Type | Required | Meaning |
|---|---|---|---|
| `kind` | `"video"` | ✅ | |
| `source` | string | ✅ | Project asset path (`.mp4`/`.mov`/`.jpg`/`.png`). A presenter scheme (`"heygen:…"`) is also accepted here and resolves to a [`scene`](#scene-segment) with that presenter. |
| `text` | string | ✅ | Spoken VO. |
| `caption` | string | — | On-screen caption; omit for none. |
| `voFile` | string | — | Imported real VO for this beat: project audio asset used instead of TTS (word timings via Scribe or local whisper.cpp — see [Audio](audio.md#imported-real-voiceover-vofile)). |
| `kicker` | `{ text, color }` | — | Small label; `color` ∈ `mint\|green\|gold` (default `mint`). |
| `shot` | [Shot](#enums) | — | Camera move (e.g. `scroll` for long screenshots). |
| `transition` | [Transition](#enums) | — | In/out transition for the cut-in. |
| `clipFrom` | number ≥ 0 | — | Start reading a video asset at this source second. |
| `clipTo` | number | — | End of source window (must be `> clipFrom` when both set). |
| `speed` | number > 0 | — | Playback rate (default `1`). `<1` = slow-mo. Tune after beats exist. |
| `pauseAt` | number ≥ 0 | — | Seconds from **segment start** — freeze that frame for the rest of the beat. |
| `frame` | `{ src, inset: { x,y,w,h } }` | — | Chrome overlay: footage in `inset` (% of composition); `src` is full-bleed PNG/WebP on top. `x+w` and `y+h` ≤ 100. |
| `captionMode` | `phrase\|words` | — | See [Captions](#captions). |
| `emphasis` | string[] | — | Emphasised words (`words` mode). |
| `captionKeyframes` | BgKeyframe[] | — | Tween the caption. |
| `kickerKeyframes` | BgKeyframe[] | — | Tween the kicker. |
| `zoomKeyframes` | BgKeyframe[] | — | Camera push/pan on the whole footage+chrome group (canvas zoom for inset device footage); beat-relative track like `captionKeyframes` — `at` is seconds from this segment's start, so it rides the beat when VO timing shifts (params `x/y/scale/opacity`). |
| `motionOverlay` | [MotionRef](#motion-segment) | — | Layer a motion graphic over this beat. |
| `captionStyle` | `stroke\|highlight\|gradient\|minimal` | — | Caption look preset for this segment; see [Captions](#captions). |
| `captionAnimation` | `pop\|rise\|typewriter\|wave\|blur-in\|none` | — | Caption entrance preset for this segment; see [Captions](#captions). |
| `captionReveal` | `word\|all` | — | Words-mode reveal for this segment; see [Captions](#captions). |
| `texts` | `{ text, at, dur?, position?, size?, style?, animation? }[]` | — | Standalone text overlays; `at` is seconds from segment start. See [Text overlays](#text-overlays). |
| `regionShader` | `{ mask?, masks?, subject?, background?, object?, params?, keyframes?, textures? }` | — | Split this beat's frame by a segmentation mask: subject region (`mask>0.5`) runs one `.frag`, background region another. `mask` = mask asset dir (`manifest.json` + `mask.png`/`mask.mp4` from [`kino segment`](segmentation.md)). `object` picks which packed object channel (0..3). Need at least one of `subject`/`background`; omit a side to pass that region's original pixels through. `masks` (up to 4) takes several mask sources in one beat, each optionally with its own `subject`; later entries paint over earlier ones. Unknown keys are rejected. See [Segmentation](segmentation.md). |
| `regionShader.params` | `{ name: number\|string }` | — | Author params shared by **every** body in the beat (`subject`, `background`, and each `masks[].subject`) — they compile into one program with one uniform bank. Numeric names alias to `u_<name>` in GLSL, packed alphabetically into `uParam0..3`; `colorA`/`colorB`/`colorC` (hex) and `intensity` drive their own uniforms and cost no slot. Max **4** numeric names across `params` + `keyframes`; more is a build error, not a silent drop. |
| `regionShader.keyframes` | `{ at, params, ease? }[]` | — | Tweens those params over the beat. **`at` is beat-relative seconds** (0 = this beat's start), like `zoomKeyframes`/`captionKeyframes` — *not* absolute like `backgroundKeyframes`. Region shaders have no `triggers` surface, so `uPulse` always reads 0. |
| `regionShader.textures` | `string[]` | — | Up to **2** extra sampler channels every body in the beat can read: `textures[i]` → `uTex{i+2}` (`uTex0` is the beat asset, `uTex1` the cutout `backdrop`). An image path uploads once; a Tier-1 motion `.html` (library id or `assets/` path, same sources `motionOverlay` takes) rasterizes at composition size every frame, scrubbed by the beat progress and given the same `--progress`/`--kino-*` vars, palette, fonts and filter library it gets as an overlay — a motion graphic the shader can refract or mask instead of one stacked on top. Tier-2 `.js` / Tier-3 Lottie are overlay-only (build error). Unbound channels sample transparent black. |

Long source recordings: see [Importing footage](importing-footage.md) for clipping, chrome frames, and retiming.

### `motion` segment
A full-screen custom motion graphic (HTML/CSS you author), driven by kino-set CSS variables. See [Motion graphics](motion-graphics.md) for the authoring contract.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `kind` | `"motion"` | ✅ | |
| `source` | string | ✅ | Path under the project (`motion/hook.html`) **or** a bare library id with no `/` or `.` (e.g. `"prompt-type"` → `assets-lib/motion/prompt-type.js`). See `kino motion` for bundled ids. |
| `text` | string | ✅ | Spoken VO for the beat. |
| `caption` | string | — | Optional on-screen caption. |
| `voFile` | string | — | Imported real VO for this beat: project audio asset used instead of TTS (word timings via Scribe or local whisper.cpp — see [Audio](audio.md#imported-real-voiceover-vofile)). |
| `loop` | boolean | — | Tier-3 Lottie: loop at native speed instead of stretching once across the beat (default). |
| `params` | `Record<string, number\|string>` | — | Base CSS-variable values (read as `--<key>`). Also an **implicit t=0 keyframe**: a lone keyframe tweens from the base value instead of holding. |
| `keyframes` | MotionKeyframe[] | — | Tween params over the beat. Each entry sets exactly one of `at` (beat-relative seconds) or **`atWord`** (a spoken word — first case/punctuation-insensitive occurrence — or a word index), resolved against the build's VO timings so anchors ride real TTS with no retune. |
| `triggers` | MotionTrigger[] | — | One-shot `pulse` envelopes (`--pulse`). Same `at` / `atWord` anchoring as keyframes. |
| `captionMode` | `phrase\|words` | — | See [Captions](#captions). |
| `emphasis` | string[] | — | Emphasised words (`words` mode). |
| `captionKeyframes` | BgKeyframe[] | — | Tween the caption. |
| `captionStyle` | `stroke\|highlight\|gradient\|minimal` | — | Caption look preset for this segment; see [Captions](#captions). |
| `captionAnimation` | `pop\|rise\|typewriter\|wave\|blur-in\|none` | — | Caption entrance preset for this segment; see [Captions](#captions). |
| `captionReveal` | `word\|all` | — | Words-mode reveal for this segment; see [Captions](#captions). |
| `texts` | `{ text, at, dur?, position?, size?, style?, animation? }[]` | — | Standalone text overlays; `at` is seconds from segment start. See [Text overlays](#text-overlays). |

> **MotionRef** (used by `motionOverlay` and the `motion` segment's own motion fields) = `{ source, params?, keyframes?, triggers?, loop? }`. The `loop` field applies to Tier-3 Lottie (`.json`) sources; it is inert for Tier-1 HTML and Tier-2 procedural JS. `atWord` anchoring works in all motion slots (full-screen beats and overlays); other keyframe tracks (`backgroundKeyframes`, `zoomKeyframes`, `captionKeyframes`, …) remain seconds-only and keep their one-keyframe-holds idiom.

## Masks and effects

Every segment kind accepts `mask` and `effects`. A mask clips the beat's rendered layers before
compositing; effects run in array order before the masked result is composited.

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
File masks use node-generated SDF frames so feather and expansion remain distance-based.

```json
"mask": {
  "source": { "kind": "file", "src": "masks/subject/mask.mp4", "channel": "r" },
  "expand": 4
}
```

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

### Enums

- **Shot:** `push-in`, `pull-out`, `pan-left`, `pan-right`, `tilt-up`, `scroll`, `scroll-up`, `static`
- **Transition:** `fade`, `dissolve`, `fly-left`, `fly-up`, `pop`, `cut`. Auto-vary is asset-aware:
  video assets (`.mp4`/`.mov`) rotate through the soft pair (`dissolve`/`fade` — footage with a
  punchy fly/pop entrance reads as a glitch), stills keep the punchy rotation. Override wins either way.
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

All tweenable layers (background, logo, captions, kickers, motion params) share one keyframe model. Times are **absolute on the main timeline** — read per-word start/end with `kino inspect`.

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

## Logo & overlay tweening

`logoSize`/`logoPosition` place the brand mark on presenter-less talking beats; `logoKeyframes` tweens `x/y/scale/opacity` over time. Captions and kickers tween the same way via `captionKeyframes`/`kickerKeyframes`. Details in [Backgrounds & overlays → Overlay elements](backgrounds-and-overlays.md#overlay-elements).

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
  (default `2`).

## brand.md

The brand config lives at `brands/<name>/brand.md`: a YAML **frontmatter** block (between `---` fences) followed by a free-form **guidelines body**. The frontmatter supplies palette, typography, disclosures, and avatar/voice defaults (validated by [`src/config/brand.ts`](../src/config/brand.ts)); the body is prose for the driving agent. The frontmatter is merged over `DEFAULT_BRAND`, so every field is optional — anything omitted uses kino's defaults. The guidelines body carries no schema and is surfaced to the agent via `kino brand <name>`.

```md
---
name: acme
colors: { night: "#0b1020", mint: "#80e2b4", green: "#0c8d64" }
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
| `colors` | `{ night, mint, green, white?, gold? }` | — | Palette. `white` default `#ffffff`, `gold` default `#d99a20`. |
| `font` | string | — | Registry font name (downloaded) or raw CSS family. Default `Helvetica, ...`. |
| `labelFont` | string | — | Registry font for storyboard/montage labels (default: caption font). |
| `captionStyle` | `{ fontSize?, strokeWidth?, background?, style?, animation? }` | — | `fontSize` 74, `strokeWidth` 9; `background` = the caption backplate `{ color?, opacity? (0..1, def .82), appOnly? (def true) }`; `style`/`animation` = brand-level defaults for [caption look/entrance](#captions) (segment/spec override). |
| `disclosure` | string | — | AI disclosure shown on ordinary beats. |
| `presenterDisclosure` | string | — | Disclosure shown instead whenever a presenter is composited (falls back to `disclosure`). |
| `logo` | string | — | Brand mark (transparent PNG) for presenter-less talking beats. |
| `logoSize` / `logoPosition` | size / position | — | Default logo layout. |
| `backdrop` | string | — | Background image (when `background="image"`). |
| `background` | preset | — | Default background engine. |
| `backgroundComponent` | string | — | Path or bare id for custom Canvas2D draw fn (when `background="custom"`). |
| `backgroundColors` | string[] | — | Palette for animated backgrounds (else mint/green/gold). |
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
  "logoPosition": "top",
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
