---
name: video-production
description: Use when producing short-form vertical marketing videos for an app (TikTok/Reels/Shorts) with the `kino` CLI — AI avatar presenter + app screen footage + voiceover + captions. Covers authoring the video spec, the build workflow, and the cost/compliance guardrails.
---

# Producing videos with kino

`kino` turns a JSON **spec you author** into a finished 9:16 (and optional 3:4) video.
You supply the creative; the CLI handles VO (ElevenLabs) → avatar (optional) → composite (Remotion).

## Workflow
1. `kino doctor` — confirm ffmpeg and the keys for your chosen provider are present.
   (`kino fonts` lists fonts settable as `brand.font`/`brand.labelFont` — downloaded on demand.)
   Brands are **optional markdown** — `brands/<name>/brand.md` (YAML frontmatter for palette/font/voice/
   disclosure + a free-form guidelines body). Run `kino brand <name>` to read a brand's styling rules;
   with no brand, kino uses its defaults. (Set the brand via `spec.brand` or a project's `project.json`.)
2. Author a spec (schema below). Keep captions short; never claim guaranteed jobs/interviews.
3. **Iterate (fast, free):** `kino inspect specs/foo.json` to map the beats, then
   `kino still specs/foo.json --segment N` (one frame, ~1–2s) or `kino storyboard specs/foo.json`
   (all beats in one contact sheet). Edit the spec, re-preview. These default to mock (zero spend).
4. `kino build specs/foo.json` — real render → `out/<title>/`. (`kino frames <mp4> --at …` for post-build QA.)

**Projects** keep campaigns tidy: `projects/<name>/{specs,assets,out}` + a `project.json` that assigns a
shared brand and default overrides. Run any command on a spec inside a project (kino infers it from the
path) or pass `--project <name>`. `kino projects --new <name> --brand <brand>` scaffolds one. The flat
layout (no `project.json`) still works.

## Avatar provider (cost lever — pick deliberately)
Set per spec with `"provider"`, or per brand with `defaultProvider`, or override with `--provider`:
- **`none` (faceless)** — no avatar; app footage + VO + captions only. **$0 avatar cost**, and the
  strongest format for app installs because it shows the product. Default for most videos.
- **`heygen`** — Avatar-IV hosted look. Highest quality, most expensive (~20 credits/min). Needs a look id.
- **`hedra`** — Character-3. Cheap API + free monthly tier. Needs `brand.avatarImage` (a portrait).
- **`replicate`** — open-source lip-sync (default SadTalker). Pennies/clip. Needs `brand.avatarImage`.

Two automatic savings when an avatar IS used: the avatar is **trimmed to the on-camera segments only**
(app cut-ins aren't billed), and VO + avatar are **content-hash cached** so caption/motion edits don't re-bill.

## Spec schema
```jsonc
{ "brand": "<brand>", "title": "kebab-case", "format": ["9:16"], "voice": "<alias>",
  "provider": "none",            // none | heygen | hedra | replicate (else brand.defaultProvider)
  "background": "mesh",          // faceless bg: glow|image|mesh|aurora|particles|grid|custom (else brand.background)
  "segments": [
    { "kind": "avatar", "text": "spoken (+ lip-synced if an avatar provider is set)", "caption": "on-screen text", "cta": true },
    { "kind": "app", "asset": "screens/x.png", "text": "spoken (avatar hidden)", "caption": "...",
      "captionMode": "words", "emphasis": ["claim"],  // optional: spoken text, word-synced + highlighted
      "kicker": { "text": "86% match", "color": "mint" } } ] }
```
- `avatar` segments are the on-camera/hook/payoff beats; `app` segments show the screenshot/recording while the VO continues. (Faceless still uses these kinds — `avatar` beats become branded caption cards.)
- **Emphasis is a spice, not a sauce** — `emphasis` adds a glow to the marked word while it's spoken.
  Cap it at one word (max two) per beat, on the single word carrying the claim; several emphasised
  words per beat reads as noise and devalues all of them. Beats can (and often should) have none.
- Open with an `avatar` hook, cut to `app` for the demo, return to `avatar` for the payoff + `cta`.
- **Media density**: caption cards are connective tissue, not the show — viewers stay for footage,
  screenshots, and motion. Target roughly **half the runtime on media** (`app` cut-ins, `motion`
  beats, motionOverlays): in a ~20s spec that's 2-3 `app` beats + at least one `motion`/Lottie
  moment. Never run more than two plain caption-card beats back-to-back; break the pattern with a
  cut-in or overlay. B-roll sources: project assets, `kino pexels`, `assets-lib/lottie/`.
  **Consecutive `app` beats crossfade shot-to-shot automatically** (the first holds under the next's
  fade-in — no background flash between them), so sequencing related footage back-to-back is
  encouraged: it reads as edited film, not a slideshow.
- **Camera/transitions auto-vary** — omit and `kino` picks a varied shot + transition per cut-in.
  Override per segment with `"shot"` (`push-in`/`pull-out`/`pan-left`/`pan-right`/`tilt-up`/`static`,
  plus `scroll`/`scroll-up` to pan vertically through a **tall** app still — a simulated scroll that
  reveals content below the frame; opt-in, so it's never auto-picked)
  and, on `app` segments, `"transition"` (`fade`/`dissolve`/`fly-left`/`fly-up`/`pop`/`cut`).
  Auto-vary is asset-aware: video b-roll defaults to the soft pair (`dissolve`/`fade`) and UI stills
  to the punchy rotation — match that instinct when overriding (footage wants a natural fade, not a
  spring fly-in).
- **Faceless backgrounds animate**: `kino backgrounds` lists each preset's params (colours/intensity) +
  actions (pulse). Tween them over time with `backgroundKeyframes` and fire `backgroundTriggers` at
  timestamps; sync to the VO using per-word times from `kino inspect`.
- **Overlay elements tween** (`kino elements`): the logo has `logoSize` (small/medium/big/px) +
  `logoPosition` (top/bottom/left/right/center/{x,y}%) and `logoKeyframes`; captions + kickers tween via
  per-segment `captionKeyframes` / `kickerKeyframes` — all x/y/scale/opacity over time, same keyframe system.
- **Stylised captions**: `captionStyle` (`stroke`/`highlight`/`gradient`/`minimal`, default `stroke`) and
  `captionAnimation` (`pop`/`rise`/`typewriter`/`wave`/`blur-in`/`none`, default = the surface's native
  entrance) set top-level or per-segment (segment overrides spec overrides brand). Per-segment
  `texts: [{ text, at, dur?, position?, size?, style?, animation? }]` drops standalone headline overlays
  anywhere on the frame (slot + small/medium/big, independent of the segment's own caption). Details +
  the style/animation tables in `reference.md`.
- **Motion graphics** (`kino motion`): for a fully custom animated beat or overlay, author a
  self-contained HTML/CSS file in `assets/motion/` and reference it from the spec — a full-screen
  beat (`{ "kind": "motion", "source": "motion/x.html", "text": "spoken VO" }`) or an overlay on an
  app/avatar beat (`"motionOverlay": { "source": "motion/x.html" }`). **You write the HTML/CSS; the
  JSON owns timing.** Animate by reading kino-set CSS variables — `--progress` (0→1 over the beat),
  `--t`, `--frame`, `--pulse`, your `params` (e.g. `--pct`, tweened by `keyframes`), and the brand
  palette (`--kino-mint` etc.). You can also use real **`@keyframes`** — add `class="kino-anim"` and
  kino force-pauses + scrubs them across the beat deterministically (sub-timing in the `%` stops,
  stagger via `--kino-delay`). **No CSS `transition`/JS and don't set `animation-play-state`** — motion
  is always frame-driven (CSS variables or scrubbed `@keyframes`). For gradient-filled text
  (`background-clip:text`) with tight/negative `letter-spacing`, add `class="kino-cliptext"` so the
  last glyph's edge keeps its gradient instead of being clipped. For loops/computed geometry, point
  `source` at a `.js` file whose body is `render(env)` returning an HTML string (evaluated per frame,
  determinism-linted) instead of a `.html` file. **Stagger reveals** so things don't all land at once — auto-stagger a
  list with `sibling-index()` (`--d: calc((sibling-index() - 1) * .08)`), give each element its own
  slice of `--progress`, or use a param-per-element with offset keyframe `at` times for spring/ease
  control. Run `kino motion` for the full contract, the stagger recipes, and a copyable example;
  preview with `kino still`/`storyboard` like any other beat.
  **Tier-3 Lottie (`.json`):** point `source` at a designer-authored Bodymovin/LottieFiles `.json` file
  to embed organic illustrated motion or AE-produced animations that an agent can't hand-author. kino
  plays it deterministically via `@remotion/lottie`. Key rule: for a `motionOverlay`, the asset **must
  have a transparent background** — an opaque export occludes the avatar or app screenshot. Add
  `"loop": true` (sibling of `source`) to loop at native speed; default plays once stretched across the
  beat. **Word-fire:** give the Lottie `triggers` at VO word times (from `kino inspect`) and each fires a
  fresh one-shot burst in sync with the words (use a short, transparent burst asset; triggers override
  stretch/loop). Assets must embed images (base64 `data:` URIs) and outline/embed fonts (no system fonts,
  no AE expressions). Works in all three motion slots (`kind:"motion"`, `motionOverlay` on `avatar` or `app`).
  **Ready-made library:** `assets-lib/lottie/` (repo root) holds pre-cleaned, brand-neutral LottieFiles
  templates (wave background, card carousels, logo reveal) — copy into the project's `assets/motion/`
  and reference directly. Rebrand a logo/image slot by replacing the image asset's base64 `p` payload.
  When adapting fresh LottieFiles downloads yourself, see "Sourcing from LottieFiles" in
  docs/motion-graphics.md — notably: strip the `fh`/`fs`/`fb` block creator exports stamp on text
  animators (renders all text red in lottie-web), delete the near-universal opaque `Background` layer,
  and don't rewrite template text (glyphs are baked; only exported characters render).

## Stock b-roll (Pexels)
When a beat needs real-world footage the brand assets can't provide — lifestyle shots, environments,
hands-on-phone, city texture — pull licensed stock video instead of settling for a static screenshot:
`kino pexels "city commute at night"` lists portrait clips (duration, size, author), then
`kino pexels "city commute at night" --get 2 --project <name>` downloads into `assets/pexels/<id>.mp4`.
Reference it from an `app` segment like any asset (`"asset": "pexels/<id>.mp4"` — .mp4 assets play
with the same shots/transitions as stills). Prefer real product footage when it exists; match the
clip's duration to the beat's VO length (durations are listed). Needs `PEXELS_API_KEY` (free — pexels.com/api).
**Caption legibility over footage is not optional:** stock/photographic clips have uncontrolled
luminance, so before shipping a spec with video (or busy screenshot) cut-ins, make sure the brand
sets `captionStyle.background` (the translucent lower-third backplate, `appOnly` by default) — ink
captions straight on dark footage disappear. Same check for kickers: pick a kicker `color` whose
brand chip contrasts with the footage (preview with `kino still --segment <n>` before a real build).

## Hard rules (the CLI enforces these — don't fight them)
- **HeyGen looks must be Avatar-IV photo-avatars** — list valid ones with `kino avatars --gender male`.
  Brand `lookAliases` map a friendly name → look id. For `hedra`/`replicate`, set `brand.avatarImage`
  (a portrait file) instead — those engines lip-sync a source image, not a hosted id.
- Voices: `kino voices --gender male`. Match voice age/gender to the avatar — and to the **brand's
  personality**: don't leave every brand on the same default voice. If `kino voices` 401s (a scoped
  key without voices_read), these premade ElevenLabs voices work on every account — pick by character:
  `21m00Tcm4TlvDq8ikWAM` Rachel (calm narrative F) · `AZnzlk1XvdvUeBnXmlld` Domi (confident, punchy F) ·
  `EXAVITQu4vr4xnSDxMaL` Sarah (soft, warm F) · `ErXwobaYiN019PkySvjV` Antoni (warm, easy M) ·
  `TxGEqnHWrfWFTfGW9XjX` Josh (deep, serious M) · `pNInz6obpgDQGcFmaJgB` Adam (broadcast M).
  Set it per spec (`"voice"`) or per brand (`defaultVoice`).
- **Expressive VO (audio tags)**: set spec `"voiceModel": "eleven_v3"` and direct the read inline in
  segment text with bracketed tags — `[excited]`, `[whispers]`, `[sighs]`, `[laughs]`, `[curious]`,
  `[short pause]`. Tags are stripped from word-synced captions automatically. Use like emphasis: 1-2
  tags per spec where the copy earns them (a hook, a reveal), not on every beat. v3 reads are less
  timing-stable than v2 — keep it off metronome-critical specs. Faceless only for now: with an avatar
  provider the tagged text also reaches lip-sync, untested.
- **Timing comes from the generated VO**, not your guesses — don't put timestamps in the spec.
- **AI disclosure** is added automatically from the brand when it sets one (`disclosure` /
  `facelessDisclosure`, the latter for faceless — no "avatar" claim); with no brand or none set, none is shown.
- Banned outcome phrases (get the job, guaranteed interview, …) fail the build — keep copy honest.
- Use `--mock` while iterating to avoid avatar credit spend; real builds cache VO+avatar so edits to
  captions don't re-bill. Faceless real builds spend only ElevenLabs (no avatar credits at all).

## Analysing reference videos (research only)

Use `kino transcribe <video>` / `kino scan <video>` ONLY to study external reference clips
(competitors, trending videos from `using-spider`). They transcribe speech to timestamped text and
pull frames so you can see what's said and shown.

Never use them on our own rendered output (we already have word timings from TTS — use `kino
inspect`), and never inside the build pipeline. See `reference.md` for flags.

See `reference.md` for command flags, brand config, and troubleshooting.
