# Shared motion library

Original, brand-neutral **Tier 1** motion graphics (agent-authored HTML/CSS driven by kino's
CSS-variable contract — see [Motion graphics](../../docs/motion-graphics.md)). Copy a file into a
project's `assets/motion/` and reference it from a `motion` segment or `motionOverlay` like any
motion graphic. Unlike `assets-lib/lottie/`, everything here is original work (not adapted from a
third-party template), so there's no external license to track.

| File | Pattern |
|---|---|
| [`dig-log.html`](dig-log.html) | Staggered card reveal (`kino-rise` rows) + a rotated stamp pop — receipt/log-entry look. |
| [`beta-timeline.html`](beta-timeline.html) | A numbered sequence that lights up step-by-step off a tweened `--n` param, with a matching fill bar. |
| [`go-wait-card.html`](go-wait-card.html) | A status word (`GO`) popping in, then a progress track sliding in beneath it — timing/window readout. |
| [`botanical.html`](botanical.html) | Hand-drawn SVG sprig, ink strokes drawing on progressively (`stroke-dashoffset` off `--progress`), no `@keyframes`. |
| [`settle.html`](settle.html) | A phrase rising word-by-word with blur-clear, over a centre-out rule wipe — type-only beat (no caption needed). |
| [`timer.html`](timer.html) | A conic-gradient ring dial filling to a tweened `--pct`, with a glow that breathes off `--t` and punches on `--pulse`. |
| [`ritual.html`](ritual.html) | A count-up number (`--n` tweened) inside a soft glowing disc — minutes/countdown readout. |
| [`connect.html`](connect.html) | A pulsing signal dot with expanding rings (`--pulse`) behind a count-up number — live/connecting readout. |

All eight are pure functions of the frame — motion comes from `--progress`/`--t`/`--pulse`/tweened
params, or `@keyframes` scrubbed via kino's `.kino-anim`/`.kino-rise`/`.kino-pop` helper classes
(never `transition`, timers, or `Math.random`) — so they pass the determinism lint as-is. Run
`kino motion` for the full CSS-variable contract.
