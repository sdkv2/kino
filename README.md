<p align="center">
  <img src="logo/kino-logo.png" alt="kino — /ˈkiːnoʊ/ n. German: cinema, from Greek kīnēma: motion" width="560">
</p>

<p align="center"><em>Agent-driven short-form video production — spec in, video out.</em></p>

---

**kino** turns an agent-authored JSON spec into finished vertical videos:
ElevenLabs voiceover → optional AI avatar (HeyGen / Hedra / Replicate) or **faceless** → Remotion composite → 9:16 / 3:4 MP4.
The agent supplies the creative; `kino` handles deterministic production.

- **Design spec:** [`docs/superpowers/specs/2026-06-15-kino-design.md`](docs/superpowers/specs/2026-06-15-kino-design.md)
- **Implementation plan:** [`docs/superpowers/plans/2026-06-15-kino.md`](docs/superpowers/plans/2026-06-15-kino.md)

> **Status:** v1.2 — pluggable avatar providers, faceless mode, avatar-trim, brand logo/disclosure,
> animated background engine, word-synced captions, output tagging, `--mock`, caching, `doctor`. 51 tests green.

## Install (global)
```bash
cd ~/kino && npm install && npm run build && npm link   # provides the `kino` command
```
Requires Node 18+, ffmpeg/ffprobe, the HeyGen CLI (`heygen`), and ElevenLabs + HeyGen keys in the project `.env`.

## Use
```bash
cd <project> && kino init evidentcv     # scaffold .env, brand, dirs
# ...fill brand.json (voiceAliases/lookAliases), add assets/, write specs/
kino doctor
kino build specs/lie-test.json --mock   # free structural preview (no API spend)
kino build specs/lie-test.json          # real render → out/lie-test/
```
The driving agent authors specs — see [`skills/video-production`](skills/video-production/SKILL.md).

## Pipeline & options (v1.1)
- **Avatar engine** — `provider` (spec) / `defaultProvider` (brand) / `--provider`:
  `none` (faceless, $0), `heygen` (Avatar-IV), `hedra` (Character-3), `replicate` (open-source lip-sync).
  Avatars are **trimmed to on-camera segments** to cut spend; VO + avatar are content-hash cached.
- **Faceless backgrounds** — `background` / `--background`: `glow`, `image`, `mesh`, `aurora`,
  `particles`, `grid`, `custom` — frame-deterministic Canvas2D, auto-coloured from the brand.
- **Captions** — `captionMode`: `phrase` (short editorial block) or `words` (spoken text revealed
  word-by-word, synced to real VO timestamps; active-word highlight + per-segment `emphasis`).
- **Branding** — `logo` mark on talking beats + a per-mode AI `disclosure` baked in.
- **Output** — `out/<title>/<title>[-<tag>]-<format>.mp4`; `--tag` (auto-set from `--background`)
  keeps variant renders side-by-side instead of overwriting.
- **Compliance** — brand `bannedPhrases` fail the build (no guaranteed-outcome copy).

## Brand assets (`logo/`)
| File | Use |
|---|---|
| `kino-logo.png` | **Light master** — wordmark + etymology note (cream); used in this README |
| `kino-wordmark.png` | Wordmark + brackets only |
| `kino-logo-transparent.png` | Transparent (line-art; for **light** backgrounds) |
| `kino-logo-dark.png` | **Dark master** — white ink on night |
| `kino-logo-dark-transparent.png` | Transparent dark-mode (overlay on **dark**) |
| `kino-icon.png` | 1024×1024 square icon |
