# kino reference

## Commands
- `kino build <spec> [--mock] [--format 9:16,3:4] [--provider <p>] [--background <kind>] [--tag <label>]`
- `kino inspect <spec> [--real]` — print the resolved plan (beats, timings, modes) as JSON
- `kino still <spec> [--at <s,…> | --segment <n>] [--real] [--format]` — render one frame fast (no encode)
- `kino storyboard <spec> [--real] [--format]` — one still per beat tiled into a labeled contact sheet
- `kino frames <video> --at <s,…> [--montage] [--out <dir>]` — extract frames from a rendered video
- `kino batch <input.json>` — input is a JSON array of spec paths
- `kino voices [--gender]` · `kino avatars [--gender]` (Avatar-IV portrait looks only)
- `kino fonts` — list curated fonts (with descriptions + cache status)
- `kino init [brand]` · `kino doctor`

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
- `logo` — transparent brand mark (PNG); shown top-center on faceless talking beats.
- `background` — faceless background engine (see below). Default: `image` if `facelessBackdrop`
  set, else `glow`. Override per-video with spec `background` or `--background <kind>`.
- `facelessBackdrop` — image used when `background: "image"`.
- `backgroundComponent` — custom draw-fn file, used when `background: "custom"`.
- `backgroundColors` — palette for animated backgrounds (default: mint/green/gold).
- `backgroundIntensity` — 0..1 motion strength (default 0.5); spec `backgroundIntensity` overrides.

## Faceless backgrounds
Frame-driven (deterministic) layers behind the hero text; a center scrim is auto-applied for legibility.
- `glow` — animated CSS brand glows (zero-config default).
- `image` — static `facelessBackdrop` with a slow Ken-Burns.
- `mesh` / `aurora` / `particles` / `grid` — built-in Canvas2D presets, auto-coloured from the brand.
- `custom` — your own Canvas2D `draw` fn. `backgroundComponent` points to a `.js` file whose body draws
  using `ctx` + `env`, e.g.: `const {frame,width,height,colors,intensity}=env; ctx.fillStyle=colors[0]; ...`.
  **Must be frame-driven** (use `env.frame`, never `Date.now()`/un-seeded `Math.random()`) or frames won't match.

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
