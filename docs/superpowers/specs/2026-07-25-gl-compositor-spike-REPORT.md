# GL compositor spike — REPORT

**Spec:** docs/superpowers/specs/2026-07-25-gl-compositor-design.md
**Branch:** spike/gl-compositor
**Machine:** Apple M4 | 10 cores | Darwin 25.5.0, GL backend: gpu

## Verdict

<proceed | redesign | stop — filled in by Task 8>

## M1 — DOM-path baseline per-frame wall time

Both baselines render at **1080×1920** (`9:16`).

Typical: `projects/kino-meta/specs/advert.json`, built with `--draft --mock`. Motion segments,
mesh background, and VO captions — representative of a real project spec and buildable without
external assets. The design doc originally named `examples/segmentation/per-object-zebras.json`,
but flat `examples/` specs are unbuildable by `kino build` (project-local only) and that fixture's
`pexels/zebras2s.mp4` / `masks/zebras` assets are missing from this worktree; **controller waiver:**
advert approved as the typical substitute.

Worst case: `examples/motion-flex/render-flex.ts`, rendered with `FLEX_VIDEO=1` through the same
native render path at 1080×1920. The three motion beats cover the 14.7-second timeline.

Log: `/tmp/kino-m1-typical.log` (typical), `/tmp/kino-m1-worst.log` (worst case).

| Spec | Frames | resolve p50 | resolve p95 | capture p50 | capture p95 | total p50 |
|---|---|---|---|---|---|---|
| `projects/kino-meta/specs/advert.json` (typical, `--draft --mock`) | 291 | 1.0 ms | 1.4 ms | 48.2 ms | 53.3 ms | 49.2 ms |
| `examples/motion-flex/render-flex.ts` (worst case) | 441 | 0.6 ms | 0.9 ms | 49.1 ms | 66.7 ms | 49.6 ms |

## M2 — `html` raster cost

| Subject | SS | p50 ms | p95 ms |
|---|---|---|---|
| motion-fullscreen | 1 | 0.6 | 2.0 |
| motion-fullscreen | 2 | 0.7 | 2.0 |
| caption-line | 1 | 1.6 | 4.2 |
| caption-line | 2 | 0.9 | 2.1 |

## M3 — Raster fidelity

| Subject | meanDiff vs DOM | visual notes |
|---|---|---|
| caption-stroke | 0.00045016 | At conceptual 100% zoom, stroked caption is visually indistinguishable: no visible softening, thinning, or kerning shift in raster. |
| small-label | 0.000059812 | Small mint label matches DOM; glyph edges and letter spacing remain visually unchanged. |
| gradient-card | 0.000198724 | Gradient, rounded corners, and edge antialiasing visually match DOM. |

## M4 — External references in motion HTML

| Corpus | Specs scanned | Specs with external refs | Distinct refs |
|---|---|---|---|
| examples | 6 | 0 | 0 |
| demos | 0 | 0 | 0 |
| projects | 6 | 0 | 0 |
| assets-lib | 0 | 0 | 0 |

Zero specs in any corpus carry external references inside motion HTML, so `inline.ts` stays a scoped footnote in phase 1 rather than a first-class deliverable and the core plan's Task 12 estimate does not need to rise.

## M5 — Capture path

| Method | p50 ms | p95 ms | bytes/frame |
|---|---|---|---|
| cdp-screenshot | 52.3 | 56.0 | 13002 |
| canvas-toDataURL | 10.9 | 12.2 | 13002 |

## M6 — Color and alpha parity

| Case | meanDiff GL vs DOM | reconcilable |
|---|---|---|
| 50% white plate and antialiased text over gradient | 0.0311424 (max 0.478431) | No — stop |

The PNGs differ across the gradient interior, most visibly through the lower half where the GL output
is more yellow/orange than the DOM output. The plate and text align geometrically, but the diff is
not confined to their antialiased edges or boundary. This is a whole-gradient hue/trajectory mismatch,
which meets M6's color-space mismatch stop condition; alpha parity cannot be accepted without
investigating the color space and gradient rendering path.

## Projection

<per-frame compositor estimate derived from M1/M2/M5, with the arithmetic shown>
