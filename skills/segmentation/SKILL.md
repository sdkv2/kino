---
name: segmentation
description: >
  Use when a kino beat needs a subject cut out of its footage — `kino segment`
  masks, `regionShader` subject/background bodies, per-object materials, cutout
  compositing onto a different clip, rim/erode via mask distance, and motion
  graphics sampled as texture channels. Not for ordinary shader backgrounds
  (that is `shader-backgrounds`) or chroma-key-free full-frame treatments.
---

# Segmentation in kino

`kino segment` turns any image or video into object **masks**; `regionShader` then splits a
`video` beat's frame by those masks so the subject and the background each run their own GLSL body
— or so the subject sits on entirely different footage.

Contract details: `docs/segmentation.md` (the reference — read it for the measured numbers).
Spec rows: `docs/spec-reference.md`. Worked specs: `examples/segmentation/`.

**Two-machine rule.** *Generating* masks needs a Mac (CoreML) or an NVIDIA box (CUDA).
*Rendering* a spec that consumes masks works anywhere kino renders — Linux, CI, a Pi. Author on the
capable machine, render anywhere.

## Pick the consumption path first

| What you want | Reach for |
|---|---|
| Subject and background each get a different treatment | `regionShader` `subject` + `background` |
| Two tracked objects, two different materials | `regionShader.masks[]`, each with its own `subject` |
| Subject on a **different clip** (virtual greenscreen) | `regionShader.backdrop` — often no `.frag` at all |
| Glass/refraction that bends what is really behind the subject | subject body + `kinoBackground()` |
| Rim light, outline, erode, edge fringe | `kinoMaskDist()` from either body |
| A motion graphic the shader can refract or mask | `regionShader.textures` (Tier-1 `.html`) |
| A motion graphic merely stacked on top | `motionOverlay` — no segmentation needed |
| Full-frame look with no subject isolation | `shader-backgrounds` skill, not this one |

Hand off: graphic composition/type → `motion-design`. Shader math and param plumbing →
`shader-backgrounds`. Beat structure and VO → `video-production`. Overlap/legibility QA →
`adversarial-critique`.

## Author-time: making the mask

```bash
kino segment assets/clip.mp4 --prompt "the person"          # → assets/masks/clip/
kino segment photo.jpg --prompt "the car" --backend mock    # any platform, synthetic ellipse
```

| Flag | Use it for |
|---|---|
| `--prompt <text>` | the concept ("the dog", "the car"). Required. |
| `--objects <n>` | 1–4, packed into the mask's R/G/B/A channels. Default 1. |
| `--out <name>` | dir under `assets/masks/` (default: input basename) |
| `--no-track` | video only: per-frame instead of tracked. Faster, flickers. |
| `--backend coreml\|cuda\|mock` | default `coreml` on macOS, `cuda` elsewhere |

Output is a plain artifact dir: `mask.png` (image input) or `mask.mp4` (video), plus
`manifest.json` naming each object and the channel it occupies. Nothing about it is
kino-proprietary — inspect it, check it into the project, reuse it across specs.

**Both real backends track by default** (`tracked: true` in the manifest). Budget the time before
you start a long clip: CoreML is **~2.9 s/frame**, so a 5-second 30 fps beat is ~7 minutes.
`KINO_SAM_BACKBONE_EVERY=2` drops it to ~1.9 s/frame and coarsens edges on fast motion. On CUDA, budget
**~30 s of 1080p** per 11 GiB of VRAM before it OOMs — cut long sources into segments first.

### The loop that does not waste an hour

1. `--backend mock` first. It writes a synthetic ellipse anywhere, instantly. Author the whole spec
   against it — the shape is wrong but every seam, uniform and slot is real.
2. `kino still specs/x.json --at <t>` and look at the frame. Iterate the `.frag` here.
3. Only then run the real backend once, on the final clip window.

Prompt craft is the same discipline as any detector: name the object, not the scene
("the dog", not "dog running through grass"). If the result is empty the CUDA runner exits `2`
rather than inventing a mask — re-prompt instead of retrying.

## Spec seam

```jsonc
"regionShader": {
  "mask": "masks/clip",                      // artifact dir; or `masks: [...]` for several
  "object": 0,                               // which packed object (video masks only for >0)
  "subject":    "backgrounds/glass.frag",    // where mask > 0.5
  "background": "backgrounds/plasma.frag",   // everywhere else
  "backdrop":   "pexels/beach.mp4",          // a SECOND source for the background region
  "textures":   ["motion/badge.html"],       // extra samplers every body can read
  "params":     { "rim": 2.0 },              // → u_rim in every body
  "keyframes":  [{ "at": 1.2, "params": { "rim": 14.0 } }]   // BEAT-relative seconds
}
```

Omit a side to pass that region's original pixels through. `mask` + `backdrop` alone is a complete
spec — that is the virtual greenscreen, and it needs no GLSL at all.

Each `.frag` is an ordinary ShaderToy-style `mainImage` body, exactly as in `shader-backgrounds`.
Normal shaders work unchanged as region bodies.

## Sampler slots — know these before you write a body

| Slot | Bound to |
|---|---|
| `uTex0` | the beat's own asset (the thing being segmented) |
| `uMask0..3` + `uChannel0..3` | the mask(s); `uChannelN` swizzles that object's channel |
| `uMaskSelf` / `uChannelSelf` | **inside a per-entry `subject` only** — that entry's own mask |
| `uTex1` / `uTexSize1` (= `uBackdrop` / `uBackdropSize`) | the cutout `backdrop` |
| `uTex2`, `uTex3` | `textures[0]`, `textures[1]` |
| `uParam0..3` (`u_<name>`) | numeric `params`, alphabetical, **max 4 for the whole beat** |
| `uColorA/B/C`, `uIntensity` | `colorA`/`colorB`/`colorC`/`intensity` — free, no slot |
| `uPulse` | declared but always `0` — region shaders have no `triggers` surface |

Unbound channels sample transparent black, so referencing `uTex2` when no texture is declared is
safe, not a crash.

## Helpers

| Helper | What it gives you |
|---|---|
| `kinoMaskDist(uMaskN, uChannelN, fragCoord, radius)` | signed pixel distance to the silhouette — negative inside |
| `kinoBackground(out vec4, fragCoord)` | the **shaded** background region at any coordinate — subject bodies only |
| `kinoBackdrop(uBackdrop, uBackdropSize, fragCoord)` | the backdrop clip, cover-fit |
| `kinoCoverUV(texSize, fragCoord)` | cover-fit uv for any sized source |
| `aastep(edge, x)` | analytic 1px edge |

## Recipes

### Treat the subject, treat the background

```glsl
// subject.frag — lift and warm just the person
void mainImage(out vec4 c, in vec2 f) {
  vec3 s = texture(uTex0, f / iResolution.xy).rgb;
  c = vec4(mix(s, s * vec3(1.15, 1.05, 0.95), u_warm), 1.0);
}
```

### Rim light that thickens over the beat

```glsl
float d = kinoMaskDist(uMask0, uChannel0, fragCoord, u_rim);   // radius = the effect's reach
c.rgb = mix(c.rgb, uColorA, 1.0 - smoothstep(0.0, u_rim, -d));
```

Drive `u_rim` from `keyframes` — `at` is **seconds from this beat's start**, so the track rides real
VO timing and survives an earlier beat shifting. (Unlike `backgroundKeyframes`, which are absolute.)

### Glass that refracts what is actually behind

```glsl
vec2 bend = refractOffset(uv);
vec4 r; kinoBackground(r, fragCoord + bend);   // the SHADED background, not the raw plate
```

Bending `uTex0` instead shows the *untreated* footage through the glass — a hole punched to a
different image. Use `uTex0` only when the background is a passthrough.

### Subject onto different footage

```jsonc
"regionShader": { "mask": "masks/presenter", "backdrop": "pexels/beach.mp4" }
```

The backdrop starts at the beat's start, one backdrop frame per composition frame, cover-fit, last
frame holding if the beat outlasts the clip. `clipFrom`/`speed`/`pauseAt` describe the beat's own
source and do **not** apply — trim the backdrop clip instead. There is no `backdropFrom`.

### A motion graphic the shader can bend

```jsonc
"regionShader": { "mask": "masks/clip", "subject": "backgrounds/glass.frag",
                  "textures": ["motion/badge.html"] }
```

```glsl
vec4 g = texture(uTex2, fragCoord / iResolution.xy);   // full-frame, aligned 1:1 with the beat
c.rgb = mix(c.rgb, g.rgb, g.a);                        // straight alpha, not premultiplied
```

The same `.html` renders as it would as a `motionOverlay` — same scrub stylesheet, `--progress` 0→1
across the beat, same palette, fonts and filter library — except the shader can refract, mask and
light it. Tier-1 `.html` only: `.js` and Lottie are produced per frame by the DOM layer and build
rejects them here.

## Traps

**All bodies share one GLSL scope.** Only `mainImage` is renamed. Two independently written frags
that each open with `const float SHOULDER = 26.0;` — or a `float lum(vec3)` helper — fail to compile
with `ERROR: 'SHOULDER' : redefinition`, naming a line in assembled source that exists on no disk.
Prefix file-scope names per body (`GLASS_SHOULDER`, `METAL_SHOULDER`) or keep them inside
`mainImage`. Naming the same `.frag` as two entries' `subject` collides the same way — that is what
the top-level `subject` fallback is for, and it compiles once however many masks share it.

**Never guard a `kinoMaskDist` call.** Screen-space derivatives are undefined inside non-uniform
control flow, and it compiles clean — so the failure is silent. Call it unconditionally and branch
on the result. Same rule for anything that calls `aastep` or `kinoBackground` internally.

**Pass the smallest radius that covers the effect.** Beyond the mask's own transition band the
helper falls back to a coarse 24-tap spiral whose error grows with `radius`; a feature thinner than
~0.36·`radius` can vanish entirely. A 3px rim wants radius 4, not 32. Cost is 24 taps per pixel per
calling body.

**Multi-object addressing is video-only.** An image mask packs every object into one grayscale
`mask.png`, so `object` must be `0`; build errors otherwise. Distinct objects need a video mask,
where they occupy separate R/G/B channels.

**Masks generated before 2026-07-24 carry chroma noise.** They were encoded 4:2:0, which put two of
three packed objects at half resolution and broke `kinoMaskDist` on objects 1 and 2. Re-run
`kino segment` on any old mask a beat needs edge distance from.

**Overlap is painter's order.** In `masks[]`, later entries paint over earlier ones. Reorder the
array to change who is in front.

**Expect an edge fringe over a backdrop.** Real footage bleeds its original background into the
silhouette — a mask cut from grass carries an olive rim, invisible over grass and obvious over a
night city. The remedy is author-side: hand the outer ~2px back to the background in a per-mask
`subject` body.

```glsl
vec4 s = texture(uTex0, fragCoord / iResolution.xy);
vec4 b; kinoBackground(b, fragCoord);
float d = kinoMaskDist(uMaskSelf, uChannelSelf, fragCoord, 6.0);
fragColor = mix(s, b, smoothstep(-3.0, -1.0, d));      // ~2px erode
```

**Four numeric params for the whole beat**, not per body — every body compiles into one program with
one uniform bank. Exceeding it is a build error naming the params, not a silent drop.

**`params`/`keyframes` live on `regionShader` itself**, never on a `masks[]` entry.

## Cost

Every body runs for every pixel, then composites. N distinct subject bodies plus the background is
N+1 bodies per pixel on the default software renderer. Measured on an Apple M4, 1080×1920:

| bodies/px | light shader | heavy shader |
|---|---|---|
| 2 (one mask, union) | 0.37 s/frame | 0.71 s/frame |
| 5 (four masks, one body each) | 0.48 s/frame | 1.30 s/frame |

A spec that uses no per-entry `subject` emits the old union program byte-for-byte and pays nothing
for the feature. One `kinoBackground` call is ~5% of what a bevel's distance lookups already cost;
a wide kernel over an expensive background is the one shape that gets dear.

## Before calling it done

- Render at 2–3 times across the beat, not one — a frozen mask and a tracked one look identical at
  `t=0`. `kino still specs/x.json --at 0.5,2.0` renders both.
- Check the silhouette against the *destination*, not the source: fringe only shows over the new
  background.
- A compile failure now **fails the render** with the driver log and line-numbered assembled source.
  If a beat renders as the flat night fill instead, the program built but a body wrote nothing —
  check the sampler you read.
- Determinism: everything here is a pure function of the frame index. Two renders of the same frame
  must be byte-identical; if they are not, something reached for a wall clock.
