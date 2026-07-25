# GL compositor spike — REPORT

**Spec:** docs/superpowers/specs/2026-07-25-gl-compositor-design.md
**Branch:** spike/gl-compositor
**Machine:** Apple M4 | 10 cores | Darwin 25.5.0, GL backend: gpu

## Verdict

<proceed | redesign | stop — filled in by Task 8>

## M1 — DOM-path baseline per-frame wall time

| Spec | Frames | resolve p50 | resolve p95 | capture p50 | capture p95 | total p50 |
|---|---|---|---|---|---|---|

## M2 — `html` raster cost

| Subject | SS | p50 ms | p95 ms |
|---|---|---|---|

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
