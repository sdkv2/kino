# Getting multi-object masks out of subsampled chroma

**Date:** 2026-07-24
**Subject:** `kinoMaskDist` on R/G/B-packed multi-object masks — the limitation recorded in
`2026-07-24-maskdist-gate-measurement.md`
**Verdict:** the prior spec's root-cause call was right but incomplete. Chroma subsampling is one of
**three** independent lossy contributors, and each one on its own is enough to break the gate.
Only a lossless 4:4:4 mask encode **plus** lossless frame extraction clears it.

## The claim under test

The gate measurement concluded that packed masks cannot work because `yuv420p` subsamples chroma,
and recommended "separate single-object mask files, or a 4:4:4 pixel format". This spec tests that
recommendation directly, and measures the two lossy stages separately rather than assuming the
grayscale attribution (JPEG dominates) carries over.

## Method

Same method as the prior measurement, so the numbers are comparable:

- Three objects packed one per channel, exactly what `sam_runner.py` / `sam_runner_cuda.py` write
  for `n > 1`. Object 0 (R) a hard-edged disc, object 1 (G) a busy silhouette — torso, head, 40
  hair strands, fingers, an interior hole — object 2 (B) a notched bar.
- 1080x1920, 24 frames, all three objects **moving** (a static clip codes as near-free P-frames and
  understates residual ringing). Geometry is a pure function of the frame index — no clock, no RNG.
- Pushed through both real stages, then `g = length(vec2(dFdx(m), dFdy(m)))` computed on the
  extracted still as a 1px finite difference of normalised coverage.
- Pixels classified against the **lossless source**: "flat" = every pixel within Chebyshev radius 4
  has the same source value in that channel, so the true gradient is exactly 0 and any reading is
  noise. ~44M flat pixels sampled per channel per configuration.

Harness: `scratchpad/chroma/measure.mjs` (not committed — pure ffmpeg + node stdlib, reproduced
from this description in a few minutes).

## Measured: the shipped pipeline

`yuv420p crf 16` encode + `-q:v 2` JPEG extraction — flat-region `g`:

| ch | median | p99 | p99.9 | p99.99 | max | >0.01 | >0.05 | >0.1 |
|---|---|---|---|---|---|---|---|---|
| R | 0 | 0.0118 | 0.2863 | 0.4204 | **0.8513** | 596683 | **139822** | 91496 |
| G | 0 | 0.0078 | 0.0549 | 0.1975 | **0.3771** | 326261 | **58089** | 23876 |
| B | 0 | 0.0157 | 0.2902 | 0.4198 | **0.8209** | 704366 | **176128** | 122012 |

Consistent with the prior spec's 0.42 peak; the busier silhouette here pushes it to 0.85. Genuine
edges read 0.40–1.41, so the populations overlap completely — no gate value separates them.

## Measured: stage attribution

The key result. Each row **isolates one contributor** by making the other two lossless:

| # | encode | extract | R max | B max | R >0.05 | B >0.05 | verdict |
|---|---|---|---|---|---|---|---|
| A | yuv420p crf16 | jpg q2 | 0.8513 | 0.8209 | 139822 | 176128 | SHIPPED — broken |
| K | yuv420p **qp0** | **png** | 0.6877 | 0.6877 | 120454 | 126156 | subsampling alone: **fatal** |
| D | **yuv444p** crf16 | **png** | 0.3772 | 0.6211 | 23417 | 45526 | lossy coding alone: **fatal** |
| H | **yuv444p qp0** | jpg q2 | 0.1276 | 0.1664 | 6695 | 25605 | JPEG q:v 2 alone: **fatal** |
| **G** | **yuv444p qp0** | **png** | **0.0055** | **0.0055** | **0** | **0** | **clears by 9x** |

Three independent contributors, each individually sufficient to break the gate:

1. **4:2:0 subsampling** (K) — survives even *lossless* coding. One object's boundary lands in
   another object's channel at half resolution. This is the one the prior spec identified.
2. **Lossy 4:4:4 coding** (D) — h264 at crf 16 rings each channel independently. Fixing only the
   subsampling still leaves 45k pixels per frame over the gate.
3. **JPEG re-extraction at `-q:v 2`** (H) — even from a bit-exact mp4, DCT quantization alone puts
   25k pixels over the gate.

So a fix at only one stage does nothing useful, and "4:4:4 instead of 4:2:0" is *not* sufficient by
itself — the encode must also be lossless. Only configuration G works, and it clears the 0.05 gate
by 9x (max 0.0055, zero pixels even above 0.01).

The residual 0.0055 in G is the RGB→YCbCr rounding (±1 LSB), not the codec.

### Two things worth recording

- **`-pix_fmt gbrp` buys nothing.** libx264 in this build does not accept it; ffmpeg silently
  converts to `yuv444p`. `ffprobe` reports `High 4:4:4 Predictive,yuv444p` for both, and the
  measured numbers are bit-identical. Use `yuv444p` directly.
- **JPEG chroma subsampling was never the multi-object problem.** ffmpeg's mjpeg encoder inherits
  4:4:4 from a 4:4:4 input automatically — the extracted `.jpg` is already `yuvj444p`, and forcing
  `-pix_fmt yuvj444p` changes nothing (measurements bit-identical). The residual JPEG damage is
  pure DCT quantization.

## The fix

Two changes, both required:

1. **Mask encode → `-pix_fmt yuv444p -qp 0`** (lossless), replacing `-pix_fmt yuv420p -crf 16` at
   all four sites: `scripts/sam_runner_cuda.py`, `scripts/sam_runner.py` (x2), `src/segment/mock.ts`.
   Applied uniformly, not conditionally on object count — a single-object mask is already
   `R=G=B` and cannot be hurt by lossless coding, and one code path beats a branch.
2. **Mask frame extraction → PNG**, gated on the `rsmask` key prefix in
   `src/render/native/videoFrames.ts` so ordinary footage keeps its JPEG path and its current cost.

`MAX_REGION_MASKS = 4` is unchanged. h264 has no alpha at 4:4:4 either, so a 4th object still
cannot ride a channel of one mp4 — it needs a second `masks[]` entry with its own file, exactly as
before.

### Cost

Both changes make things **smaller**, which is the opposite of the expected trade:

| | shipped | fixed | change |
|---|---|---|---|
| `mask.mp4`, 24f @1080x1920 | 0.11 MB | 0.05 MB | **−55%** |
| extracted stills, 24f | 1.12 MB (jpg) | 0.33 MB (png) | **−71%** |

Binary masks are trivially PNG-compressible and trivially lossless-codable; the shipped lossy
settings were spending bits encoding ringing. There is no cheaper option to trade against — PNG
beats JPEG here on both exactness and disk — so the usual "PNG blows up disk" objection does not
apply to masks. (It would apply to footage, which is why the extraction change is gated.)

Extraction wall-clock: measured below in "Verification".

## Why the gate stays at 0.05

The fix drops the packed-mask noise floor from 0.85 to 0.0055, which invites loosening the gate.
Not done, for two reasons:

- **Masks already on disk stay subsampled.** They keep rendering (nothing in the decode path
  changed) but they still carry the old noise — configuration B (`yuv420p` + PNG extraction)
  still peaks at 0.84. Lowering the gate would newly break every mask a user has already
  generated.
- **It buys nothing observable.** The prior measurement rendered gates 0.02 through 0.4 and got
  byte-identical output at every one. There is no defect to fix.

The comment in `src/render/shaderSource.ts` and the prose in `docs/segmentation.md` are updated to
record the new floor and the fact that the limitation is now conditional on when the mask was
generated, rather than absolute.

## Verification

*(filled in during implementation — see "Test and bite proof" below)*
