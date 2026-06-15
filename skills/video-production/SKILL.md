---
name: video-production
description: Use when producing short-form vertical marketing videos for an app (TikTok/Reels/Shorts) with the `kino` CLI — AI avatar presenter + app screen footage + voiceover + captions. Covers authoring the video spec, the build workflow, and the cost/compliance guardrails.
---

# Producing videos with kino

`kino` turns a JSON **spec you author** into a finished 9:16 (and optional 3:4) video.
You supply the creative; the CLI handles VO (ElevenLabs) → avatar (HeyGen) → composite (Remotion).

## Workflow
1. `kino doctor` — confirm ffmpeg, the heygen CLI, and API keys are present.
2. Author a spec (schema below). Keep captions short; never claim guaranteed jobs/interviews.
3. `kino build specs/foo.json --mock` — render structure/timing with **zero API spend**; check frames.
4. `kino build specs/foo.json` — real render. Outputs to `out/<title>/`.

## Spec schema
```jsonc
{ "brand": "<brand>", "title": "kebab-case", "format": ["9:16"], "voice": "<alias>",
  "segments": [
    { "kind": "avatar", "text": "spoken + lip-synced", "caption": "on-screen text", "cta": true },
    { "kind": "app", "asset": "screens/x.png", "text": "spoken (avatar hidden)", "caption": "...",
      "kicker": { "text": "86% match", "color": "mint" } } ] }
```
- `avatar` segments show the presenter; `app` segments show the screenshot/recording while the VO continues.
- Open with an `avatar` hook, cut to `app` for the demo, return to `avatar` for the payoff + `cta`.

## Hard rules (the CLI enforces these — don't fight them)
- **Avatar looks must be Avatar-IV photo-avatars** — list valid ones with `kino avatars --gender male`.
  Brand `lookAliases` map a friendly name → look id.
- Voices: `kino voices --gender male`. Match voice age/gender to the avatar.
- **Timing comes from the generated VO**, not your guesses — don't put timestamps in the spec.
- **AI disclosure is mandatory** and added automatically from the brand.
- Banned outcome phrases (get the job, guaranteed interview, …) fail the build — keep copy honest.
- Use `--mock` while iterating to avoid HeyGen credit spend; real builds cache VO+avatar so edits to
  captions don't re-bill.

See `reference.md` for command flags, brand config, and troubleshooting.
