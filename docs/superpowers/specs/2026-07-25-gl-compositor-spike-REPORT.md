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

## M4 — External references in motion HTML

| Corpus | Specs scanned | Specs with external refs | Distinct refs |
|---|---|---|---|

## M5 — Capture path

| Method | p50 ms | p95 ms | bytes/frame |
|---|---|---|---|

## M6 — Color and alpha parity

| Case | meanDiff GL vs DOM | reconcilable |
|---|---|---|

## Projection

<per-frame compositor estimate derived from M1/M2/M5, with the arithmetic shown>
