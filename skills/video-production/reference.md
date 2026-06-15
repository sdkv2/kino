# kino reference

## Commands
- `kino build <spec> [--mock] [--format 9:16,3:4] [--provider none|heygen|hedra|replicate]`
- `kino batch <input.json>` — input is a JSON array of spec paths
- `kino voices [--gender]` · `kino avatars [--gender]` (Avatar-IV portrait looks only)
- `kino init [brand]` · `kino doctor`

## Brand config (`brands/<name>/brand.json`)
`name, colors{night,mint,green,white,gold}, font, captionStyle{fontSize,strokeWidth},
disclosure, facelessDisclosure?, bannedPhrases[], defaultVoice, defaultLook,
defaultProvider?, voiceAliases{}, lookAliases{}`.

Provider-specific:
- `avatarImage` — portrait file (path under project root) used as the source for `hedra`/`replicate`.
- `hedraModelId` — Character-3 model id (else auto-picks the first from Hedra `/models`).
- `replicateModel` — `owner/name[:version]` (default `cjwbw/sadtalker`).
- `replicateImageField` / `replicateAudioField` — input keys for the chosen model
  (defaults `source_image` / `driven_audio`).
- `replicateInput` — extra model inputs (default `{preprocess:"full",still:true,enhancer:"gfpgan"}`).

## Env keys (`.env`, never committed)
- `ELEVENLABS_API_KEY` — always (voiceover).
- `HEYGEN_API_KEY` (+ `heygen` CLI) — provider `heygen`.
- `HEDRA_API_KEY` — provider `hedra` (hedra.com/api-profile).
- `REPLICATE_API_TOKEN` — provider `replicate` (replicate.com/account/api-tokens).
Faceless (`none`) needs only ffmpeg + ELEVENLABS_API_KEY.

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
