# Spec reference

A **spec** is the JSON file an agent authors to describe one video. kino validates it, generates voiceover, optionally renders an avatar, and composites everything with Remotion. This page documents every field of the spec, plus the `brand.md` and `project.json` configs it resolves against.

The schema is enforced by [`src/spec/schema.ts`](../src/spec/schema.ts) (zod) — invalid specs fail the build with a precise error.

- [Top-level fields](#top-level-fields)
- [Segments](#segments) — [avatar](#avatar-segment) · [app](#app-segment) · [motion](#motion-segment)
- [Captions](#captions)
- [Text overlays](#text-overlays)
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
| `format` | `("9:16"\|"3:4")[]` | — | Output formats. Default `["9:16"]`. |
| `voice` | string | — | ElevenLabs voice id or a `brand.voiceAliases` alias. |
| `voiceModel` | string | — | ElevenLabs TTS model. Default is v3 (inline audio tags `[excited]`, `[whispers]`, `[short pause]`, … work in segment `text`; tags are stripped from word-synced captions). Set `eleven_multilingual_v2` for more timing-stable / metronome-critical reads. |
| `film` | number | — | Cinematic-finish intensity (vignette + grain over photographic/app beats), `0..1`. Default `1` (graded film look). Set `0` for clean flat edges — e.g. a light "paper" video where the edge vignette reads as a dark border. Motion-graphic beats are never graded. |
| `avatarLook` | string | — | HeyGen: look alias/id · Hedra/Replicate: portrait image path/url. |
| `provider` | `none\|heygen\|hedra\|replicate` | — | Avatar engine; overrides `brand.defaultProvider`. |
| `background` | `glow\|image\|mesh\|aurora\|particles\|grid\|custom` | — | Faceless background; overrides `brand.background`. |
| `backgroundIntensity` | number | — | 0..1 motion-strength override. |
| `backgroundKeyframes` | [BgKeyframe](#keyframes--triggers)[] | — | Tween background params over time. |
| `backgroundTriggers` | [BgTrigger](#keyframes--triggers)[] | — | One-shot background actions (e.g. `pulse`). |
| `logoSize` | `small\|medium\|big` \| number | — | Logo size; overrides brand. |
| `logoPosition` | `top\|bottom\|left\|right\|center` \| `{x,y}` | — | Logo placement (% of frame); overrides brand. |
| `logoKeyframes` | [BgKeyframe](#keyframes--triggers)[] | — | Tween logo `x/y/scale/opacity`. |
| `captionStyle` | `stroke\|highlight\|gradient\|minimal` | — | Caption look preset; overrides `brand.captionStyle.style`. Default `stroke`. See [Captions](#captions). |
| `captionAnimation` | `pop\|rise\|typewriter\|wave\|blur-in\|none` | — | Caption entrance preset; overrides `brand.captionStyle.animation`. Unset = the surface's native entrance (`pop`; `rise` for faceless hero text). See [Captions](#captions). |
| `captionReveal` | `word\|all` | — | Words-mode reveal: `word` (default, one word at a time) or `all` (whole line laid out, active-word highlight tracks VO). See [Captions](#captions). |
| `sfx` | [SfxEvent](#sound-effects--music)[] | — | Free-placed sound effects. See [Sound effects & music](#sound-effects--music). |
| `music` | [Music](#sound-effects--music) | — | Music bed under the VO, auto-ducked while segments speak. See [Sound effects & music](#sound-effects--music). |

## Segments

Every segment is one beat. `kind` selects the beat type (a discriminated union). Two fields recur and are easy to confuse:

- **`text`** — the **spoken** voiceover for the beat (drives VO + timing). Required on `avatar`, `app`, and `motion`.
- **`caption`** — the **on-screen** text. Optional on every kind: omit it and the beat renders no caption line at all (the VO still speaks `text`). In `captionMode: "words"` the synced spoken words render regardless of `caption` — under a words-mode brand, set `"captionMode": "phrase"` on the beat (and omit `caption`) for a fully caption-free beat.

### `avatar` segment
A talking beat — an AI avatar, or faceless VO over a [background](#backgrounds).

| Field | Type | Required | Meaning |
|---|---|---|---|
| `kind` | `"avatar"` | ✅ | |
| `text` | string | ✅ | Spoken VO. |
| `caption` | string | — | On-screen caption; omit for none. |
| `cta` | boolean | — | Mark as a call-to-action / end-card beat. Faceless: centered hero (not lower-third). Default `false`. |
| `shot` | [Shot](#enums) | — | Camera move. |
| `captionMode` | `phrase\|words` | — | See [Captions](#captions). |
| `emphasis` | string[] | — | Words to emphasise in `words` mode. |
| `captionKeyframes` | BgKeyframe[] | — | Tween the caption (`x/y/scale/opacity`). |
| `motionOverlay` | [MotionRef](#motion-segment) | — | Layer a motion graphic over this beat. |
| `captionStyle` | `stroke\|highlight\|gradient\|minimal` | — | Caption look preset for this segment; see [Captions](#captions). |
| `captionAnimation` | `pop\|rise\|typewriter\|wave\|blur-in\|none` | — | Caption entrance preset for this segment; see [Captions](#captions). |
| `captionReveal` | `word\|all` | — | Words-mode reveal for this segment; see [Captions](#captions). |
| `texts` | `{ text, at, dur?, position?, size?, style?, animation? }[]` | — | Standalone text overlays; `at` is seconds from segment start. See [Text overlays](#text-overlays). |

### `app` segment
A screenshot/app cut-in with an optional caption (and optional kicker label).

| Field | Type | Required | Meaning |
|---|---|---|---|
| `kind` | `"app"` | ✅ | |
| `asset` | string | ✅ | Path to the screenshot/asset. |
| `text` | string | ✅ | Spoken VO. |
| `caption` | string | — | On-screen caption; omit for none. |
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

Long source recordings: see the `importing-footage` skill for beat-mapping + retiming.

### `motion` segment
A full-screen custom motion graphic (HTML/CSS you author), driven by kino-set CSS variables. See [Motion graphics](motion-graphics.md) for the authoring contract.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `kind` | `"motion"` | ✅ | |
| `source` | string | ✅ | Path to your HTML/JS/JSON file (e.g. `motion/hook.html`, `motion/confetti.json`). |
| `text` | string | ✅ | Spoken VO for the beat. |
| `caption` | string | — | Optional on-screen caption. |
| `loop` | boolean | — | Tier-3 Lottie: loop at native speed instead of stretching once across the beat (default). |
| `params` | `Record<string, number\|string>` | — | Base CSS-variable values (read as `--<key>`). |
| `keyframes` | BgKeyframe[] | — | Tween params over the beat. |
| `triggers` | BgTrigger[] | — | One-shot `pulse` envelopes (`--pulse`). |
| `captionMode` | `phrase\|words` | — | See [Captions](#captions). |
| `emphasis` | string[] | — | Emphasised words (`words` mode). |
| `captionKeyframes` | BgKeyframe[] | — | Tween the caption. |
| `captionStyle` | `stroke\|highlight\|gradient\|minimal` | — | Caption look preset for this segment; see [Captions](#captions). |
| `captionAnimation` | `pop\|rise\|typewriter\|wave\|blur-in\|none` | — | Caption entrance preset for this segment; see [Captions](#captions). |
| `captionReveal` | `word\|all` | — | Words-mode reveal for this segment; see [Captions](#captions). |
| `texts` | `{ text, at, dur?, position?, size?, style?, animation? }[]` | — | Standalone text overlays; `at` is seconds from segment start. See [Text overlays](#text-overlays). |

> **MotionRef** (used by `motionOverlay` and the `motion` segment's own motion fields) = `{ source, params?, keyframes?, triggers?, loop? }`. The `loop` field applies to Tier-3 Lottie (`.json`) sources; it is inert for Tier-1 HTML and Tier-2 procedural JS.

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

**Caption entrance** (`captionAnimation`) — layered `segment ?? spec ?? brand.captionStyle.animation`; unset = the surface's native entrance (`pop` for lower-third + words captions, `rise` for faceless hero text):

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

`background` selects the faceless engine; `backgroundKeyframes`/`backgroundTriggers` animate it; `backgroundIntensity` sets motion strength. Per-preset params and actions are documented in [Backgrounds & overlays](backgrounds-and-overlays.md).

## Logo & overlay tweening

`logoSize`/`logoPosition` place the brand mark on faceless talking beats; `logoKeyframes` tweens `x/y/scale/opacity` over time. Captions and kickers tween the same way via `captionKeyframes`/`kickerKeyframes`. Details in [Backgrounds & overlays → Overlay elements](backgrounds-and-overlays.md#overlay-elements).

## Sound effects & music

Free-placed SFX events and an auto-ducked music bed. Place timestamps against real audio
structure: run `kino audio-markers <file>` on the VO track or the music file to get JSON
markers (onsets, peaks, silences) plus waveform/spectrogram PNGs.

```json
"sfx": [
  { "src": "pop", "at": 10.1, "volume": 0.25 },
  { "src": "sfx/impact.mp3", "at": 7.9, "volume": 0.7 }
],
"music": { "src": "music/bed.mp3", "volume": 0.18, "duck": 0.06, "fadeOutSec": 2 }
```

- `src` (both `sfx[]` and `music`) — a bare id (`"pop"`, no slash/extension) resolves from
  the shared library (`assets-lib/sfx/<id>.mp3|.wav`); a path resolves from the project's
  `assets/`. Omit `sfx` for silent cuts (preferred short-form default — no bundled cut whoosh).
- `sfx[].at` — seconds on the main timeline. `volume` 0–1 (default `1`).
- `music` plays under the VO for the whole video: `volume` is the bed level (default `0.18`),
  `duck` the level while a segment is speaking (default `0.06`, with 0.3s linear ramps in/out
  of each VO span), `fadeOutSec` the linear tail fade to silence at the end of the video
  (default `2`).

## brand.md

The brand config lives at `brands/<name>/brand.md`: a YAML **frontmatter** block (between `---` fences) followed by a free-form **guidelines body**. The frontmatter supplies palette, typography, disclosures, and avatar/voice defaults (validated by [`src/config/brand.ts`](../src/config/brand.ts)); the body is prose for the driving agent. The frontmatter is merged over `DEFAULT_BRAND`, so every field is optional — anything omitted uses kino's defaults. The guidelines body carries no schema and is surfaced to the agent via `kino brand <name>`.

```md
---
name: evidentcv
colors: { night: "#0b1020", mint: "#80e2b4", green: "#0c8d64" }
# disclosure: AI-generated   # optional — shown on every video when set
# defaultVoice: <elevenlabs-voice-id>   # or set per spec
bannedPhrases: [get the job, guaranteed interview, land more interviews]
---
# evidentcv — brand guidelines

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

_All frontmatter is optional; anything omitted uses kino defaults._
```

The frontmatter fields. All brand fields are optional; anything omitted falls back to `DEFAULT_BRAND`.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `name` | string | — | Brand name. |
| `colors` | `{ night, mint, green, white?, gold? }` | — | Palette. `white` default `#ffffff`, `gold` default `#d99a20`. |
| `font` | string | — | Registry font name (downloaded) or raw CSS family. Default `Helvetica, ...`. |
| `labelFont` | string | — | Registry font for storyboard/montage labels (default: caption font). |
| `captionStyle` | `{ fontSize?, strokeWidth?, background?, style?, animation? }` | — | `fontSize` 74, `strokeWidth` 9; `background` = the caption backplate `{ color?, opacity? (0..1, def .82), appOnly? (def true) }`; `style`/`animation` = brand-level defaults for [caption look/entrance](#captions) (segment/spec override). |
| `disclosure` | string | — | AI disclosure shown when an avatar is present. |
| `facelessDisclosure` | string | — | Disclosure for faceless renders (falls back to `disclosure`). |
| `logo` | string | — | Brand mark (transparent PNG) for faceless talking beats. |
| `logoSize` / `logoPosition` | size / position | — | Default logo layout. |
| `facelessBackdrop` | string | — | Background image for faceless beats (when `background="image"`). |
| `background` | preset | — | Default faceless background engine. |
| `backgroundComponent` | string | — | Path to a custom Canvas2D draw fn (when `background="custom"`). |
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
| `provider` | provider | — | Default avatar engine. |
| `background` | preset | — | Default faceless background. |
| `font` | string | — | Default font override. |
| `captionMode` | `phrase\|words` | — | Default caption style. |

## Examples

**Minimal** (faceless, one motion hook + one VO beat):

```json
{
  "title": "lie-test",
  "background": "aurora",
  "segments": [
    { "kind": "motion", "source": "motion/hook.html", "text": "Most cover letters get rejected in six seconds." },
    { "kind": "avatar", "text": "Here's how to fix yours.", "caption": "Fix yours" }
  ]
}
```

**Richer** (faceless, animated + pulsed background, word captions, an app cut-in, and a motion overlay):

```json
{
  "title": "evident-demo",
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
      "kind": "avatar",
      "text": "Recruiters spend six seconds on your resume.",
      "caption": "6 seconds.",
      "captionMode": "words",
      "emphasis": ["six", "seconds"]
    },
    {
      "kind": "app",
      "asset": "assets/dashboard.png",
      "text": "EvidentCV scores it instantly.",
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
      "caption": "evidentcv.com",
      "params": { "pct": 0 },
      "keyframes": [{ "at": 0.4, "params": { "pct": 100 }, "ease": "overshoot" }],
      "triggers": [{ "at": 0.4, "action": "pulse" }]
    }
  ]
}
```

See also: [CLI reference](cli-reference.md) · [Motion graphics](motion-graphics.md) · [Backgrounds & overlays](backgrounds-and-overlays.md).
