# GL compositor phase 4 — REPORT

**Date:** 2026-07-26  
**Branch:** `feat/gl-compositor-phase4`  
**Status:** implemented

## Verdict

Phase 4 ships the compositor as the **only** render path. DOM retirement complete except `RegionShader.tsx`, which remains as the shared GL implementation for region beats (exported `drawFrame` used by `compositor/regionHost.ts`).

## Tasks shipped

| Task | Outcome |
|------|---------|
| 1 Measurements | `measureLayers()` from layer graph; engine `measureSink` uses it |
| 2 Composite SS | `StageRenderer` renders at SS×, `CompositeResolve` FXAA/downsample at present |
| 3 Capture | **canvas `toDataURL` default** (M5: 10.9 ms vs CDP 52.3 ms p50); `KINO_CAPTURE=cdp` escape hatch |
| 4 Prefetch | `nextFrameKeys` + async prepare during capture window |
| 5 Validation | This report; parity → golden harness under `tests/golden/` |
| 6 Default | `compositorEnabled()` always true; `KINO_COMPOSITOR` env ignored |
| 7 Retirement | Deleted KinoVideo, components, CanvasBackground, ShaderBackground, MotionGraphic; `index.tsx` mounts `Stage` only; frame cache v4 |

## Performance notes

- M5 conclusion **held**: canvas capture remains ~5× faster than CDP screenshot on bare canvas; compositor builds use canvas by default.
- Composite SS=2 adds GPU cost vs SS=1 but removes per-source HTML raster SS (scale=1 when composite SS>1).
- Prefetch fills the node-side capture/encode idle window when resolve ≪ capture (M1: capture p50 ~48 ms vs resolve p50 ~1 ms).

## Parity / golden baselines

- DOM-path parity retired. `tests/render-compositor-parity.test.ts` now compares against committed goldens (`tests/golden/*.png`, threshold 0.01; `film-finish` 0.06).
- Re-seed: `KINO_UPDATE_GOLDEN=1 npx vitest run tests/render-compositor-parity.test.ts`

## Cache

- `frameCache` **VERSION 4** — drops compositor discriminator (single path).

## Follow-ups

- Layer-mask compositor path (`compositor-layer-mask.test.ts`) — shape/layer masks need provider wiring fixes.
- Lottie word-fire triggers — burst `Sequence` semantics not yet in `providers/lottie.ts`.
- Delete `RegionShader.tsx` React shell once `regionShaderGl.ts` is fully extracted.
