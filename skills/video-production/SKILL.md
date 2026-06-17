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
- Open with an `avatar` hook, cut to `app` for the demo, return to `avatar` for the payoff + `cta`.
- **Camera/transitions auto-vary** — omit and `kino` picks a varied shot + transition per cut-in.
  Override per segment with `"shot"` (`push-in`/`pull-out`/`pan-left`/`pan-right`/`tilt-up`/`static`,
  plus `scroll`/`scroll-up` to pan vertically through a **tall** app still — a simulated scroll that
  reveals content below the frame; opt-in, so it's never auto-picked)
  and, on `app` segments, `"transition"` (`fly-left`/`fly-up`/`pop`/`fade`/`cut` — spring/CapCut-style).
- **Faceless backgrounds animate**: `kino backgrounds` lists each preset's params (colours/intensity) +
  actions (pulse). Tween them over time with `backgroundKeyframes` and fire `backgroundTriggers` at
  timestamps; sync to the VO using per-word times from `kino inspect`.
- **Overlay elements tween** (`kino elements`): the logo has `logoSize` (small/medium/big/px) +
  `logoPosition` (top/bottom/left/right/center/{x,y}%) and `logoKeyframes`; captions + kickers tween via
  per-segment `captionKeyframes` / `kickerKeyframes` — all x/y/scale/opacity over time, same keyframe system.
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
  last glyph's edge keeps its gradient instead of being clipped. **Stagger reveals** so things don't all land at once — auto-stagger a
  list with `sibling-index()` (`--d: calc((sibling-index() - 1) * .08)`), give each element its own
  slice of `--progress`, or use a param-per-element with offset keyframe `at` times for spring/ease
  control. Run `kino motion` for the full contract, the stagger recipes, and a copyable example;
  preview with `kino still`/`storyboard` like any other beat.

## Hard rules (the CLI enforces these — don't fight them)
- **HeyGen looks must be Avatar-IV photo-avatars** — list valid ones with `kino avatars --gender male`.
  Brand `lookAliases` map a friendly name → look id. For `hedra`/`replicate`, set `brand.avatarImage`
  (a portrait file) instead — those engines lip-sync a source image, not a hosted id.
- Voices: `kino voices --gender male`. Match voice age/gender to the avatar.
- **Timing comes from the generated VO**, not your guesses — don't put timestamps in the spec.
- **AI disclosure is mandatory** and added automatically from the brand. Faceless videos use
  `brand.facelessDisclosure` (no "avatar" claim) when set.
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
