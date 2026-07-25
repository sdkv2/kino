# Cutout compositing — report

**Branch:** `feat/cutout-compositing`, off `origin/main` (`e1619c4`).
Design: `2026-07-25-cutout-compositing-design.md`. Plan: `docs/superpowers/plans/2026-07-25-cutout-compositing.md`.

A region-shader beat can now composite its segmented subject over a **different clip**. Virtual
greenscreen with no green screen.

## The surface

One key on `regionShader`:

```jsonc
"regionShader": { "mask": "masks/presenter", "backdrop": "pexels/beach.mp4" }
```

That is a complete spec — no `.frag` anywhere. The `refine` that demands a shader body now counts a
backdrop, because `mask` + `backdrop` *is* the cutout.

Project-relative, image or video, one per beat (there is exactly one background region, so a
per-`masks[]`-entry backdrop would have nowhere to go). The object stays `.strict()`, so `backdropp`
fails loudly rather than rendering a beat that looks merely disappointing.

**Why a `regionShader` field and not the revived `backgroundTextures` video channel.** That channel
is page-global; `/vframes` jobs are per-beat, keyed off the segment index and borrowing that beat's
sequence window and clock. A page-global channel has no beat to borrow from — which is the actual
reason routing it was never "trivially" doable, not an oversight. A `regionShader.backdrop` has a
beat by construction, so it drops in beside the mask jobs. That bug is untouched and I said so in
`docs/segmentation-tracking-todo.md` rather than letting the next reader assume this covered it.

## How the backdrop is routed

Exactly the path region-shader video masks take, because that path is the one that is proven to
animate under headless capture:

1. `planMediaJobs` (`src/render/native/videoFrames.ts`) registers `rsbd<i>` when the backdrop is
   `.mp4`/`.mov` — ffmpeg pre-extracts one image per composition frame of the beat under `/vframes`.
2. `KinoVideo` passes `backdropMediaKey={"rsbd" + i}`; `RegionShader` resolves the current frame's
   URL with the same `useFrameImageUrl` hook the masks use and uploads that `<img>` into the texture.
3. Image backdrops get no job and load once as a static texture.

Not an `appMediaJob`: those inherit the beat's `clipFrom`/`speed`/`pauseAt`, which describe the
beat's **own** source. Seeking an unrelated file to the same second is arbitrary, so the backdrop
gets its own ten-line job.

**GLSL binding costs nothing.** `REGION_HEADER` already declared `uTex0..3` + `uTexSize0..3` and
region shaders bound only `uTex0`, so the backdrop rides the free `uTex1`/`uTexSize1` on texture unit
`MAX_REGION_MASKS + 1`. Readable aliases are emitted *conditionally*, the way `kinoBackground`'s
forward declaration is:

```glsl
#define uBackdrop uTex1
#define uBackdropSize uTexSize1
```

## What a passthrough background means now

| | subject region (mask > 0.5) | background region |
| --- | --- | --- |
| no `backdrop` | `subject` body, else the beat asset stretched | `background` body, else the beat asset stretched |
| **with `backdrop`** | **unchanged** | `background` body, else **the backdrop, cover-fit** |

The subject-side passthrough deliberately stays `uTex0`. The subject *is* the thing being cut out; a
backdrop there would erase it.

`kinoBackground` keeps working and now means something better: with a backdrop and no `background`
body it resolves to the backdrop, so a glass subject refracts the *other clip* rather than punching a
hole to its own untreated plate. Both sides can also sample `uBackdrop` directly.

## Fit

Cover-fit, via the existing `kinoBackdrop`/`kinoCoverUV` helpers — which needed `uTexSize`, and
`RegionShader.tsx` had **never uploaded a single one** (zero references before this branch). `Slot`
now carries the source's `naturalWidth/naturalHeight` and the backdrop's is uploaded as `uTexSize1`,
refreshed every frame because a sparse still can build the slot before its `/vframes` image exists.

**`uTexSize0` is still not uploaded, on purpose.** Uploading it would silently switch any existing
spec that calls `kinoBackdrop(uTex0, uTexSize0, …)` from stretch to cover-fit — a behaviour change
for specs that don't use this feature, which the non-negotiable forbids. It leaves an asymmetry
(`uBackdropSize` is real, `uTexSize0` reads `(0,0)`) that is documented in both the code and
`docs/segmentation.md`.

Fit is not a matter of opinion in the test: cover-fit of 1280×720 into 1080×1920 scales `uv.x` by
`ra/ta = 0.3164`, so a marker at source `u = 0.575` must land at **x = 796** of 1080. Measured
**797.5**. A stretch puts it at 621, and the deliberate break below produced exactly **621.5**.

## Timing

**The backdrop starts at the beat's start, one backdrop frame per composition frame.** Precisely:
composition-local frame `n` shows the backdrop frame whose presentation timestamp is nearest
`n / fps` seconds (`nearestPtsIndex`, the rule footage already uses); if the beat outlasts the clip
the last extracted frame holds.

No `backdropFrom` / `backdropSpeed` / freeze coupling. **YAGNI, recorded.** The beat's
`clipFrom`/`speed`/`pauseAt` are not reused because they describe a different file. Authors trim the
backdrop clip; the knobs go in when a real spec wants them.

## Edge quality — the honest look

Rendered `projects/segtest`'s real 2-object CoreML zebra mask over a night rain-on-glass Pexels clip
and zoomed the silhouette. **It fringes.** A visible olive rim rides the zebras' backs: the mask was
cut from grass, so the outer pixel or two of the silhouette still carries grass, which is invisible
over grass and obvious over a dark blue backdrop. That is matting bleed in the source footage, not a
compositing bug — but it is what a cutout is judged on, and the fixed `smoothstep(0.4, 0.6, m)` has
no way to know about it.

Measured, in the 2px band just inside the mask edge, as green excess `g - (r+b)/2`:

| region | green excess |
| --- | --- |
| 2px band inside the edge (whole silhouette) | **+0.009** |
| deep inside the subject | **−0.006** |
| 2px band, localized to the fringing back/neck | **+0.018** |

The author-side remedy composes out of two helpers that already existed
(`examples/segmentation/region-erode2.frag`), used as each mask's `subject`:

```glsl
vec4 s = texture(uTex0, fragCoord / iResolution.xy);
vec4 b; kinoBackground(b, fragCoord);
float d = kinoMaskDist(uMaskSelf, uChannelSelf, fragCoord, 6.0);   // negative inside
fragColor = mix(s, b, smoothstep(-3.0, -1.0, d));                  // ~2px erode
```

It **works** — the rim visibly clears (`projects/cutout/out/edge-fringe-vs-erode.png`, unfringed
version below the fringed one) and localized green excess drops **+0.018 → +0.011** while the band's
mean brightness falls 0.37 → 0.25 as the backdrop takes over. It is not free: it eats ~2px of mane
detail, and it does not reach zero (the outermost pixel is still full subject).

**The compositing default is unchanged.** Every existing region-shader spec shares that
`smoothstep(0.4, 0.6, m)`; a silent 2px erode for everyone to fix a fringe only cutouts notice would
be a worse trade than a documented `.frag`.

## Cost

- **Fragment work:** one extra `texture()` tap in whichever body reads the backdrop. No extra body
  evaluations, no framebuffer, no second pass.
- **Per frame:** one extra texture upload (one decoded `<img>`).
- **Extraction:** one ffmpeg pass per beat, one image per composition frame — the same as adding one
  more mask.
- **Measured end to end** (2 s, 50 frames, 1920×1080, Apple M4, SwiftShader, `kino build --mock`):
  with backdrop **4.84 / 4.98 / 5.28 s**, the same spec with a passthrough `background` body and no
  backdrop **4.99 / 5.06 s** (cold first run 7.24 s). The difference is **below run-to-run noise** at
  this size, which is what one tap and one upload should look like.

## Tests, and proof they bite

**Byte-identical GLSL** (`tests/segment-regionshader-src.test.ts`) — `toBe` on assembled source for
three shapes (both bodies, passthrough background, per-object + params) with the new arg explicitly
`false` vs. absent, plus `not.toContain("uBackdrop")` on the default program. Same bar phases 2–4 held.

**Spec surface** (`tests/segment-regionshader-schema.test.ts`) — backdrop alone parses, coexists with
bodies, and a misspelling still throws.

**Timing contract** (`tests/segment-backdrop-job.test.ts`) — the `rsbd0` job's `startSec` is 0 and
`stepSec` is `1/fps` on a beat whose `clipFrom` is 5 s at 2× speed, so a future refactor that quietly
routes the backdrop through `appMediaJob` fails here rather than shifting an author's backdrop.

**The render proof** (`tests/render-region-backdrop.test.ts`) — the one that matters. A test that only
checked "the background came from the other clip" would pass against exactly the frozen-frame-0 bug
that made this capability missing, so both sources are frame-indexed ffmpeg ramps in **disjoint
channels**: the asset is `R = 40 + 7N`, the backdrop `B = 40 + 7N` plus a green stripe at source
`x ∈ [0.55, 0.60]`. A crop's hue says which clip, its value says which frame. Rendered at frames 0
and 20 with a static mask, everything predicted from the geometry before running:

```
subject    f0 = (0.157, 0, 0)          f20 = (0.706, 0, 0)
background f0 = (0.004, 0, 0.157)      f20 = (0, 0.004, 0.706)
stripe centre 797.5   (cover-fit predicts 796; stretch would be 621)
```

Three deliberate breaks, each run against the suite:

| break | result |
| --- | --- |
| skip the backdrop's per-frame `updateFrameSlot` (**the frozen-video bug**) | background blue reads **0.157 at both frames**; `expected 0.549 to be less than 0.035`. Note the subject still animated — this is exactly the plausible-looking failure the test exists to catch. |
| backdrop passthrough samples `uTex0` instead | background reads the beat's red asset; `expected 0.156863 to be less than 0.06` |
| upload `uTexSize1` as `(0, 0)` (no fit) | stripe centre **621.5**, bbox 55px wide not 173; `expected 174.5 to be less than 25` |

Plus determinism (two seeks to frame 0 are byte-identical) and cross-channel purity in both crops.

**Suite:** `npx vitest run` → 83 files passed, 3 skipped; 593 passed, 3 skipped. `npm run build` clean.

## Real render

`projects/cutout/` in this worktree (gitignored, like every project):

- `out/cutout/cutout-draft-16x9.mp4` — two tracked zebras on the rain-glass clip, no `.frag` at all.
- `out/cutout-erode/cutout-erode-draft-16x9.mp4` — the same with the 2px erode.
- `out/cutout-two-frames.png` — t = 0.2 s and t = 1.6 s side by side; the backdrop's bokeh and
  raindrops have visibly moved, which is the capability in one picture.
- `out/edge-fringe-vs-erode.png` — the zoomed silhouette, fringed above, eroded below.

## Unresolved

- **`uTexSize0` asymmetry.** Left at `(0,0)` to protect existing specs. Worth uploading behind an
  opt-in, or as a deliberate breaking change with a doc note, but not silently.
- **Fringing is a source problem with only an author-side fix.** A real matte refinement (colour
  unmixing / guided filter at the silhouette) belongs upstream in `kino segment`, next to
  `_erode1008`, not in the compositor.
- **One backdrop per beat.** Per-mask backdrops would need one background region per mask, which is a
  different compositing model. Not needed by anything.
- **Backdrop audio is ignored** — it's a texture, not a clip. Nobody asked; worth naming.
- **Cost is below noise at 1080p/50 frames**, so the tap's true marginal cost is unmeasured. If it
  ever matters, the shader-measure sink (`tests/render-measure.test.ts`) is the instrument.
- **`src/render/native/page/RegionShader.tsx` joins `glKey` with a literal NUL byte**, which makes
  `grep` treat the whole file as binary and silently return nothing — a real hazard for the next
  reader. Pre-existing, left alone, flagged separately.
