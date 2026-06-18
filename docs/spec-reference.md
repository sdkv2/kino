# Spec reference

A **spec** is the JSON file an agent authors to describe one video. kino validates it, generates voiceover, optionally renders an avatar, and composites everything with Remotion. This page documents every field of the spec, plus the `brand.md` and `project.json` configs it resolves against.

The schema is enforced by [`src/spec/schema.ts`](../src/spec/schema.ts) (zod) — invalid specs fail the build with a precise error.

- [Top-level fields](#top-level-fields)
- [Segments](#segments) — [avatar](#avatar-segment) · [app](#app-segment) · [motion](#motion-segment)
- [Captions](#captions)
- [Keyframes & triggers](#keyframes--triggers)
- [Backgrounds](#backgrounds), [logo & overlays](#logo--overlay-tweening)
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
| `avatarLook` | string | — | HeyGen: look alias/id · Hedra/Replicate: portrait image path/url. |
| `provider` | `none\|heygen\|hedra\|replicate` | — | Avatar engine; overrides `brand.defaultProvider`. |
| `background` | `glow\|image\|mesh\|aurora\|particles\|grid\|custom` | — | Faceless background; overrides `brand.background`. |
| `backgroundIntensity` | number | — | 0..1 motion-strength override. |
| `backgroundKeyframes` | [BgKeyframe](#keyframes--triggers)[] | — | Tween background params over time. |
| `backgroundTriggers` | [BgTrigger](#keyframes--triggers)[] | — | One-shot background actions (e.g. `pulse`). |
| `logoSize` | `small\|medium\|big` \| number | — | Logo size; overrides brand. |
| `logoPosition` | `top\|bottom\|left\|right\|center` \| `{x,y}` | — | Logo placement (% of frame); overrides brand. |
| `logoKeyframes` | [BgKeyframe](#keyframes--triggers)[] | — | Tween logo `x/y/scale/opacity`. |

## Segments

Every segment is one beat. `kind` selects the beat type (a discriminated union). Two fields recur and are easy to confuse:

- **`text`** — the **spoken** voiceover for the beat (drives VO + timing). Required on `avatar`, `app`, and `motion`.
- **`caption`** — the **on-screen** text. Required on `avatar`/`app`; optional on `motion`.

### `avatar` segment
A talking beat — an AI avatar, or faceless VO over a [background](#backgrounds).

| Field | Type | Required | Meaning |
|---|---|---|---|
| `kind` | `"avatar"` | ✅ | |
| `text` | string | ✅ | Spoken VO. |
| `caption` | string | ✅ | On-screen caption. |
| `cta` | boolean | — | Mark as a call-to-action beat. Default `false`. |
| `shot` | [Shot](#enums) | — | Camera move. |
| `captionMode` | `phrase\|words` | — | See [Captions](#captions). |
| `emphasis` | string[] | — | Words to emphasise in `words` mode. |
| `captionKeyframes` | BgKeyframe[] | — | Tween the caption (`x/y/scale/opacity`). |
| `motionOverlay` | [MotionRef](#motion-segment) | — | Layer a motion graphic over this beat. |

### `app` segment
A screenshot/app cut-in with a caption (and optional kicker label).

| Field | Type | Required | Meaning |
|---|---|---|---|
| `kind` | `"app"` | ✅ | |
| `asset` | string | ✅ | Path to the screenshot/asset. |
| `text` | string | ✅ | Spoken VO. |
| `caption` | string | ✅ | On-screen caption. |
| `kicker` | `{ text, color }` | — | Small label; `color` ∈ `mint\|green\|gold` (default `mint`). |
| `shot` | [Shot](#enums) | — | Camera move (e.g. `scroll` for long screenshots). |
| `transition` | [Transition](#enums) | — | In/out transition for the cut-in. |
| `captionMode` | `phrase\|words` | — | See [Captions](#captions). |
| `emphasis` | string[] | — | Emphasised words (`words` mode). |
| `captionKeyframes` | BgKeyframe[] | — | Tween the caption. |
| `kickerKeyframes` | BgKeyframe[] | — | Tween the kicker. |
| `motionOverlay` | [MotionRef](#motion-segment) | — | Layer a motion graphic over this beat. |

### `motion` segment
A full-screen custom motion graphic (HTML/CSS you author), driven by kino-set CSS variables. See [Motion graphics](motion-graphics.md) for the authoring contract.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `kind` | `"motion"` | ✅ | |
| `source` | string | ✅ | Path to your HTML file (e.g. `motion/hook.html`). |
| `text` | string | ✅ | Spoken VO for the beat. |
| `caption` | string | — | Optional on-screen caption. |
| `params` | `Record<string, number\|string>` | — | Base CSS-variable values (read as `--<key>`). |
| `keyframes` | BgKeyframe[] | — | Tween params over the beat. |
| `triggers` | BgTrigger[] | — | One-shot `pulse` envelopes (`--pulse`). |
| `captionMode` | `phrase\|words` | — | See [Captions](#captions). |
| `emphasis` | string[] | — | Emphasised words (`words` mode). |
| `captionKeyframes` | BgKeyframe[] | — | Tween the caption. |

> **MotionRef** (used by `motionOverlay` and the `motion` segment's own motion fields) = `{ source, params?, keyframes?, triggers? }`.

### Enums

- **Shot:** `push-in`, `pull-out`, `pan-left`, `pan-right`, `tilt-up`, `scroll`, `scroll-up`, `static`
- **Transition:** `fade`, `fly-left`, `fly-up`, `pop`, `cut`
- **Provider:** `none`, `heygen`, `hedra`, `replicate`

## Captions

`captionMode` controls how the caption renders:

- **`phrase`** — a short editorial block shown for the beat.
- **`words`** — the spoken text is revealed word-by-word, synced to the real VO timestamps, with the active word highlighted (and the brand name rendered green). `emphasis: [...]` lists words to pop/glow.

An optional **backplate** (translucent panel behind lower-third captions for legibility over light app screenshots) is configured on the brand: `captionStyle.background { color?, opacity?, appOnly? }`.

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

- Voice: (describe tone — e.g. confident, plain-spoken, short sentences)
- Look: (palette usage, gradients, what to avoid)
- Captions: (phrase vs word-by-word; what to emphasise)

_All frontmatter is optional; anything omitted uses kino defaults._
```

The frontmatter fields. All brand fields are optional; anything omitted falls back to `DEFAULT_BRAND`.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `name` | string | — | Brand name. |
| `colors` | `{ night, mint, green, white?, gold? }` | — | Palette. `white` default `#ffffff`, `gold` default `#d99a20`. |
| `font` | string | — | Registry font name (downloaded) or raw CSS family. Default `Helvetica, ...`. |
| `labelFont` | string | — | Registry font for storyboard/montage labels (default: caption font). |
| `captionStyle` | `{ fontSize?, strokeWidth?, background? }` | — | `fontSize` 74, `strokeWidth` 9; `background` = the caption backplate `{ color?, opacity? (0..1, def .82), appOnly? (def true) }`. |
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
