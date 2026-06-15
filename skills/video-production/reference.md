# kino reference

## Commands
- `kino build <spec> [--mock] [--format 9:16,3:4]`
- `kino batch <input.json>` — input is a JSON array of spec paths
- `kino voices [--gender]` · `kino avatars [--gender]` (Avatar-IV portrait looks only)
- `kino init [brand]` · `kino doctor`

## Brand config (`brands/<name>/brand.json`)
`name, colors{night,mint,green,white,gold}, font, captionStyle{fontSize,strokeWidth},
disclosure, bannedPhrases[], defaultVoice, defaultLook, voiceAliases{}, lookAliases{}`.

## Troubleshooting
- "does not support Avatar IV" → the look is a legacy studio avatar; pick one from `kino avatars`.
- HeyGen timeout/credits → check `heygen` auth + remaining quota; each ~25s gen costs credits.
- No captions/text issues → Remotion renders all text; the local minimal ffmpeg is never used for text.
- Re-render is free after a caption edit (VO/avatar are cached by content hash).
