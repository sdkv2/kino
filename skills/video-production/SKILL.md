---
name: video-production
description: Use when producing short-form vertical marketing videos for an app (TikTok/Reels/Shorts) with the `kino` CLI — AI avatar presenter + app screen footage + voiceover + captions. Covers authoring the video spec, the build workflow, and the cost/compliance guardrails.
---

# Producing videos with kino

`kino` turns a JSON **spec you author** into a finished 9:16 (and optional 3:4) video.
You supply the creative; the CLI handles VO (ElevenLabs) → avatar (optional) → composite (Remotion).

## Workflow
1. `kino doctor` — confirm ffmpeg and the keys for your chosen provider are present.
2. Author a spec (schema below). Keep captions short; never claim guaranteed jobs/interviews.
3. **Iterate (fast, free):** `kino inspect specs/foo.json` to map the beats, then
   `kino still specs/foo.json --segment N` (one frame, ~1–2s) or `kino storyboard specs/foo.json`
   (all beats in one contact sheet). Edit the spec, re-preview. These default to mock (zero spend).
4. `kino build specs/foo.json` — real render → `out/<title>/`. (`kino frames <mp4> --at …` for post-build QA.)

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
  Override per segment with `"shot"` (`push-in`/`pull-out`/`pan-left`/`pan-right`/`tilt-up`/`static`)
  and, on `app` segments, `"transition"` (`fly-left`/`fly-up`/`pop`/`fade`/`cut` — spring/CapCut-style).

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

See `reference.md` for command flags, brand config, and troubleshooting.
