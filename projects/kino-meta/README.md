# kino-meta — the kino advert

A ~17s looping advert for **kino, made in kino**. Faceless, no captions: a spoof
kino window types *"Kino, make me an advert."* in sync with the voiceover, then
reveals the real flow — an agent writes a spec → `kino build` → the video assembles —
and **loops seamlessly** back into the prompt being typed.

- **Spec:** `specs/advert.json` · **Output:** `out/advert/advert-9x16.mp4` (9:16, ~17.1s, faceless)
- Designed for `<video autoplay muted loop>` — **first frame ≡ last frame** (the empty
  prompt-window poster). The loop seam is perceptually seamless: the source frames are
  pixel-identical (lossless AE = 0); the encoded mp4's ends differ only by H.264 noise
  (PSNR 52.8 dB, RMSE 0.23% — imperceptible). No fade to/from black at either end.
- **No captions** — every on-screen word is a motion graphic locked to the VO via
  `env.words` (burst typewriter), not the caption engine.
- **Audio:** ducked `ambient-night` bed under the VO. VO model: `eleven_multilingual_v2`
  (metronome-stable timing, required for VO-locked typing).
- **Brand:** `brands/kino/` (midnight `#0b1020` + mint `#80e2b4` + gold `#d99a20`).

## Beats
| # | surface | VO |
|---|---|---|
| 0 | prompt window (types the prompt) | "Kino, make me an advert." |
| 1 | thinking / camera pull-back | "There's no magic here." |
| 2 | spec editor (real kino schema types on) | "Your agent writes a spec —" |
| 3 | build terminal + pipeline (voiceover/motion/render/mp4, word-synced) | "— one command builds it. Voiceover, motion, render." |
| 4 | capability tiles (captions/motion/footage) | "Captions, motion, footage. All of it." |
| 5 | CTA "tell your agent" → loop-close to poster | "Kino. Tell your agent to make it. Kino, make me an advert." |

## Rebuild / iterate
- **Full build:** `kino build specs/advert.json` — VO is content-hash cached; the Remotion
  render (~660 motion-graphic frames) takes several minutes.
- **Per-beat preview (fast, no full build):** `specs/_b0.json … _b5.json` are one-beat
  harnesses. `kino still specs/_b3.json --around <t>` iterates a single beat in seconds.
  After a real build, `kino frames out/advert/advert-9x16.mp4 --around <t>` reads real frames.
- **Motion sources:** `assets/motion/`. The three window states (prompt/thinking/close)
  are emitted by `gen-windows.py` from one shared `WIN()` chrome so geometry never drifts —
  **regenerate after editing:** `python3 assets/motion/gen-windows.py`. The other beats are
  standalone `.js` (`spec-editor.js`, `build-terminal.js`, `range-tiles.js`).
- Every beat paints its own **static** full-bleed background (occludes the animated brand
  `mesh`) so the loop seam and cross-beat look stay frame-independent.

## Known minor / optional follow-ups
- No SFX yet — a soft build-complete "ding" (~9.9s) or send "pop" (~1.8s) would add polish
  (one `sfx` entry in the spec + a rebuild). `assets-lib/sfx`: click, ding, impact, pop, riser.
- Platform: composed as a **web/landing hero loop** (centered, symmetric). For TikTok/Reels
  *in-feed*, inset the cards ~5% more on the right to clear the icon rail.
- Beat 5 field clears somewhat quickly at the very end (before the loop) — a gentler
  backspace-clear is a possible refinement.

Design + plan: `docs/superpowers/specs/2026-07-19-kino-advert-design.md`,
`docs/superpowers/plans/2026-07-19-kino-advert.md`.
