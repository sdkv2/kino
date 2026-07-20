# kino — agent-driven video production CLI

**Date:** 2026-06-15 · **Status:** design approved, pending spec review → writing-plans

## Summary
`kino` is a global, reusable CLI that turns a **spec** (the creative, authored by an AI agent)
into finished vertical short-form videos. A companion **Claude skill** teaches an agent how to
write specs and drive the CLI. Clean separation of concerns: **the agent supplies creativity; the
CLI performs deterministic production.** No LLM lives inside the CLI.

Born from the Acme organic-content pipeline (ElevenLabs VO → HeyGen avatar → Remotion
composite), generalized into a standalone tool.

## Goals
- One command (`kino build --spec s.json`) produces a post-ready 1080×1920 (and 1080×1440) MP4.
- Composable subcommands so an agent can drive each step and debug.
- Reusable across any app via per-project brand configs + specs (not coupled to Acme).
- **Agent-safe:** `--mock` mode (zero API spend), content-hash caching (don't re-bill on edits),
  `doctor` preflight, strict spec validation, and a hard guard against the HeyGen Avatar-IV trap.
- Reproducible & cheap: ~$0.50–1.00/video with avatar; the only paid calls are ElevenLabs + HeyGen.

## Non-goals (v1 — YAGNI)
LLM script generation (the driving agent writes scripts), AI b-roll (Kling/fal), avatar
picture-in-picture compositing, local Whisper captions, multiple templates, and Layer-2 posting.
All are explicitly deferred; the architecture leaves room for them.

## The model
```
Agent (Claude + skill)                kino CLI (deterministic)
  authors a spec.json   ───────────▶   build: vo → avatar → render → out.mp4
  (hook, segments, captions)            (ElevenLabs, HeyGen, Remotion, ffmpeg)
```

## Tech stack
- **Language:** Node.js / TypeScript (cohesive with Remotion; Node's TLS works here, unlike the
  machine's Python 3.14 which throws `CERTIFICATE_VERIFY_FAILED`).
- **VO:** ElevenLabs REST via `fetch` (per-segment clips + one stitched continuous track).
- **Avatar:** HeyGen — official `heygen` CLI or REST. Audio-driven lip-sync (`audio_asset_id`).
  **MUST use Avatar-IV photo-avatar "looks"** (`heygen avatar looks list --avatar-type photo_avatar`);
  legacy studio avatars reject audio with *"does not support Avatar IV."*
- **Compositor:** **Remotion**, rendered programmatically via `@remotion/renderer` (no CLI shell).
  One parameterized composition lays out avatar segments, app cut-ins, captions, kickers, and the
  AI-disclosure footer, styled from the brand config. Remotion does ALL text → sidesteps the
  machine's minimal ffmpeg (no `drawtext`/`libass`).
- **ffmpeg:** only for VO stitching + duration probing (`ffprobe`). No text rendering.

## Data flow (`build`)
1. **Validate** spec against schema; resolve brand/voice; check assets exist; compliance scan
   (reject banned guaranteed-outcome phrases).
2. **VO:** generate one ElevenLabs clip per segment → `ffprobe` durations → compute segment
   start/end offsets → stitch a continuous `vo.mp3` (0.32s gaps). Cache by hash(text+voice+settings).
3. **Avatar:** upload `vo.mp3` as a HeyGen asset → create Avatar-IV video (look, 9:16, 1080p) →
   poll → download `avatar.mp4` (+ SRT sidecar). Cache by hash(vo + look + dims).
4. **Render:** Remotion composition props = { brand, avatarPath, segments[with offsets], formats }.
   Avatar is the base video; `app` segments overlay their asset (Ken-Burns for stills, OffthreadVideo
   for recordings); captions per segment; disclosure footer. Render 9:16 and 3:4.
5. **Output** to `out/<title>/{spec.json, vo.mp3, avatar.mp4, captions, final-9x16.mp4, final-3x4.mp4}`.

## The video spec (agent-authored contract)
```jsonc
{
  "brand": "acme",
  "title": "lie-test",
  "format": ["9:16", "3:4"],          // default ["9:16"]
  "voice": "will",                     // optional; else brand default
  "avatarLook": "lucas",               // optional alias; else brand default
  "segments": [
    { "kind": "avatar", "text": "I ran my CV through five AI tools.",
      "caption": "I tested 5 AI resume tools" },
    { "kind": "app", "asset": "screens/05-match.png",
      "text": "It scores the match, then traces every claim back to your real experience.",
      "caption": "every claim → your real CV",
      "kicker": { "text": "86% match", "color": "mint" } },   // optional pill
    { "kind": "avatar", "text": "Search Acme on the App Store. Free to try.",
      "caption": "search Acme — it's free", "cta": true }
  ]
}
```
- `kind: "avatar"` → presenter on screen. `kind: "app"` → the asset covers the avatar while the VO
  continues (the proven UGC demo rhythm). `text` drives both VO and lip-sync; `caption` is the
  burned on-screen text (may differ/condense). Timing is **derived from measured VO**, never guessed.

## Config & project layout
`kino` is installed globally and run from a **project dir** (e.g. `~/Downloads/EvidentCvMarketing`):
```
<project>/
  .env                      # ELEVENLABS_API_KEY, HEYGEN_API_KEY
  brands/<name>/
    brand.json              # palette, fonts, typography, captionStyle, disclosure, compliance words
    voice.json              # ElevenLabs voiceId+settings; avatar look id(s); alias map
  assets/{screens,recordings,avatar,vo}/
  specs/*.json
  out/<title>/...
```
Brands are portable; a new app = a new `brands/<name>/` + its specs. Compliance (AI disclosure text,
banned-phrase list) lives in `brand.json` and is enforced at validate + render time.

## CLI commands
| Command | Purpose |
|---|---|
| `kino build --spec s.json [--format ...] [--mock] [--no-cache]` | End-to-end: vo → avatar → render → out. |
| `kino batch --input b.json [--mock]` | Render many specs (array or glob). |
| `kino vo --spec s.json` | Generate VO clips + stitched track + timing.json only. |
| `kino avatar --spec s.json --vo vo.mp3` | Generate the HeyGen avatar clip only. |
| `kino render --spec s.json --vo … --avatar …` | Remotion render only. |
| `kino voices [--lang --gender]` | List ElevenLabs voices. |
| `kino avatars [--gender]` | List **Avatar-IV-capable** HeyGen looks (the usable ones). |
| `kino init [brand]` | Scaffold `.env`, a brand config, and dirs in the current project. |
| `kino doctor` | Preflight: node/ffmpeg/heygen CLI present, keys set, HeyGen quota, gotcha warnings. |

## Agent-safety features
- **`--mock`**: silent VO (ffmpeg sine/anull) + placeholder avatar (brand-colour card) → full
  pipeline runs with **zero API spend**. Default in tests/CI.
- **Content-hash caching** (`.kino-cache/`): VO keyed by hash(text+voice+settings); avatar by
  hash(vo+look+dims). Editing only captions re-renders Remotion but does NOT re-bill VO/avatar.
- **Validation**: JSON-schema for spec + brand; missing-asset and missing-key errors are explicit.
- **Avatar-IV guard**: `avatar` step verifies the look supports `avatar_iv`; else fails fast with a
  message pointing at `kino avatars`.
- **Quota guard**: before any HeyGen generate, read remaining quota; warn/refuse if insufficient.
- **Compliance guard**: scan all `text`/`caption` against the brand's banned-phrase list
  (guaranteed job/interview/etc.); fail with the offending phrase.

## Remotion composition
A single `KinoVideo` composition, props-driven from the spec:
- Base layer: `<OffthreadVideo src={avatar}>` (carries audio). In `--mock`/no-avatar, a brand card.
- Per `app` segment: `<Sequence>` overlay — `<Img>` (Ken-Burns) for stills or `<OffthreadVideo>` for
  recordings, cover-fit to frame, optional `kicker` pill.
- Captions: chunky TikTok style (white + thick stroke), one per segment, from brand `captionStyle`.
- Disclosure footer (persistent) from brand config.
- Renders at each requested format (9:16=1080×1920, 3:4=1080×1440).

## The Claude skill (`video-production`)
A skill that teaches an agent to use `kino`:
- **When** to use it (producing short-form app-marketing video).
- **The spec schema** + authoring guidance (segment rhythm, caption style, CTA).
- **Workflow**: `doctor` → write spec → `build --mock` to preview structure → `build` for real.
- **Conventions**: brand/asset layout; how to add a brand (`init`).
- **Gotchas** (baked in): Avatar-IV looks only; timing comes from measured VO; AI disclosure is
  mandatory; compliance/no-outcome-claims; `--mock` to avoid spend; caching semantics.
- Ships with `kino` (e.g. `skills/video-production/SKILL.md` + a `reference.md` command/troubleshooting).

## Testing
- Unit: spec/brand schema validation; timing math (offsets from durations); compliance scan; cache
  key derivation. Integration: `build --mock` end-to-end produces a valid MP4 with audio+video
  streams (assert via ffprobe). No paid calls in tests.

## Known gotchas (carried from the Acme build → encoded in the tool)
1. HeyGen audio lip-sync needs **Avatar-IV photo-avatar looks**, not legacy studio avatars.
2. HeyGen **asset upload** (`audio_asset_id`) beats hosting a public URL.
3. HeyGen returns an **SRT sidecar** (caption timing) — no Whisper needed.
4. Python 3.14 here throws SSL cert errors → Node `fetch` avoids it.
5. Local Homebrew ffmpeg is **minimal (no drawtext/libass)** → Remotion does all text.
6. Match avatar gender/age to the voice; voices via `kino voices`, looks via `kino avatars`.
7. Disk runs tight on this machine → cache + clean `out/` aggressively.

## Future (post-v1)
LLM script-gen subcommand, Kling/fal b-roll, avatar PiP (webm-alpha overlay), Whisper karaoke
captions, multiple templates, Layer-2 auto-posting hooks, npm publish.
