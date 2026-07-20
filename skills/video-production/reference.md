# kino reference

## Commands
- `kino build <spec> [--mock] [--format 9:16,3:4] [--provider <p>] [--background <kind>] [--tag <label>]`
- `kino inspect <spec> [--real]` — resolved plan as JSON: beats, timings, modes + per-segment **word timestamps**
- `kino backgrounds` — list animated backgrounds + their agent-controllable params/actions
- `kino elements` — list overlay elements (logo …) + their layout/tween controls
- `kino still <spec> [--at <s,…> | --segment <n> | --around <s>] [--span] [--count] [--montage] [--real] [--format]` — render still(s) fast; **`--around` after every motion edit**; `--at 0` for loop posters (`--segment` = midpoint only)
- `kino storyboard <spec> [--frames <n>] [--real] [--format]` — per-beat stills (default 2: composition + the fully-revealed end-state) tiled into a labeled contact sheet; the **·full** tile is where a caption overflows the frame or collides with a `texts` overlay
- `kino frames <video> [--at|--around|--count|--every] [--montage]` — extract stills from any video; `--around` sheets a moment (post-build twin of `still --around`; use after real VO to retune)
- Seamless loops / real-VO retune / per-beat harnesses — see SKILL.md §§ Seamless loops, Real VO retune
- `kino transcribe <video> [--format …] [--out …]` — **(reference videos only)** speech → timestamped transcript
- `kino scan <video> [--count|--every]` — **(reference videos only)** transcript + frames + contact sheet
- `kino batch <input.json>` — input is a JSON array of spec paths
- `kino voices [--gender]` · `kino avatars [--gender]` (Avatar-IV portrait looks only)
- `kino fonts` — list curated fonts (with descriptions + cache status)
- `kino projects [--new <name> --brand <brand>]` — list or scaffold projects
- `kino pexels "<query>" [--get n --project]` — stock b-roll (local thumbs cached on search)
- `kino music [query] [--get n --project]` — bundled beds or Freesound CC0 search (15–90s short-form)
- `kino audio-markers <file>` — onsets/peaks/silences for `sfx[].at`
- `kino init [brand]` · `kino doctor`

## Analysing reference videos (research only)

`transcribe` and `scan` exist to study **other people's** videos — competitor ads, trending /
reference clips (e.g. downloaded reference footage). They are a **research tool, not a production
step.**

- `kino transcribe <video> [--format json|srt|vtt|text] [--out <file>]` — speech → timestamped
  transcript (`{ text, words:[{word,start,end}], segments:[…] }`). JSON is the agent-readable
  default; cached by audio content-hash.
- `kino scan <video> [--count N | --every S]` — transcript + one frame per segment (or evenly) +
  a labeled contact sheet, in one call. "View this clip."
- `kino frames <video> --count N | --every S | --at 1,3,5 [--montage]` — pull stills.

**Source recordings (production):** to cut a long capture into `app` beats, seat it in chrome, or
retiming with `speed`/`pauseAt`, follow the `importing-footage` skill. Use `kino frames` on the
source file (not `scan`/`transcribe`). App fields: `clipFrom`, `clipTo`, `speed`, `pauseAt`, `frame`.

**Do NOT** run these on kino's own renders (we already have exact word timings from TTS — use
`kino inspect`/`frames`/`still`), and never wire them into `build` or spec authoring. STT is
ElevenLabs Scribe (~$0.40/hr); needs `ELEVENLABS_API_KEY`.

## Projects (file scoping)
Keep campaigns from cluttering each other. A **workspace** holds shared `brands/` + `.kino-cache/`;
each **project** is `projects/<name>/` with its own `specs/`, `assets/`, `out/`, and a `project.json`
that assigns a brand and optional default overrides:
```jsonc
{ "brand": "acme", "background": "mesh", "provider": "none", "font": "Inter", "captionMode": "phrase" }
```
- kino infers the project by walking up from the spec's path to the nearest `project.json`
  (`kino build projects/launch/specs/hook.json`), or use `--project <name>`.
- Precedence: CLI flag > spec > project.json > brand. A spec may omit `brand` (the project supplies it).
- Brands are shared at the workspace, so brand assets (`logo`, `facelessBackdrop`) are workspace-relative;
  app assets (`assets/...`) are project-relative.
- Specs must live under `projects/<name>/specs/` (with a `project.json`). No flat layout.

## Iterative design loop (agents)
`still`/`storyboard`/`inspect` default to **mock** (fast, $0; captions/background/layout render identically —
only avatar+VO timing differ). Loop: `kino inspect` (map the beats) → `kino still --segment N` (preview one
beat in ~1–2s) → edit the spec → `kino still` again → **`adversarial-critique` skill** (subagent on
`out/<title>/stills/sb-*.png`) → `kino build` for the real render. Add `--real`
for true timing/avatar. Stills/storyboards land in `out/<title>/stills/` and `out/<title>/storyboard.png`.

## Brand config (`brands/<name>/brand.md` YAML frontmatter)
`name, colors{night,mint,green,white,gold}, font, labelFont?, captionStyle{fontSize,strokeWidth,background?,style?,animation?},
disclosure, facelessDisclosure?, bannedPhrases[], defaultVoice, defaultLook,
defaultProvider?, captionMode?, voiceAliases{}, lookAliases{}` (+ the logo/background/provider fields below).

Frontmatter is validated **strict** — an unknown key throws at parse, not silently ignored. The
tell: `voiceModel` (expressive-VO model, see Hard rules in `SKILL.md`) looks brand-like but is
**spec-only**, there's no brand default for it. `provider`/`background`/`captionMode` exist at both
levels but mean "default" on the brand and "override" on the spec — same key, different file, don't
confuse setting the default with setting this video's value.

**Tone / Voice** lives in the markdown **guidelines body** (not frontmatter) — register, person, pace,
say/never-say examples, brand bans. Agents read it via `kino brand <name>` and apply `ad-voice` when
writing copy. The renderer ignores the body.

Faceless branding (optional):
- `logo` — transparent brand mark (PNG); shown on faceless talking beats.
- `logoSize` — `small` (100px) / `medium` (150) / `big` (220) / a number. `logoPosition` — `top` /
  `bottom` / `left` / `right` / `center` / custom `{x,y}` (% of frame). Spec overrides brand; see `kino elements`.
  Tween it over time with spec `logoKeyframes: [{ at, params: { x, y, scale, opacity }, ease? }]`.
- `background` — faceless background engine (see below). Default: `glow`. Set `background: "image"`
  when using a backdrop. Override per-video with spec `background` or `--background <kind>`.
- `facelessBackdrop` — image used when `background: "image"` (required for that kind).
- `backgroundComponent` — custom draw-fn file, used when `background: "custom"`.
- `backgroundColors` — palette for animated backgrounds (default: mint/green/gold).
- `backgroundIntensity` — 0..1 motion strength (default 0.5); spec `backgroundIntensity` overrides.

## Faceless backgrounds
Frame-driven (deterministic) layers behind the hero text; a center scrim is auto-applied for legibility.
The backdrop is always the base layer (even in avatar mode), so app cut-in transitions reveal the brand
background rather than black — the avatar covers it on camera.
- `glow` — animated CSS brand glows (zero-config default).
- `image` — static `facelessBackdrop` with a slow Ken-Burns.
- `solid` — static night + glow (**loop-safe**; no global-frame drift).
- `mesh` / `aurora` / `particles` / `grid` — built-in Canvas2D presets (draft-friendly; mesh is an easy generic tell).
- `custom` — your own Canvas2D `draw` fn. Set `backgroundComponent` on the **spec** (overrides brand) or
  brand frontmatter. Bare id → `assets-lib/backgrounds/` (start with `"brand-wash"`); path → project
  `assets/…` or workspace file. Same `env.params` / `env.pulse` / keyframes as presets.
  **Must be frame-driven** (use `env.frame`, never `Date.now()`/un-seeded `Math.random()`) or frames won't match.

**Picker:** identity → `custom`; loop → `solid`; photo → `image`; quick draft → `glow`/`mesh`. Run `kino backgrounds`.

### Animating the background (agent-driven)
`kino backgrounds` lists each preset's tweenable params (colorA/B/C, intensity) + actions (pulse). Drive
them over time from the spec — keyframe params (numbers lerp, colours RGB-lerp, optional `easeInOut`) and
fire one-shot actions at timestamps. Pair with `kino inspect` word times to sync to the VO.
```jsonc
"background": "custom",
"backgroundComponent": "brand-wash",
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
- `brand.labelFont` (registry name) sets the storyboard/montage label font (defaults to the caption
  font) **and** is staged as a second Remotion typeface motion beats can reach via `--kino-label-font`
  (falls back to `--kino-font` when unset) — use it for a mono/label face that shouldn't inherit the
  caption font's display weight (e.g. a boarding-pass-style chip inside a `kind:"motion"` beat).

## Captions
- `caption` is **optional** on every kind — omit it for a caption-free beat (no caption node mounts).
  Under a **words-mode brand**, also set per-beat `"captionMode": "phrase"` or synced spoken words still
  paint. Stylised typed UI (terminal/chat) → `speech-synced-ui` + motion `env.words`, not a fancy caption.
- `captionMode` (brand default or per-segment): `phrase` (short editorial caption, block animation —
  default, renders the `caption` field) or `words` (renders the **spoken `text`**, word-by-word, synced
  to the VO — `caption` is ignored in this mode).
- `words` mode uses real word timings from ElevenLabs `…/with-timestamps` (faked evenly under `--mock`),
  so the on-screen words are the spoken words. **Words accumulate, they don't scroll or replace** —
  each word fades in at its spoken time and stays on screen, so by the end of the beat the full
  sentence is visible, wrapped across lines. Keep `words`-mode `text` short (roughly 5-7 words per
  beat) — a longer line wraps 3+ lines and crowds the frame. Effects: typewriter reveal + pop,
  active-word highlight, and per-segment `emphasis: ["word", …]` (glow + shake on those words while active).
- **Highlight colour:** the currently-spoken (active) word and the **brand name** (`brand.name`,
  matched case/punctuation-insensitively) render in brand green (`colors.mint`) — one highlight state,
  no other colours. So the brand name pops green wherever it's spoken, in any project. **Choose
  `colors.mint` for contrast against the background:** a bright accent over a dark `night`, a deep one
  over a light ground. A dark saturated `mint` (deep red, navy) on a near-black background renders
  dimmer than the white body text — the highlight, the one thing meant to pop, recedes. If the brand's
  signature colour is dark, keep `mint` bright and express the brand colour through the background /
  `texts` overlays instead.
- **Tween captions/kickers** over time: per-segment `captionKeyframes` (and `kickerKeyframes` on app
  segments) `[{ at, params: { x, y, scale, opacity }, ease? }]` — x/y are offsets (% of frame), and `at`
  is **relative to the segment start** (`at: 0` = the caption's entrance). Logo + background keyframes are
  spec-level so their `at` is absolute on the main timeline. `kino elements`. **Default: omit
  `captionKeyframes`.** Per-beat `y`/`scale` variety reads as captions jumping; use only to dodge a
  bright subject on one beat. CTA end cards are `cta: true` (centered hero) — not a `y` offset into the
  lower-third. **Keyframe timing is
  authored against whatever duration is current when you preview** — under `--mock` that's faked evenly
  and can diverge from the real VO's pacing (a beat can run longer or shorter for real than its mock
  estimate), so a background pulse or color shift timed to land on a specific beat can drift into the
  wrong beat once real VO timing is in. If a spec times `backgroundKeyframes`/`backgroundTriggers`/
  `logoKeyframes` to a specific beat boundary, re-check that beat with `kino still --real` (VO is
  content-hash cached, so this doesn't add spend beyond the real build) before calling it done — don't
  reason your way past a mock/real duration mismatch you already noticed.
- **Motion layout (short-form):** author stacks mid-frame (`.wrap { top: 38%–42%; }`), not
  `translateY(20–28vw)` from the top — that sits under TikTok/Reels chrome. Keep the stack clear of
  the lower-third caption band; check with `kino still --segment <n>`. See SKILL.md § Short-form layout defaults.
- **Caption backplate** (legibility over light app screenshots): set brand
  `captionStyle.background { color?, opacity?, appOnly? }` to draw a translucent rounded panel behind the
  lower-third caption. Defaults: `color` = brand `night`, `opacity` = 0.82, `appOnly` = true (only behind
  captions on `app` cut-ins; faceless hero text is never plated). Opt-in — omit it and captions render
  exactly as before. Pairs with `captionKeyframes` for positioning.
- **Caption look** (`captionStyle`, top-level or per-segment, layered `segment ?? spec ?? brand.captionStyle.style`,
  default `stroke`): `stroke` (legacy — white ink, black stroke, mint active-word highlight) · `highlight`
  (active word / brand name in a rounded mint box in words mode, whole line on an opaque night plate in
  phrase/hero mode) · `gradient` (mint→green fill, stroke dropped, drop-shadow for legibility) · `minimal`
  (weight 700, no stroke, soft shadow; active/brand word mint).
- **Caption entrance** (`captionAnimation`, same layering, `brand.captionStyle.animation`): `pop` (spring
  scale-in) · `rise` (translateY cascade) · `typewriter` (staggered instant reveal) · `wave` (pop then a
  per-word sine bob) · `blur-in` (blur→0 + fade) · `none` (static). Unset = the surface's native entrance
  (`pop`; `rise` for faceless hero text) — word-reveal *timing* in `words` mode always stays VO-driven,
  the preset only shapes each word's entrance motion.
- **Caption reveal** (`captionReveal`, `words` mode only; layered `segment ?? spec ?? brand.captionStyle.reveal`,
  default `word`): `word` reveals each word at its VO time (per-word pop); `all` lays the whole caption out
  and fades it in together, the active word still highlighting as the VO reaches it. Reach for `all` (or
  `phrase` mode) on a **CTA or any long line** — a word-by-word reveal of a long caption reserves a big
  multi-line block and strands its first word at a wrapped corner during the VO pause before the next word.
- **Standalone text overlays**: per-segment `texts: [{ text, at, dur?, position?, size?, style?, animation? }]`
  drops a headline anywhere on the frame, independent of the segment's own caption. `at` is seconds from
  segment start; `dur` defaults to the segment end. `position` ∈ `top|center|bottom|left|right` (default
  `center`); `size` ∈ `small|medium|big` = 0.7/1/1.5× the caption font size (default `medium`); `style`/
  `animation` default to the segment's resolved caption look (animation falls back to `pop`). Overlays are
  clamped to their segment.

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
