# Shared motion library

Original motion graphics. Reference by **bare id** (no slash/extension) — same
pattern as SFX:

```json
{ "kind": "motion", "source": "prompt-type", "text": "Make me an advert." }
```

resolves to `assets-lib/motion/prompt-type.js` (tries `.js`, `.html`, `.json`).
Or copy into a project's `assets/motion/` and use a path (`motion/prompt-type.js`).
See [Motion graphics](../../docs/motion-graphics.md). Everything here is
original work (not adapted from a third-party template).

`kino motion` lists bundled ids.

## Tier 1 — HTML/CSS

Agent-authored HTML driven by kino's CSS-variable contract.

| File | Pattern |
|---|---|
| [`dig-log.html`](dig-log.html) | Staggered card reveal (`kino-rise` rows) + a rotated stamp pop — receipt/log-entry look. |
| [`beta-timeline.html`](beta-timeline.html) | Numbered sequence that lights up step-by-step off a tweened `--n` param + fill bar. |
| [`go-wait-card.html`](go-wait-card.html) | Status word (`GO`) pop, then a progress track — timing/window readout. |
| [`botanical.html`](botanical.html) | Hand-drawn SVG sprig, strokes draw on via `stroke-dashoffset` off `--progress`. |
| [`settle.html`](settle.html) | Phrase rising word-by-word with blur-clear — type-only beat (no caption). |
| [`timer.html`](timer.html) | Conic-gradient ring dial filling to tweened `--pct`. |
| [`ritual.html`](ritual.html) | Count-up number (`--n`) inside a soft glowing disc. |
| [`connect.html`](connect.html) | Pulsing signal dot + expanding rings behind a count-up. |

## Tier 2 — speech-synced UI pages (from the kino advert)

Procedural `render(env)` graphics. Typed surfaces lock to `env.words` (see
`speech-synced-ui` skill). Edit the knobs at the top of each file (`MARK`,
`CMD`, `LINES`, …), then copy into the project.

| File | Pattern |
|---|---|
| [`prompt-type.js`](prompt-type.js) | Spoof chat/prompt window — burst-types VO into the field + camera push-in. |
| [`json-type.js`](json-type.js) | Code editor — types a JSON file across the VO span + pan/push camera. |
| [`build-pipeline.js`](build-pipeline.js) | Terminal types a command; pipeline steps light from the last N spoken words. |
| [`loop-ready.js`](loop-ready.js) | Settles to an empty ready-state window (loop seam with `prompt-type` at t=0). |

Typical loop reel (`"seamlessLoop": true` + `"film": 0` on the spec):

```json
"seamlessLoop": true,
"film": 0,
"segments": [
  { "kind": "motion", "source": "prompt-type", "text": "Make me an advert." },
  { "kind": "motion", "source": "json-type", "text": "Your agent writes a real JSON spec." },
  { "kind": "motion", "source": "build-pipeline",
    "text": "One command builds it. Voiceover, motion, render, mp4." },
  { "kind": "motion", "source": "loop-ready", "text": "Tell your agent." }
]
```

Showcase stills: `npx tsx examples/motion-ui/render-ui.ts`.

All library graphics are pure functions of the frame (no timers / `Math.random`) and
pass the determinism lint. Run `kino motion` for the CSS / `env` contracts.
