# Cutout compositing — subject from the beat, background from another clip

**Status:** design, 2026-07-25. Implements the "virtual greenscreen" capability: a segmented
subject over footage that is *not* the beat's own asset.

## The gap

A region-shader beat has exactly one moving picture. `uTex0` is the beat's asset and every region
body is a recolouring/reshaping of that single plate. There is no second animated source, so a
presenter cannot be dropped onto another scene.

The generic `backgroundTextures` `{kind:"video"}` channel looks like it should serve — it doesn't.
It still uses a `<video>`-element seek that never advances under headless capture, so it renders
frozen at frame 0 (`docs/segmentation-tracking-todo.md`). Region-shader **masks** hit the identical
wall and solved it by routing through the node-side frame pipeline (`videoFrames.ts` pre-extracts
one image per composition frame under `/vframes`; `RegionShader.tsx` uploads the current frame's
`<img>`). This feature follows the mask path, not the `bgTextures` one.

## Surface

One new key on `regionShader`:

```jsonc
"regionShader": {
  "mask": "masks/zebco",
  "backdrop": "pexels/beach.mp4"      // project-relative, like `source` / `mask`
}
```

- Image or video (`.mp4`/`.mov` → per-frame extraction; anything else → a static texture loaded once).
- One backdrop per beat. Not per-`masks[]`-entry: there is exactly one background region, so a
  per-entry backdrop would have nowhere to go.
- `regionShader` no longer needs a shader body when a `backdrop` is present — `mask` + `backdrop`
  alone is the whole cutout spec.

### Why a `regionShader` field and not a revived `backgroundTextures` channel

`backgroundTextures` is **page-global** (one set for the whole composition) while `/vframes` jobs are
**per-beat** — keyed off the segment index, sharing that beat's sequence window and clock. A
page-global channel has no beat to borrow a clock from, which is exactly why routing it through
`/vframes` was never "trivially" doable. A `regionShader.backdrop` has a beat by construction, so it
drops straight into `planMediaJobs` beside the mask jobs. That bug stays open and untouched.

## GLSL binding

`REGION_HEADER` already declares `uTex0..3` + `uTexSize0..3` (it embeds `UNIFORM_HEADER`) and
region shaders bind only `uTex0`. So the backdrop needs **no new uniform** — it binds to the free
`uTex1`, and readable aliases are emitted *conditionally*:

```glsl
#define uBackdrop     uTex1
#define uBackdropSize uTexSize1
```

Emitted only when the beat has a backdrop — same conditional-emission discipline `kinoBackground`
uses — so a spec without one gets **byte-identical** GLSL.

Texture unit 5 (0 = asset, 1..4 = the four mask slots).

## Semantics: what a passthrough background means now

| | subject region (mask > 0.5) | background region |
| --- | --- | --- |
| no `backdrop` (today) | `subject` body, else the beat asset stretched | `background` body, else the beat asset stretched |
| **with `backdrop`** | unchanged — `subject` body, else the beat asset | `background` body, else **the backdrop, cover-fit** |

So the default with a backdrop and no bodies at all is precisely the cutout: the beat's asset shows
inside the mask, the other clip shows everywhere else.

The subject-side passthrough deliberately stays the beat asset. The subject *is* the thing being cut
out; a backdrop passthrough there would erase it.

`kinoBackground` keeps working unchanged and now means something better: with a backdrop and no
`background` body, a glass subject refracts **the backdrop**, not its own plate. Both bodies can
also sample `uBackdrop` directly.

## Fit

`kinoCoverUV`/`kinoBackdrop` already encode aspect-correct cover-fit; they need `uTexSize`, which
`RegionShader.tsx` has never uploaded (zero references). So:

- Upload `uTexSize1` = the backdrop image's natural pixel size, and make the background passthrough
  `kinoBackdrop(uTex1, uTexSize1, fragCoord)`. A 16:9 backdrop in a 9:16 frame fills the frame and
  crops horizontally, rather than squashing.
- **`uTexSize0` stays unuploaded (0,0).** Uploading it would silently switch any existing spec that
  calls `kinoBackdrop(uTex0, uTexSize0, ...)` from stretch to cover-fit — a behaviour change for
  specs that do not use this feature. Out of scope; noted as an asymmetry.

## Timing

**The backdrop plays from its own start at the beat's start, one backdrop frame per composition
frame.** Precisely: composition-local frame `n` of the beat shows the backdrop frame whose
presentation timestamp is nearest `n / fps` seconds (`nearestPtsIndex`, the same rule footage uses).
If the beat outlasts the backdrop, the last extracted frame holds.

No `backdropFrom` / `backdropSpeed` / freeze coupling. YAGNI, recorded: the beat's `clipFrom` /
`speed` / `pauseAt` describe *its own* source and mean nothing on an unrelated clip — seeking a
different file to the same second is arbitrary rather than useful. Trim the backdrop clip, or add
the knobs when a real spec wants them.

## Cost

One extra 1080×1920-class texture upload per frame plus one `texture()` tap in whichever body reads
it. No extra body evaluations, no framebuffer. Extraction adds one ffmpeg pass per beat, the same
as adding one more mask.

## Tests

1. **Byte-identical GLSL** (`tests/segment-regionshader-src.test.ts`) — `toBe` on assembled source
   with the new arg defaulted vs. explicitly false, and the alias/passthrough present only when true.
2. **Render test** (`tests/render-region-backdrop.test.ts`) — the load-bearing one. The whole reason
   this capability is missing is a frozen-video bug that renders frame 0 forever and looks
   plausible, so "background pixels came from the other clip" is not enough. Two videos are built
   with ffmpeg `geq`, frame-indexed: the **asset** is a pure red ramp (`R = 40 + 7N`, G=B=0), the
   **backdrop** a pure blue ramp (`B = 40 + 7N`, R=G=0) plus a green stripe at source
   x ∈ [0.55, 0.60]. One static rectangular mask. Rendered at frames 0 and 20:
   - subject crop: red rises 40→180/255, blue stays 0 — the asset animates and is *not* the backdrop;
   - background crop: blue rises 40→180/255, red stays 0 — **the backdrop animates** and is *not* the asset;
   - the green stripe's centre lands at frame x ≈ 795 (cover-fit of a 16:9 source into 9:16:
     `s.x = ra/ta = 0.5625/1.7778 = 0.3164`, so source u = 0.575 maps to `(0.575 - 0.342)/0.3164 =
     0.736` of the frame width) — a naive stretch would put it at 621, 174 px away;
   - two seeks to the same frame are byte-identical (determinism).
