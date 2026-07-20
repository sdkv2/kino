# kino-meta — the kino advert

A looping advert for **kino, made in kino**. Faceless, no captions: a spoof
kino window types *"Kino, make me an advert."* in sync with the voiceover, then
reveals the real flow — an agent writes a spec → `kino build` → settles back to
the empty prompt so the mp4 **loops seamlessly**.

- **Spec:** `specs/advert.json` (`"seamlessLoop": true`, `"film": 0`) · **Output:** `out/advert/advert-9x16.mp4` (9:16, faceless)
- Designed for `<video autoplay muted loop>` — **first frame ≡ last frame** (empty prompt). Build runs a soft RGB seam check.
- **No captions** — typed UI locked to VO via `env.words`. After real VO: `kino retune specs/advert.json`.
- **Audio:** ducked `ambient-night`. VO: `eleven_multilingual_v2`.
- **Brand:** `brands/kino/`.

## Beats
| # | surface | VO |
|---|---|---|
| 0 | prompt window (types the prompt) | "Kino, make me an advert." |
| 1 | spec editor (real schema types on) | "Your agent writes a real JSON spec." |
| 2 | build terminal + pipeline | "One command builds it. Voiceover, motion, render, mp4." |
| 3 | loop settle → empty poster | "Tell your agent." |

## Rebuild / iterate
- `kino build specs/advert.json`
- Harnesses: `specs/_b0.json … _b3.json`
- Window states from `python3 assets/motion/gen-windows.py` (prompt + loop-settle).
  Standalone: `spec-editor.js`, `build-terminal.js`.
- **Reusable library copies** of these pages: `assets-lib/motion/{prompt-type,json-type,build-pipeline,loop-ready}.js`
  — showcase with `npx tsx examples/motion-ui/render-ui.ts`.
