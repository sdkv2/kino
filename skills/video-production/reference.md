# kino reference

## Commands
- `kino build <spec> [--mock] [--format 9:16,3:4] [--provider <p>] [--background <kind>] [--tag <label>]`
- `kino inspect <spec> [--real]` — resolved plan as JSON: beats, timings, modes + per-segment **word timestamps**
- `kino backgrounds` — list animated backgrounds + their agent-controllable params/actions
- `kino elements` — list overlay elements (logo …) + their layout/tween controls
- `kino still <spec> [--at <s,…> | --segment <n>] [--real] [--format]` — render one frame fast (no encode)
- `kino storyboard <spec> [--real] [--format]` — one still per beat tiled into a labeled contact sheet
- `kino frames <video> [--at|--count|--every] [--montage]` — extract stills from any video
- `kino transcribe <video> [--format …] [--out …]` — **(reference videos only)** speech → timestamped transcript
- `kino scan <video> [--count|--every]` — **(reference videos only)** transcript + frames + contact sheet
- `kino batch <input.json>` — input is a JSON array of spec paths
- `kino voices [--gender]` · `kino avatars [--gender]` (Avatar-IV portrait looks only)
- `kino fonts` — list curated fonts (with descriptions + cache status)
- `kino projects [--new <name> --brand <brand>]` — list or scaffold projects
- `kino init [brand]` · `kino doctor`

## Analysing reference videos (research only)

`transcribe` and `scan` exist to study **other people's** videos — competitor ads, trending /
reference clips (e.g. what `using-spider` downloads). They are a **research tool, not a production
step.**

- `kino transcribe <video> [--format json|srt|vtt|text] [--out <file>]` — speech → timestamped
  transcript (`{ text, words:[{word,start,end}], segments:[…] }`). JSON is the agent-readable
  default; cached by audio content-hash.
- `kino scan <video> [--count N | --every S]` — transcript + one frame per segment (or evenly) +
  a labeled contact sheet, in one call. "View this clip."
- `kino frames <video> --count N | --every S | --at 1,3,5 [--montage]` — pull stills.

**Do NOT** run these on kino's own renders (we already have exact word timings from TTS — use
`kino inspect`/`frames`/`still`), and never wire them into `build` or spec authoring. STT is
ElevenLabs Scribe (~$0.40/hr); needs `ELEVENLABS_API_KEY`.

## Projects (file scoping)
Keep campaigns from cluttering each other. A **workspace** holds shared `brands/` + `.kino-cache/`;
each **project** is `projects/<name>/` with its own `specs/`, `assets/`, `out/`, and a `project.json`
that assigns a brand and optional default overrides:
```jsonc
{ "brand": "evidentcv", "background": "mesh", "provider": "none", "font": "Inter", "captionMode": "phrase" }
```
- kino infers the project by walking up from the spec's path to the nearest `project.json`
  (`kino build projects/launch/specs/hook.json`), or use `--project <name>`.
- Precedence: CLI flag > spec > project.json > brand. A spec may omit `brand` (the project supplies it).
- Brands are shared at the workspace, so brand assets (`logo`, `facelessBackdrop`) are workspace-relative;
  app assets (`assets/...`) are project-relative.
- **Back-compat:** with no `project.json`, the flat layout (`specs/ assets/ out/` at the root) still works.

## Iterative design loop (agents)
`still`/`storyboard`/`inspect` default to **mock** (fast, $0; captions/background/layout render identically —
only avatar+VO timing differ). Loop: `kino inspect` (map the beats) → `kino still --segment N` (preview one
beat in ~1–2s) → edit the spec → `kino still` again → `kino build` for the real render. Add `--real` for
true timing/avatar. Stills/storyboards land in `out/<title>/stills/` and `out/<title>/storyboard.png`.

## Brand config (`brands/<name>/brand.json`)
`name, colors{night,mint,green,white,gold}, font, captionStyle{fontSize,strokeWidth},
disclosure, facelessDisclosure?, bannedPhrases[], defaultVoice, defaultLook,
defaultProvider?, captionMode?, voiceAliases{}, lookAliases{}`.

Faceless branding (optional):
- `logo` — transparent brand mark (PNG); shown on faceless talking beats.
- `logoSize` — `small` (100px) / `medium` (150) / `big` (220) / a number. `logoPosition` — `top` /
  `bottom` / `left` / `right` / `center` / custom `{x,y}` (% of frame). Spec overrides brand; see `kino elements`.
  Tween it over time with spec `logoKeyframes: [{ at, params: { x, y, scale, opacity }, ease? }]`.
- `background` — faceless background engine (see below). Default: `image` if `facelessBackdrop`
  set, else `glow`. Override per-video with spec `background` or `--background <kind>`.
- `facelessBackdrop` — image used when `background: "image"`.
- `backgroundComponent` — custom draw-fn file, used when `background: "custom"`.
- `backgroundColors` — palette for animated backgrounds (default: mint/green/gold).
- `backgroundIntensity` — 0..1 motion strength (default 0.5); spec `backgroundIntensity` overrides.

## Faceless backgrounds
Frame-driven (deterministic) layers behind the hero text; a center scrim is auto-applied for legibility.
The backdrop is always the base layer (even in avatar mode), so app cut-in transitions reveal the brand
background rather than black — the avatar covers it on camera.
- `glow` — animated CSS brand glows (zero-config default).
- `image` — static `facelessBackdrop` with a slow Ken-Burns.
- `mesh` / `aurora` / `particles` / `grid` — built-in Canvas2D presets, auto-coloured from the brand.
- `custom` — your own Canvas2D `draw` fn. `backgroundComponent` points to a `.js` file whose body draws
  using `ctx` + `env` (`env.params`, `env.pulse`, `env.frame`, `env.width/height`).
  **Must be frame-driven** (use `env.frame`, never `Date.now()`/un-seeded `Math.random()`) or frames won't match.

### Animating the background (agent-driven)
`kino backgrounds` lists each preset's tweenable params (colorA/B/C, intensity) + actions (pulse). Drive
them over time from the spec — keyframe params (numbers lerp, colours RGB-lerp, optional `easeInOut`) and
fire one-shot actions at timestamps. Pair with `kino inspect` word times to sync to the VO.
```jsonc
"background": "mesh",
"backgroundKeyframes": [
  { "at": 0,   "params": { "intensity": 0.2, "colorA": "#80e2b4" } },
  { "at": 4.0, "params": { "intensity": 1.0, "colorA": "#d99a20" }, "ease": "easeInOut" }
],
"backgroundTriggers": [ { "at": 2.2, "action": "pulse" } ]
```
Easing per keyframe (`ease`): `linear` (default), `easeInOut`, `overshoot`, `spring` — the last two
exceed the target mid-way then settle (punchy landings). Applies to every keyframe track
(background / logo / caption / kicker).

Provider-specific:
- `avatarImage` — portrait file (path under project root) used as the source for `hedra`/`replicate`.
- `hedraModelId` — Character-3 model id (else auto-picks the first from Hedra `/models`).
- `replicateModel` — `owner/name[:version]` (default `bytedance/omni-human`, an official image+audio
  talking-head model that boots reliably; the community `cjwbw/sadtalker` deployment tends to cold-stall).
- `replicateImageField` / `replicateAudioField` — input keys for the chosen model (defaults `image` / `audio`).
- `replicateInput` — extra model inputs (default `{}`). Community models need their own keys, e.g. SadTalker:
  `replicateModel: "cjwbw/sadtalker"`, `replicateImageField: "source_image"`, `replicateAudioField: "driven_audio"`.
- Note: `bytedance/omni-human` is premium + slow (~100s+ per short clip); faceless stays the cheap default.

## Env keys (`.env`, never committed)
- `ELEVENLABS_API_KEY` — always (voiceover).
- `HEYGEN_API_KEY` (+ `heygen` CLI) — provider `heygen`.
- `HEDRA_API_KEY` — provider `hedra` (hedra.com/api-profile).
- `REPLICATE_API_TOKEN` — provider `replicate` (replicate.com/account/api-tokens).
Faceless (`none`) needs only ffmpeg + ELEVENLABS_API_KEY.

## Fonts
- `brand.font` is either a **registry font name** (`kino fonts` — e.g. `"Anton"`, `"Poppins"`) or a raw
  CSS family string (back-compat). A registry name is **downloaded on demand** (Google Fonts → real TTF,
  cached globally in `~/.kino/fonts/`) and loaded into the render via `FontFace`; offline → system fallback.
- `brand.labelFont` (registry name) sets the storyboard/montage label font (defaults to the caption font).

## Captions
- `captionMode` (brand default or per-segment): `phrase` (short editorial caption, block animation —
  default) or `words` (the **spoken `text`** revealed word-by-word, synced to the VO).
- `words` mode uses real word timings from ElevenLabs `…/with-timestamps` (faked evenly under `--mock`),
  so the on-screen words are the spoken words. Effects: typewriter reveal + pop, active-word highlight,
  and per-segment `emphasis: ["word", …]` (glow + shake on those words while active).
- **Highlight colour:** the currently-spoken (active) word and the **brand name** (`brand.name`,
  matched case/punctuation-insensitively) render in brand green (`colors.mint`) — one highlight state,
  no other colours. So the brand name pops green wherever it's spoken, in any project.
- **Tween captions/kickers** over time: per-segment `captionKeyframes` (and `kickerKeyframes` on app
  segments) `[{ at, params: { x, y, scale, opacity }, ease? }]` — x/y are offsets (% of frame), and `at`
  is **relative to the segment start** (`at: 0` = the caption's entrance). Logo + background keyframes are
  spec-level so their `at` is absolute on the main timeline. `kino elements`.

## Cost model
- Avatar engines bill per second of generated avatar; kino **trims the avatar to on-camera segments
  only** (app cut-ins aren't billed) and caches VO+avatar by content hash.
- Faceless = $0 avatar cost. Relative avatar price: replicate (pennies) < hedra (cheap, free tier) < heygen.

## Troubleshooting
- "does not support Avatar IV" → the look is a legacy studio avatar; pick one from `kino avatars`.
- "needs a portrait image" → set `brand.avatarImage` (or `spec.avatarLook`) for hedra/replicate.
- HeyGen timeout/credits → check `heygen` auth + remaining quota; each gen costs credits.
- App segments silent → the VO track must stage to `_public/vo.mp3` (build does this); avatars are muted.
- No captions/text issues → Remotion renders all text; the local minimal ffmpeg is never used for text.
- Re-render is free after a caption edit (VO/avatar are cached by content hash).
