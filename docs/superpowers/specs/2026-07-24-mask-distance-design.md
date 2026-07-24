# Mask distance in region shaders (`kinoMaskDist`)

**Status:** design, approved 2026-07-24. Phase 1 of four (see Roadmap).

## Problem

Region shaders split a beat's frame by a segmentation mask, but the split is binary. The
assembled entry point reduces every mask to an in/out decision:

```glsl
m = smoothstep(0.4, 0.6, m);
kino_fragColor = mix(b, s, m);
```

A shader can therefore know *whether* a pixel is on the subject, but never *how far* it is
from the silhouette. That single missing value is what blocks an entire family of effects:
rim light, outline, outward glow, chromatic edge fringe, erode/dilate, and dissolves that
eat inward from the boundary.

This is not hypothetical. Three region shaders were written against the tracked ocean mask
on 2026-07-24 (thin-film iridescence, liquid mercury, bathymetric chart). Every one of them
stopped dead at the silhouette, and a rim on the mercury — the thing that most sells liquid
metal — was not expressible.

## Approach

Estimate the distance in the shader by sampling the mask that is already bound, rather than
precomputing and shipping a distance field.

The alternative — a `dist.mp4` per object — was considered and rejected for this phase. It is
exact and unbounded in radius, but it touches 6–8 files (generation in both Python runners
plus mock, a manifest field, a new texture channel routed through `/vframes`, docs, tests),
and it cannot be applied to any mask already on disk without regeneration. On the CoreML
backend that is ~2.9s/frame, so the 884-frame clip in `docs/segmentation.md` would be a
43-minute rerun.

The in-shader version is one function, works retroactively on every mask ever generated, and
covers the effects that motivated the work. Its cost is affordable on the default software
renderer: the mercury shader already performs ~45 texture taps per pixel and rendered 135
frames of 1080p in ~25s at concurrency 4, so a 24-tap estimate is cheaper than something
already shipped.

## Surface

One helper added to `GLSL_HELPERS` in `src/render/shaderSource.ts`, alongside `aastep`,
`kinoCoverUV`, and `kinoBackdrop`. It is injected into every assembled shader; unused, it
compiles away.

```glsl
float kinoMaskDist(sampler2D mask, vec4 channel, vec2 fragCoord, float radius)
```

- **Returns** signed distance in **pixels**: negative inside the subject, positive outside,
  clamped to ±`radius`. Pixels rather than normalized units because authors reason in pixels
  — `smoothstep(0.0, 3.0, -d)` is a 3px rim, legibly.
- **Takes `fragCoord`**, matching the convention of every other kino helper.
- **Takes `mask` and `channel` as arguments** rather than reading `uMask0` directly, so it
  works with any of `uMask0..3` / `uChannel0..3` (`MAX_REGION_MASKS = 4`) and is callable from
  both the subject and background bodies.

Worked uses:

```glsl
float d = kinoMaskDist(uMask0, uChannel0, fragCoord, 24.0);
float rim   = 1.0 - smoothstep(0.0, 3.0,  -d);   // 3px band inside the edge
float glow  = 1.0 - smoothstep(0.0, 24.0,  d);   // falloff outward
float eaten = step(-4.0, d);                     // erode the subject by 4px
```

## Implementation

Two regimes, because the mask's own soft edge already carries the distance where it matters
most and a tap budget cannot compete with it.

**Near the edge — analytic.** Sample the mask coverage, take its screen-space gradient, and
read the distance straight off the linear ramp. Inside the transition band this is *sub-pixel*
and costs no taps beyond the one already made:

```
m = dot(texture(mask, uv), channel)
g = length(vec2(dFdx(m), dFdy(m)))
if g > 0.01: return clamp((0.5 - m) / g, -radius, radius)
```

**Beyond it — spiral search.** Where coverage has saturated to flat 0 or 1 the gradient
vanishes and there is nothing local to read. Fall back to sampling which side the pixel is on,
then walking a golden-angle spiral outward with **linear** radial spacing, stopping at the
first sample whose side differs:

```
here  = step(0.5, m)
best  = radius                           # no transition found → saturates at ±radius
for i in 0..TAPS-1:
    r = (i + 1) / TAPS * radius          # linear: uniform radial steps
    a = i * 2.39996323                   # golden angle, decorrelates direction from radius
    s = step(0.5, dot(texture(mask, uv + vec2(cos a, sin a) * r * texel), channel))
    if s != here: best = r; break
return here > 0.5 ? -best : best
```

`TAPS = 24`, a compile-time constant so the loop bound is static.

Linear spacing rather than area-uniform (`sqrt`) spacing is deliberate: these effects need
resolution *near* the edge. It does **not** make the precision `radius / 24` — see Known
limits.

`uv` is `fragCoord / iResolution.xy` and `texel` is `1.0 / iResolution.xy`, matching how the
region entry point samples masks today.

**Determinism** holds: the function reads only a texture and a coordinate. No time input, no
unseeded noise. Same frame index → same pixels, on SwiftShader and under `KINO_GPU=1` alike.

## Known limits

Stated here and in the docs rather than discovered later:

- **Approximate outside the transition band.** The analytic regime is sub-pixel, but the spiral
  fallback is accurate only to roughly **0.36 · `radius`**, not `radius / 24`. Twenty-four
  samples spread over a disc of radius R get about `R * sqrt(pi / 24)` ≈ `0.36 R` of spacing
  between neighbours no matter how they are arranged — an information limit of the tap budget,
  not something the spacing rule can tune away. Linear radial spacing only shifts where that
  error lands (tighter near the centre, looser at the rim), and the error varies with edge
  orientation. Features thinner than the local spacing can be missed entirely.
- **Bounded.** Distance saturates at ±`radius`. Wide soft glow (beyond ~32px) is not served
  well by this phase — and because the error scales *with* `radius`, a large radius buys reach
  at the cost of accuracy. Pass the smallest radius that covers the effect.
- **Cost scales with callers,** not with the frame: both region bodies run for every pixel
  (an existing property, flagged by a `ponytail:` note in `assembleRegionShaderSource`), so a
  call in each body is 48 taps per pixel.

The signature is chosen so that a later precomputed-distance phase can replace the body with
a texture read **without changing a single shader that calls it.**

## Testing

A render-level test, following `tests/render-glass.test.ts`, which already drives a real
browser through `renderStills` and compares pixels with ImageMagick.

Render a mock-backend ellipse mask with a shader that emits white where `abs(d) <= 2.0` and
black elsewhere, and assert the frame mean falls in a ring-shaped band — clearly non-zero,
and well below the filled-disc coverage of the mask itself.

That single assertion fails if the helper returns a constant, gets the sign inverted, or
saturates to `radius` everywhere. A string-level test cannot catch any of those. One cheap
unit assertion in `tests/segment-regionshader-src.test.ts` additionally pins that the helper
is present in assembled region source.

## Out of scope

- Precomputed `dist.mp4` distance fields.
- Wide soft glow beyond the tap budget.
- Any change to `kino segment`, the manifest, or the CLI. This phase touches
  `src/render/shaderSource.ts`, its tests, and documentation only.

## Roadmap

Phase 1 of four agreed directions, each its own spec → plan → build cycle:

1. **Mask distance** — this document.
2. **Per-object regions** — route each entry in `masks[]` to its own shader instead of
   unioning them all into one subject region.
3. **Region shader params + keyframes** — give `regionShader` the `params`/`keyframes`
   surface `background` already has, so effects vary over a beat instead of being hardcoded.
4. **Cross-region sampling** — let the subject sample the background region (tracked liquid
   glass, displacement). Highest complexity; needs 2 settled to define "the background".
