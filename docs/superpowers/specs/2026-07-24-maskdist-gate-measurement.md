# Measuring the `kinoMaskDist` analytic-branch gate

**Date:** 2026-07-24
**Subject:** the `0.05` constant in `kinoMaskDist` (`src/render/shaderSource.ts`)
**Verdict:** the premise is right, the constant is right, the stated *mechanism* is wrong, and the
gate does not cover the multi-object mask path at all.

## The claim under test

`kinoMaskDist` picks between an analytic regime and a 24-tap spiral on a threshold over the
coverage gradient:

```glsl
float g = length(vec2(dFdx(m), dFdy(m)));
if (g > 0.05) return clamp((0.5 - m) / g, -radius, radius);
```

The constant was `0.01`. A reviewer argued from reading the pipeline — never from a measurement —
that `0.01` sits at the noise floor of real masks, and it was changed to `0.05`. The predicted
symptom was a rim that *speckles* on a tracked video mask, isolated pixels returning ±radius
while their neighbours return a small distance.

Nothing in the suite rendered a compressed video mask, so it had never been checked either way.

## Method

The pipeline was reproduced exactly, both parameters confirmed by reading the source:

- `scripts/sam_runner_cuda.py:662` — mask frames written as PNG, then
  `libx264 -pix_fmt yuv420p -crf 16`. Single-object masks are R=G=B, so they ride luma.
- `src/render/native/videoFrames.ts:230` — re-extraction to JPEG at `-q:v 2`. That JPEG is what the
  shader samples.

Masks were built at 1080x1920 and pushed through both stages, then `g` was computed on the
extracted frame as a 1px finite difference of normalised coverage (what `dFdx`/`dFdy` see at 1:1
sampling; GL computes them per 2x2 quad, same magnitude). Pixels were classified against the
**lossless source**, not against the compressed result: "flat" means every pixel within Chebyshev
radius 4 has the same source value, so the true gradient is exactly 0 and any reading is noise.

Four mask shapes, all **moving** (a static clip codes as near-free P-frames and badly understates
residual ringing):

1. moving disc, hard edge
2. busy silhouette — torso, head, 40 hair strands, fingers, an interior hole (fine structure is
   what rings)
3. the same silhouette drawn at 1008x1008 and **bilinear**-upscaled to native, which is what
   `sam_runner.py:426` actually does on the mac path — a genuinely soft edge
4. three objects packed into R/G/B, which both runners do for `n > 1`

## Measured noise floor

Flat-region `g`, ~2M pixels per frame, after h264 crf 16 **and** JPEG q:v 2:

| clip | median | p99 | p99.9 | p99.99 | **max** |
|---|---|---|---|---|---|
| moving disc | 0 | 0 | 0.0039 | 0.0196 | **0.0444** |
| busy silhouette | 0 | 0 | 0.0039 | 0.0196 | **0.0388** |
| bilinear-upscaled | 0 | 0 | 0 | 0.0088 | **0.0283** |
| RGB-packed, red ch | 0 | 0.0056 | 0.1451 | 0.2118 | **0.4104** |
| RGB-packed, green ch | 0 | 0.0056 | 0.0721 | 0.1446 | **0.2218** |
| RGB-packed, blue ch | 0 | 0.0078 | 0.1529 | 0.2237 | **0.4215** |

Genuine edges, for comparison: median **0.97** on hard-edged masks, **0.40** on the
bilinear-upscaled one, max 1.41.

Attribution — h264 alone is nearly innocent, the JPEG stage dominates. Sweeping the busy
silhouette:

| encode | flat max | flat p99.9 | flat px > 0.01 | > 0.05 | > 0.1 |
|---|---|---|---|---|---|
| crf 16 (shipped) | 0.0388 | 0.0039 | 960 | 0 | 0 |
| crf 20 | 0.0444 | 0.0039 | 1005 | 0 | 0 |
| crf 23 | 0.0444 | 0.0039 | 1061 | 0 | 0 |
| crf 28 | 0.0388 | 0.0056 | 1175 | 0 | 0 |
| crf 16, **jpeg q:v 5** | 0.1054 | 0.0157 | 4560 | **177** | 2 |
| crf 16, **jpeg q:v 10** | 0.1723 | 0.0157 | 2649 | **711** | 70 |

The h264 quality barely moves the floor; the JPEG quality sets it. The gate's headroom is held up
by `-q:v 2` in `videoFrames.ts`, a constant in a different file.

### Answers to the three questions

- **Does flat-region noise exceed 0.01?** Yes. ~1000 flat pixels per frame clear 0.01 on every
  grayscale clip. The premise was correct and the change was not unnecessary.
- **Does it also exceed 0.05?** Not for grayscale masks — 0 pixels, on every clip and every crf.
  **Yes for R/G/B-packed masks**, by 8x, where 3–8k pixels per frame beat it.
- **What separates cleanly?** For grayscale, anything in roughly **0.05–0.3**: the noise ceiling is
  0.044, the real-edge floor is ~0.1 with a median of 0.40–0.97, and the analytic-retention curve
  is flat across that whole span (bilinear clip: 90.5% at 0.05, 87.8% at 0.1). For RGB-packed
  masks, **nothing** separates them — the populations overlap.

## The stated mechanism is wrong

A flat pixel that wrongly takes the analytic branch returns `clamp((0.5-m)/g, ±radius)`. With
`m ≈ 0` or `1` that is `±0.5/g` — and the spiral, finding no edge within `radius`, returns
`±radius`. **They agree** unless `0.5/g < radius`. So the misroute is only observable when

```
g > 0.5 / radius
```

which is radius-dependent, and no fixed constant expresses it. Counting flat pixels whose analytic
answer lands more than 1px away from the spiral's `±radius`:

| clip | gate | r=4 | r=8 | r=16 | r=32 |
|---|---|---|---|---|---|
| moving disc | 0.01 | 0 | 0 | 16 | 402 |
| moving disc | 0.05 | 0 | 0 | 0 | 0 |
| busy silhouette | 0.01 | 0 | 0 | 15 | 384 |
| busy silhouette | 0.05 | 0 | 0 | 0 | 0 |
| RGB red ch | 0.01 | 2463 | 4588 | 6418 | 10477 |
| RGB red ch | 0.05 | 2463 | 4588 | 5257 | 5257 |
| RGB blue ch | 0.05 | 3056 | 6403 | 7802 | 7802 |

At the radii the docs recommend (a 3px rim wants radius 4), a grayscale mask produces **zero**
wrong pixels at *either* gate. The predicted speckling rim does not occur at recommended radii. The
old gate's real cost appears at radius ≥16, and it is not speckle in flat regions — it is the
annulus *within* `radius` of the edge, where ringing is strongest, having its distance field
dragged to ±radius.

## End-to-end render

`tests/render-maskdist-video.test.ts` builds `mask.mp4` (PNG-equivalent frames, libx264 yuv420p
crf 16) plus the `manifest.json` `kino segment` writes, lets the renderer re-extract at `-q:v 2`,
and shades a beat by `clamp(-d/radius)` at radius 64 so the `|d| = radius/2` isoline is directly
measurable. Bounding box of that isoline (should be 536px across, centred on the disc):

| gate | isoline bbox | interior meanG | result |
|---|---|---|---|
| **0.01** | **596x598** | 1.0 | FAIL — isoline 45px too wide, erode lands ~22px off |
| 0.02 | 551x554 | 1.0 | pass |
| 0.03 | 551x554 | 1.0 | pass |
| **0.05 (shipped)** | 551x554 | 1.0 | pass |
| 0.1 | 551x554 | 1.0 | pass |
| 0.2 | 551x554 | 1.0 | pass |
| 0.4 | 551x554 | 1.0 | pass |

Every gate from 0.02 to 0.4 renders identically; only 0.01 differs, and it differs a lot. The
deep-interior speckle count was **0 at every gate including 0.01** — confirming the mechanism
correction above. The render takes ~3.4s through SwiftShader, cheap enough for the suite.

## Two bugs found on the way

1. **`geq=lum=` contaminates chroma.** An ffmpeg `geq` filter given only a `lum` expression fills
   the cb/cr planes from that same expression at *chroma* resolution. `src/segment/mock.ts`'s
   `writeMaskMp4` does exactly this, so the mock backend's `mask.mp4` is not grayscale — it is a
   green field with a bright green ellipse and a magenta corner blob (meanR=0.227, meanG=0.516,
   meanB=0.226). The mock's manifest declares `channel: "r"` for video masks, so the renderer's
   subject region is the corner blob, not the ellipse. The image path (`-pix_fmt gray`) is fine.
   Fix: `geq=lum='<expr>':cb=128:cr=128`. Filed as a separate task; the new test pins neutral
   chroma for its own fixture.
2. **`kinoMaskDist` is not usable on R/G/B-packed masks.** Covered above. This is a real limitation
   of the multi-object path (`masks[]` union, per-object regions) and no gate value fixes it.

## What changed

- `src/render/shaderSource.ts` — gate **kept at 0.05**; the justification comment replaced with the
  measured distributions, the corrected mechanism, the `-q:v 2` coupling, and the RGB-packed
  limitation. No change to the signature or the two-regime structure.
- `tests/render-maskdist-video.test.ts` — new. Renders a genuinely compressed video mask and fails
  at 0.01. Closes the gap that let the constant ship twice unverified.
- `docs/segmentation.md` — the regime prose now carries the measured numbers and states that
  `kinoMaskDist` is reliable on grayscale masks only.

## Recommendations not acted on

- **Do not raise the gate to buy margin.** 0.1 renders identically and would double the headroom
  over the 0.044 ceiling, but it fixes no observed defect and halves the analytic reach. Not worth
  the diff on this evidence.
- **Stop packing multi-object masks into subsampled chroma** if `kinoMaskDist` is to work there —
  separate single-object mask files, or a 4:4:4 pixel format. That is the root cause; the gate is
  the wrong lever.
- **Re-measure if `-q:v 2` in `videoFrames.ts` is ever relaxed.** At q:v 5 this gate stops working.
