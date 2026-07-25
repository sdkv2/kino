# Cross-region sampling (`kinoBackground`) — design

Phase 4, the last, of the region-shader roadmap in `2026-07-24-mask-distance-design.md` § Roadmap.

**Status:** design, 2026-07-25. Scope cut hard against measurement — see *What already works*.

## What already works, measured before designing anything

Phase 4 was sketched as "let the subject region sample the background region — tracked liquid
glass, refraction, displacement". Before building that, the sketch was tested against the shipped
code. Most of it is already there.

`uTex0` (the beat's own asset — the plate behind everything) is bound in every region shader, and
nothing has ever stopped a body sampling it **at an offset**. `texture(uTex0, uv + bend)` is
refraction of the plate, today, with no engine change.

A probe was rendered to check whether that is *convincing* rather than merely *possible*: a subject
body that builds a bevel profile and a surface normal out of `kinoMaskDist`, then looks up `uTex0`
displaced along it, over a plate of fat colour bands. It produces unmistakable tracked liquid glass —
bands bend through the silhouette, a bright rim rides the edge, a hard vertical bar visibly
displaces at the boundary. **Nothing needed to be added for that.**

So the honest scope of this phase is much narrower than the sketch. The genuinely-missing capability
is one case:

> **The background region is a *treatment*, not a passthrough.**

When `background` is null or a passthrough, the plate *is* what is visibly behind the subject, and
`uTex0` refraction is correct. When `background` is a real body — `examples/segmentation/region-backdrop.frag`
crushes and desaturates the footage, and it is one of only three shipped region shaders — then what
is visibly behind the subject is the *crushed* frame, and `uTex0` refraction shows the **untreated**
plate through the glass. A second probe rendered both halves side by side in one frame: the
`uTex0` half reads as a hole punched through to a different image, a glaring continuity break; the
half that samples the background body matches its surroundings and refracts them correctly.

That one case is what this phase ships. Everything else in the sketch already shipped in phases 1–3.

## The mechanism: call the background body, do not render it to a texture

The sketch assumed offset sampling requires a two-pass FBO — render the background region to a
texture, then sample that texture at an offset. `RegionShader.tsx` has zero framebuffer code, and
the FXAA pass in `ShaderBackground.tsx` carries a documented footgun about the FBO staying bound on
its texture unit while being sampled (it unbinds every frame or pass 1 feedback-loops).

None of that is necessary here. **The background body is a pure function of `fragCoord`.** It is
already emitted as `void regionBg(out vec4 fragColor, in vec2 fragCoord)`. Evaluating it at
`fragCoord + offset` *is* the offset sample — exactly, at full resolution, with no allocation, no
resize path, no feedback hazard, and no new state in the component.

The only reason a subject body cannot do this today is ordering: subject bodies are emitted **before**
the background body in the single translation unit they share, and GLSL requires declaration before
use. The fix is a forward declaration.

### Surface

```glsl
void kinoBackground(out vec4 fragColor, in vec2 fragCoord);
```

Named for the existing helpers (`kinoBackdrop`, `kinoBackdropOffset`, `kinoMaskDist`). It is a
preprocessor alias for the emitted background function, scoped the way `uMaskSelf`/`uChannelSelf`
already are — defined **only inside subject bodies**:

```glsl
void regionBg(out vec4 fragColor, in vec2 fragCoord);   // forward declaration
#define kinoBackground regionBg
#define mainImage regionSubject
<the subject body>
#undef mainImage
#undef kinoBackground
```

Worked uses:

```glsl
vec4 b;  kinoBackground(b, fragCoord);           // pixel-local: the shaded background HERE
vec4 r;  kinoBackground(r, fragCoord + bend);    // refraction / displacement
```

Rejected alternatives:

- **A two-pass FBO.** Solves the same problem for more code and more failure modes. It would only
  start to pay off past roughly eight taps of a heavy background body (see Cost), and nothing needs
  that yet. If a frosted-glass blur with a wide kernel ever ships, the FBO is the upgrade path and
  this signature does not change when it lands.
- **Exposing the already-computed background through a file-scope `vec4`.** The entry point computes
  the background into a local *before* it calls the subject bodies, so a file-scope variable written
  there would give pixel-local access for free — the offset-0 case would cost nothing instead of one
  redundant re-evaluation. Rejected: it is a second surface for something `kinoBackground(b, fragCoord)`
  already does, and the thing it saves is **measured at 0.019 s/frame** (0.11 s/frame against a
  10× heavier body). Two ways to do one thing, to save 3% of a frame, is a worse deal than the
  redundant call.
- **Forward-declaring `regionBg` and documenting that name.** One line shorter, but `regionBg` is an
  internal emission detail, it does not match the `kino*` helper naming, and it would be callable
  from the background body itself.

### Why it is not defined in the background body

Two reasons, both good. There is no meaning — the background body *is* the background. And it would
be recursion, which GLSL ES 3.00 forbids. Leaving `kinoBackground` undefined there turns the mistake
into a loud compile error against line-numbered assembled source, exactly as `uMaskSelf` does:

```
ERROR: 0:140: 'kinoBackground' : no matching overloaded function found
```

(That is the verbatim error the probe produced before the forward declaration was added — it is also
the proof that the declaration is load-bearing rather than decorative.)

## What "the background" means with N subject regions

Phase 2 made this a real question: there are now up to `MAX_REGION_MASKS = 4` subject regions.

**`kinoBackground` is the one `background` body, always.** There is exactly one — phase 2 explicitly
scoped out a per-entry `background` on the grounds that "there is one background by definition", and
that decision is what makes this phase's answer unambiguous. Every subject body, whether it is the
top-level `subject`, a per-entry `masks[].subject`, or the shared fallback, resolves
`kinoBackground` to the same function.

**Subject A may not sample subject B. Deliberately, and this is YAGNI.** It is not merely unneeded,
it is ill-defined: under phase 2's painter's-order composite, subject B's body runs for every pixel
but its output is *discarded* wherever B's mask does not cover. So "what does subject B look like
here" has no answer outside B's own silhouette, which is precisely where a neighbouring subject would
want to ask. Offering it would mean inventing a meaning for a subject where it is not visible. No
shipped or sketched effect wants it. If one ever does, the honest primitive is the FBO — sample the
composited result — not a body call.

## Cost

Measured, not estimated. Apple M4, 1080×1920, 12 stills, default SwiftShader (software) renderer, one
mask, subject bevel built from three `kinoMaskDist` calls at radius 70 (the probe's glass).

"Light" background body ≈ luma + tint + a 12-iteration trig loop. "Heavy" is the same with 120
iterations, ~10× the ALU.

| subject body | light bg | heavy bg |
| --- | --- | --- |
| trivial, no bend (the 2-body floor) | 0.269 s/frame | — |
| `uTex0` refraction (ships today) | 0.642 s/frame | 0.839 s/frame |
| 1 `kinoBackground` tap | 0.661 s/frame (**+0.019**) | 0.951 s/frame (**+0.112**) |
| 8 `kinoBackground` taps | 0.728 s/frame (**+0.086**) | 1.305 s/frame (**+0.466**) |

Three things the numbers settle:

1. **A tap costs one evaluation of the background body, and nothing else** — ~0.011 s/frame/tap
   light, ~0.058 heavy, linear in both tap count and body weight, exactly as re-evaluation predicts.
2. **It is not the expensive part of the shader.** The bevel's three `kinoMaskDist` calls cost
   0.373 s/frame on their own (0.642 − 0.269). One background tap is **5%** of that. An FBO would
   have been a two-pass rewrite to optimise the cheapest term in the expression.
3. **The ceiling is real and nameable.** Taps × body weight is the whole cost. A heavy background at
   8 taps pays +0.47 s/frame where an FBO would pay one extra evaluation total. That crossover — a
   wide kernel over an expensive background — is the documented upgrade path, and it is where an FBO
   should be built if it is ever built.

**Nobody pays for what they do not use.** The forward declaration and the two `#define`s are emitted
**only when a subject-side body actually mentions `kinoBackground`**. A spec that does not use the
feature gets a **byte-identical** program, asserted with `toBe` on the assembled source, the same bar
phase 2 and phase 3 held.

The gate is a substring test on the body text. A body that mentions `kinoBackground` only in a
comment gets an unused declaration and an unused macro — harmless. A body that constructs the name
through macro trickery does not match and gets the loud compile error above. Both documented.

## Authoring hazards

Two, both inherited rather than new, both documented alongside the helper:

- **Never call it from non-uniform control flow.** The background body may contain `aastep` or
  `kinoMaskDist`, which use screen-space derivatives; those are undefined inside a branch that
  differs across a fragment quad and fail silently. Same rule as every other kino helper. Call it
  unconditionally and `mix` afterwards.
- **Derivatives inside it see the offset coordinate.** `fwidth` in the background body measures how
  fast `fragCoord + offset` varies across the quad, not how fast `fragCoord` does. For a smooth
  offset that is correct and desirable. For an offset that changes sharply between neighbouring
  pixels — a hard bevel edge — `aastep` inside the background body goes soft in that band. Keep the
  displacement continuous.

## Testing

The bar set by phases 1–3: a render-level test whose assertions are proven to bite by deliberately
breaking what they guard. Phase 1 shipped a helper wrong by 3× under a passing test; phase 3's 30fps
test could not see a hardcoded 30. String assertions are necessary and never sufficient.

The background body is made a **monotone vertical ramp**, `c = vec4(vec3(fragCoord.y / iResolution.y), 1.0)`.
Its value at a pixel is then an exact, invertible function of `y`, so an offset sample is separable
from a same-pixel sample *numerically*, not by eye. One render, one mask, and the subject body splits
on x:

- **left half:** `kinoBackground(c, fragCoord)` — offset 0.
- **right half:** `kinoBackground(c, fragCoord + vec2(0.0, D))` with `D = 192`.

Three crops at the same `y`: background (outside the mask), subject-left, subject-right.

1. `subjectLeft == background` (within tolerance). Proves `kinoBackground` resolves to **the
   background body** and not to something else that happens to be smooth.
2. `subjectRight − background == D / H = 192 / 1920 = 0.1` exactly. Proves the **offset lands**, with
   the right sign and the right magnitude. This is the assertion the phase exists for.
3. `subjectLeft != subjectRight`. The self-contained bite for assertion 2: both crops come from the
   same mechanism and differ only in the offset argument, so an implementation that dropped the
   offset would collapse them.
4. Determinism: two seeks to the same frame index are byte-identical (`meanDiff == 0`).

Plus, at the string level, the phase-2/3 backward-compatibility bar: `assembleRegionShaderSource`
must emit **byte-identical** source for bodies that do not mention `kinoBackground`, asserted with
`toBe`.

**Bite proof** — each assertion is run against a deliberately broken assembler and the numbers
recorded in the report:

- Alias misdirected to the subject body (`#define kinoBackground regionSubject`) — a plausible typo.
  Assertion 1 must fail.
- Forward declaration removed entirely — the render must fail with the compile error quoted above.

## Out of scope

- Any FBO / two-pass rendering. Named as the upgrade path with its measured crossover.
- Subject-samples-subject (see above).
- Per-entry `background`, raising `MAX_REGION_MASKS`, changing `EXTRA_PARAM_SLOTS`.
- Changing `kinoMaskDist`'s signature, or its spiral-search precision. The probe's glass shows
  visible ragged streaks in the refracted band; that is phase 1's documented `~0.36 · radius` tap
  budget quantising the normal, not anything this phase introduces or can fix.

## Constraints held

GLSL ES 3.00. Determinism — `kinoBackground` adds no time source; it is a call to an existing pure
function. `kinoMaskDist` signature untouched. `MAX_REGION_MASKS = 4` and `EXTRA_PARAM_SLOTS = 4`
unchanged. No new uniform, no new texture unit, no change to `RegionShader.tsx` at all — so the
composition-fps clock cannot be reintroduced wrong, because this phase does not touch it.
