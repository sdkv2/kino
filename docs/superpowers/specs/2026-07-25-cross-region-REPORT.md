# Phase 4 report — cross-region sampling

Branch `feat/cross-region`, off `feat/segmentation` @ `c44a419`. Last phase of the roadmap in
`2026-07-24-mask-distance-design.md`.

Design: `2026-07-25-cross-region-design.md`. Plan: `../plans/2026-07-25-cross-region.md`.

## Headline

Phase 4 was sketched as "let the subject sample the background — tracked liquid glass, refraction,
displacement". **Most of that already worked, with no engine change at all.** Measurement cut the
phase down to one real gap, and the mechanism that closes it is six lines in the assembler and no
framebuffer.

## What already worked

`uTex0` — the beat's own asset, the plate behind everything — has always been bound in region
shaders, and nothing has ever stopped a body sampling it **at an offset**. `texture(uTex0, uv + bend)`
is refraction of the plate, today.

The open question was whether that is *convincing* or merely *possible*, so a probe was rendered
before any code was written: a subject body building a bevel profile and a surface normal out of
three `kinoMaskDist` calls, looking `uTex0` up along it, over a plate of fat colour bands.

It produces unmistakable tracked liquid glass. Bands bend through the silhouette; a bright rim rides
the edge; a hard vertical black bar visibly displaces at the boundary and rejoins outside it. Nothing
was added to get that. Any author could have written it the day phase 1 shipped `kinoMaskDist`.

**So the sketched headline feature was already shipped, and the honest scope of phase 4 is narrow.**

## What was genuinely missing

Exactly one case: **the background region is a treatment, not a passthrough.**

When `background` is null or a passthrough, the plate *is* what is visibly behind the subject and
`uTex0` refraction is correct. When it is a real body — `examples/segmentation/region-backdrop.frag`
crushes and desaturates the footage, and it is one of only three shipped region shaders — what is
visibly behind the subject is the *crushed* frame, and refracting `uTex0` shows the **untreated**
plate through the glass.

A second probe rendered both halves in one frame, same mask, same bevel, same displacement, over a
desaturating background: left half sampling `uTex0`, right half sampling the background body. The
`uTex0` half reads as a hole punched to a different image — full-saturation magenta and yellow inside
a cold blue frame, a glaring continuity break. The other half matches its surroundings and refracts
them. That is the whole delta this phase ships.

## What shipped

A GLSL helper, `void kinoBackground(out vec4 fragColor, in vec2 fragCoord)`, callable from any
subject body at any coordinate:

```glsl
vec4 b;  kinoBackground(b, fragCoord);            // the shaded background AT THIS PIXEL
vec4 r;  kinoBackground(r, fragCoord + bend);     // refraction / displacement
```

**No framebuffer.** The design brief anticipated a two-pass FBO for offset sampling, and that turned
out to be unnecessary: the background body is a **pure function of `fragCoord`**, already emitted as
`void regionBg(out vec4, in vec2)`. Evaluating it at `fragCoord + offset` *is* the offset sample —
exact, full-resolution, deterministic, no allocation, no resize path, and none of the
FBO-bound-while-sampled footgun the FXAA pass documents. The only thing that ever blocked it was
emission order: subject bodies precede the background body in the one translation unit they share,
and GLSL wants a declaration first.

So the change is a forward declaration plus a preprocessor alias, scoped to subject bodies exactly
the way `uMaskSelf`/`uChannelSelf` already are. `assembleRegionShaderSource`'s signature is
unchanged; `RegionShader.tsx` was not touched at all.

Also shipped: a worked example (`cross-region-glass.json` + `region-glass.frag` +
`region-tint.frag`), rendered and eyeballed, and a `docs/segmentation.md` section.

### Definitions the phase had to settle

- **"The background" is the one `background` body, always.** Phase 2 scoped out a per-entry
  `background` on the grounds that there is one by definition, and that is what makes this
  unambiguous. Every subject-side body — top-level `subject`, each `masks[].subject`, and the shared
  fallback — resolves `kinoBackground` to the same function.
- **Subject A may not sample subject B. YAGNI, and also ill-defined.** Under phase 2's painter's
  order a subject body runs for every pixel but its output is *discarded* outside its own mask. So
  "what does subject B look like here" has no answer precisely where a neighbour would want to ask.
  Offering it would mean inventing a meaning for a subject where it is not visible. If it is ever
  wanted, the honest primitive is an FBO over the composited result, not a body call.
- **Not defined in the background body.** Recursion is illegal in GLSL and the call has no meaning
  there, so leaving it undefined makes the mistake loud (see the bite proof below).

## What was deliberately not built

- **A two-pass FBO.** Named as the upgrade path with a measured crossover rather than built. See Cost.
- **Subject-samples-subject.** Above.
- **A file-scope `vec4` carrying the already-computed background.** The entry point computes the
  background into a local *before* it calls the subject bodies, so exposing it would make the
  offset-0 (pixel-local) case free instead of costing one redundant re-evaluation. Rejected: it is a
  second surface for something `kinoBackground(b, fragCoord)` already does, and the thing it buys is
  **measured at 0.019 s/frame**. Two ways to do one thing, to save 3% of a frame, is the worse deal.
- **Anything in `RegionShader.tsx`.** No new uniform, no new texture unit, no new state. A pleasant
  side effect: this phase cannot reintroduce the hardcoded-30 clock bug, because it does not go near
  the clock.

## Measured cost

Apple M4, 1080×1920, 12 stills, default SwiftShader (software) renderer, one mask. Subject is the
probe's glass, whose bevel already costs three `kinoMaskDist` calls at radius 70. "Light" background
≈ luma + tint + a 12-iteration trig loop; "heavy" is the same at 120 iterations, ~10× the ALU.

| subject body | light bg | heavy bg |
| --- | --- | --- |
| trivial, no bend (the 2-body floor) | 0.269 s/frame | — |
| refract `uTex0` (ships today, no call) | 0.642 s/frame | 0.839 s/frame |
| 1 `kinoBackground` tap | 0.661 s/frame (**+0.019**) | 0.951 s/frame (**+0.112**) |
| 8 taps (frosted blur) | 0.728 s/frame (**+0.086**) | 1.305 s/frame (**+0.466**) |

Three things the numbers settle:

1. **A tap costs one evaluation of the background body and nothing else** — ~0.011 s/frame/tap light,
   ~0.058 heavy. Linear in both tap count and body weight, exactly as re-evaluation predicts.
2. **It is not the expensive part of the shader.** The bevel's three `kinoMaskDist` calls cost
   0.373 s/frame on their own (0.642 − 0.269). One background tap is **5% of that**. An FBO would
   have been a two-pass rewrite to optimise the cheapest term in the expression.
3. **The ceiling is real and nameable.** Cost is `taps × body weight`. A heavy background at 8 taps
   pays +0.47 s/frame where an FBO would pay one extra evaluation total. That crossover — a wide
   kernel over an expensive background — is where an FBO should be built if it is ever built, and
   `kinoBackground`'s signature does not change when it lands.

Caveat on method: these are isolated runs. The same measurements under full-suite concurrency read
~2× higher across the board (e.g. heavy/8-taps 1.95 s/frame), so the *ratios* are the durable
result, not the absolute seconds.

**Nobody pays for what they do not use.** The declaration and the two `#define`s are emitted **only
when a subject-side body actually mentions `kinoBackground`**. A spec that does not use the feature
gets a byte-identical program — asserted directly, the bar phases 2 and 3 both held.

The gate is a substring test, not a GLSL parse (`ponytail:` comment at the call site). A body naming
it in a comment gets an unused declaration and an unused macro — harmless. One that builds the name
through its own macro does not match and gets the loud compile error below.

## The test, and proof its assertions bite

`tests/render-region-crosssample.test.ts`. String assertions cannot tell a background sample from a
subject sample, nor an offset one from a same-pixel one — and this sequence has twice shipped tests
that passed against broken code (phase 1's helper was wrong by 3×; phase 3's clock bug survived a
30fps test because 30/30 is 1 either way).

So the background body is a **monotone vertical ramp**, `c = vec3(fragCoord.y / iResolution.y)`. Its
value at a pixel is then an exact invertible function of `y`, which makes an offset sample
*numerically* separable rather than a thing judged by eye. One frame, one mask; the subject splits on
x — left half samples at offset 0, right half at +192px in y (D/H = 0.1 exactly). Two crops at the
same y read it off.

**Working run:** `left = 0.500, right = 0.600`. Exactly the predicted 0.5 and 0.5 + D/H.

Three deliberate breaks, all run:

| break | result |
| --- | --- |
| **1. Alias misdirected to the subject body** (`#define kinoBackground regionSubject`, a plausible typo) | Render fails: `ERROR: Recursive function call in the following call chain: regionSubject`. Caught by the driver before pixels exist. |
| **1b. Alias points at the plate instead** (`#define kinoBackground(c,f) c = texture(uTex0, (f)/iResolution.xy)` — the "just sample the plate" mistake) | **Compiles, renders plausible grey pixels**, and is caught only by the numbers: `left = 0.200, right = 0.200`, failing assertion 1 with `expected 0.3 to be less than 0.01`. This is the bite that matters — a wrong implementation that looks fine. |
| **2. Forward declaration removed** (keep the `#define`, drop the declaration) | Render fails: `ERROR: 0:129: 'regionBg' : no matching overloaded function found`, quoted against line-numbered assembled source. Proves the declaration is load-bearing, not decorative. |
| **3. Offset dropped** (both halves use `dy = 0.0`) | `left = 0.500, right = 0.500`; fails with `expected 0 to be greater than 0.09`. Proves the offset assertion is not satisfied by a same-pixel read. |

Break 1b and break 3 are the important pair: between them they prove the test distinguishes *which
function is called* and *at which coordinate*, which is the entire claim of the phase.

Seven string-level assertions in `tests/segment-regionshader-src.test.ts` additionally pin the
emission: byte-identity when unused (union and per-object paths), declaration-before-use ordering,
scoping out of the background body, the shared fallback, and that a background body mentioning the
name does not switch the feature on.

## Found wrong in existing code

Nothing incorrect. Three observations worth recording:

1. **The roadmap's phase-4 framing was wrong about the mechanism**, and expensively so. It assumed
   offset sampling "requires a real two-pass FBO". It does not, because the background body is a pure
   function of its coordinate — a fact already true of every region shader ever assembled. The
   cheapest version of this phase was available the whole time.
2. **The roadmap over-scoped the value.** "Tracked liquid glass, refraction, displacement" was
   already achievable against `uTex0` and had been since phase 1. The genuinely-new capability is one
   case (treated backgrounds), not a family.
3. **`kinoMaskDist`'s spiral quantisation is visible in real glass.** The probe renders show ragged
   streaks in the refracted band: the normal is a central difference of the distance field, and in
   the spiral regime the field is quantised to `radius/24` steps, so the normal inherits that as
   directional noise. This is phase 1's documented `~0.36 · radius` limit surfacing in a new place —
   not a defect this phase introduces, and not one it can fix. It is the strongest argument yet for
   the precomputed `dist.mp4` that phase 1 deferred, and it should be logged against that work rather
   than here.

## Suite

`npx vitest run` — 582 passed, 3 skipped, 0 failed. `npm run build` green.

One full-suite run out of five reported a single transient failure whose identity was not captured;
four subsequent full runs were clean, and the two files this phase touches passed 3/3 in isolated
repeats plus every full run. Flagged rather than hidden — it is not in this phase's files, but it was
not identified either.

## Open questions

- The precomputed distance field (phase 1's deferred `dist.mp4`) is now motivated by *two*
  independent effects, not one. Refraction normals make its absence visible in a way rim light did
  not.
- Nobody has yet asked for a frosted/blurred background behind glass. That is the single shape that
  makes the FBO worth building, and the measured crossover (~8 taps over a heavy body) is recorded
  here so the decision can be made on numbers rather than instinct.
