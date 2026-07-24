# GPU validation: real masks, real footage, real encoders

**Date:** 2026-07-24
**Hardware:** vast.ai, NVIDIA RTX A4000 16GB, Ubuntu 22.04 (`nvidia/cuda:12.4.1-runtime-ubuntu22.04`),
16 vCPU. Instance destroyed at end of run.
**Base:** `feat/segmentation` @ `b814c31`.

Everything in the mask/shader chain up to this point was verified against synthetic fixtures. This
run puts the three unverified claims on real hardware with real footage:

1. `scripts/sam_runner_cuda.py`'s `-pix_fmt yuv444p -qp 0` mask encode had **never executed** — nothing
   in CI runs it. Only `src/segment/mock.ts`'s copy of the change had ever run.
2. That encode needs H.264 **High 4:4:4 Predictive** from the *system* `ffmpeg` (the runners use
   `KINO_FFMPEG` / bare `ffmpeg` off PATH, deliberately bypassing `src/media/binPaths.ts`). Verified
   only on ffmpeg 8.1.2 and bundled ffmpeg-static 6.0. A CUDA host ships Ubuntu's **4.4**.
3. Multi-object masks and per-object region shaders (`masks[].subject` + `uMaskSelf`) had never met
   on real data.

## 1. ffmpeg 4.4 verdict: PASSES

`apt-get install ffmpeg` on Ubuntu 22.04 gives:

```
ffmpeg version 4.4.2-0ubuntu0.22.04.1
```

The exact `sam_runner_cuda.py` argv, run against that binary:

```
ffmpeg -y -loglevel error -framerate 24 -i m%04d.png -c:v libx264 -pix_fmt yuv444p -qp 0 -an mask44.mp4
→ exit 0
```

**No error, no silent degradation.** The `KINO_FFMPEG=<node_modules/ffmpeg-static/ffmpeg>` workaround
was not needed and was not exercised. The "unresolved" item at the bottom of
`2026-07-24-multi-object-chroma.md` is now resolved: the profile requirement is met by the oldest
ffmpeg a CUDA box realistically has. libx264's 4:4:4 support long predates 4.4, so this is expected
to hold below 4.4 as well — untested.

## 2. The mask the real encoder produced

`kino segment projects/gpuval/assets/pexels/zebras2s.mp4 --prompt "zebra" --objects 2 --backend cuda`
— real SAM3.1 temporal tracking on the A4000, 50 frames @ 1280x720, **52.9s wall clock**.

Manifest reports what it should:

```json
{ "kind": "video", "prompt": "zebra", "width": 1280, "height": 720,
  "objects": [ { "id": 0, "label": "zebra", "channel": "r" },
               { "id": 1, "label": "zebra", "channel": "g" } ],
  "backend": "cuda", "tracked": true, "fps": 25.0, "frames": 50 }
```

2 objects, distinct channels, `tracked: true`. `ffprobe` on the `mask.mp4` that 4.4.2 wrote:

```
codec_name=h264
profile=High 4:4:4 Predictive
pix_fmt=yuv444p
width=1280  height=720  nb_frames=50  r_frame_rate=25/1  bit_rate=947960
format_name=mov,mp4,m4a,3gp,3g2,mj2  duration=2.000000  size=238032
```

The encoder change took, on the runner that had never run it.

## 3. Real-mask noise vs the 0.0055 prediction: prediction held, with room to spare

Method reproduced from `2026-07-24-multi-object-chroma.md` so the numbers are comparable — flat-region
`g = length(vec2(dFdx(m), dFdy(m)))` as a 1px forward difference of normalised coverage, on frames
extracted exactly as the renderer extracts them (lossless PNG, per the `rsmask` branch in
`src/render/native/videoFrames.ts:221`). "Flat" = every pixel within Chebyshev radius 4 shares the
same source value, so the true gradient is exactly 0 and any reading is noise. The source is
recovered by binarising the decode at 128 — valid because the round-trip error is a couple of LSB,
not 128.

| ch | flat px | median | p99 | p99.9 | p99.99 | **max** | >0.01 | >0.05 | >0.1 |
|---|---|---|---|---|---|---|---|---|---|
| R (object 0) | 44,392,383 | 0 | 0 | 0 | 0 | **0.000000** | 0 | **0** | 0 |
| G (object 1) | 44,232,241 | 0 | 0 | 0 | 0 | **0.000000** | 0 | **0** | 0 |

**Predicted ~0.0055. Measured exactly 0.** The prediction held and then some.

Why it beats the spec's own figure: the spec attributed its residual 0.0055 to RGB→YCbCr rounding.
That rounding is still present here — the R channel's saturated value round-trips to **254/255**, not
255 (genuine R edges read `g = 0.9961 = 254/255`, while G edges read exactly `1.0000`). But with two
objects the mask only ever contains four RGB values, and each maps to a YCbCr triple that decodes
back to a spatially *constant* value. A constant offset has zero gradient. The spec's three-object
fixture had more channel combinations, and its rounding varied across the frame, which is what
produced 0.0055. So 0.0055 is the correct pessimistic bound; two objects land under it.

Separation from genuine edges is total:

| ch | max flat g | genuine-edge g (min / median / max) |
|---|---|---|
| R | 0.000000 | 0.9961 / 0.9961 / 1.4087 |
| G | 0.000000 | 1.0000 / 1.0000 / 1.4142 |

The 0.05 gate sits between two populations separated by a factor of ~20 with **nothing in between**.
On real footage with real motion and real edges, `kinoMaskDist`'s analytic branch is never wrongly
taken in a flat region. The gate's headroom on newly-generated masks is not 9x as the spec estimated
— it is unbounded, because the noise floor is zero.

Cost, real clip: `mask.mp4` 238 KB for 50 frames @1280x720 (2 objects); PNG extraction of all 50
frames 604 KB total. Both consistent with the spec's "the fix makes things smaller" finding.

## 4. Per-object region shaders on real data

Spec `examples/segmentation/per-object-zebras.json`, two entries pointing at the **same** mask asset
with different `object`, each carrying its own `subject`:

```json
"masks": [
  { "mask": "masks/zebras", "object": 0, "subject": "backgrounds/region-object0-cyan.frag" },
  { "mask": "masks/zebras", "object": 1, "subject": "backgrounds/region-object1-amber.frag" }
]
```

Both bodies rim their own subject via `kinoMaskDist(uMaskSelf, uChannelSelf, fragCoord, 14.0)` —
object 0 a single thin cyan band at `d ≈ -3`, object 1 a **double** amber band at `d ≈ -2` and
`d ≈ -8`, plus different body materials (smooth cool duotone vs 6-step posterised warm) so a swapped
identity would be obvious on sight. Background is crushed monochrome footage, chosen so that a
failure to bind the masks blanks the whole frame rather than looking like ordinary footage.

Built `--no-tts`, `fps: 25` matching the source, 1920x1080 16:9, **85.7s** wall clock,
`KINO_CONCURRENCY=4`.

### What the frames actually look like

Honest read, having extracted all 51 frames and inspected full frames at 2, 25, 49 plus 2x
nearest-neighbour crops on each subject's rim:

- **Both rims are clean.** Continuous, unbroken, single-pixel-accurate contours that follow the mask
  boundary exactly. **No speckle anywhere** — no dropouts, no dashed segments, no analytic-branch
  misfires in the interior. This is the visual counterpart of the zero noise floor above.
- **`uMaskSelf` resolves correctly per entry.** Along the contact edge where the two zebras abut,
  the cyan rim hugs object 0's side and the amber double-rim hugs object 1's side, simultaneously,
  neither bleeding into the other. If `uMaskSelf` had collapsed to `uMask0` both bodies would rim
  the same silhouette; they do not.
- **The two treatments are visibly, unmistakably different** and stay attached to the correct animal.
- **No identity swap.** Object 0's centroid drifts 621.4 → 572.6 px and object 1's 912.2 → 877.5 px
  monotonically across the 50 frames (the animals walking left); the tracks never cross or exchange.
  Coverage is likewise stable — object 0 60.5k–67.2k px, object 1 100.0k–106.4k px, no discontinuity.
- **The masks are disjoint on every frame** (`R & G` overlap = 0 px, all 50 frames). The zebras
  visually overlap and SAM assigned the occlusion boundary correctly, so the **painter's-order
  overlap rule was not exercised by this footage.** That rule remains synthetic-fixture-only. Noted
  rather than papered over.

### What looks wrong

One real finding, and it is a property of real data rather than of this code:

**Stray mask fragments get full rims, and the rim makes them conspicuous.** SAM's real masks are not
one connected blob per object. Counting connected components under 2% of the main blob:

| | stray fragments over 50 frames | largest stray |
|---|---|---|
| object 0 | 75 | 1118 px |
| object 1 | 202 | 1824 px |

Per frame, object 1 carries up to 10 stray fragments. Visible in the output: a ~40px amber blob sits
on the cyan zebra's back around frame 25, fully posterised and fully double-rimmed, and a second one
appears near the bottom edge. A plain fill would have rendered these as barely-noticeable colour
specks; the rim traces each one's outline and turns it into a deliberate-looking graphic element.

This is not a shader defect — the shader is doing exactly what it was asked. It is a **gap between
the synthetic fixtures and reality**: every fixture used to date had exactly one connected component
per object, so nothing ever surfaced the interaction between mask fragmentation and rim drawing. Any
future "clean rim" feature should assume the mask it is handed is fragmented. A largest-component
filter or a minimum-area threshold in the runner would address it; not attempted here because it is
a real design decision (a genuinely detached limb or a subject split by occlusion is also a small
component) rather than a bug with an obvious fix.

## 5. Other problems hit

- **`kino pexels` prints stale guidance.** On download it suggests
  `{ "kind": "app", "asset": "pexels/<id>.mp4", ... }`. Both fields were renamed — the schema takes
  `kind: "video"` with `source:`. An agent following the CLI's own output writes a spec that fails
  validation. Small, isolated, in `src/commands/pexels.ts`. Not fixed here to keep this run's diff
  to the validation artefacts; worth a one-line fix.
- **`kino segment` has no `--project` flag** (unlike `kino pexels --project`), inferring the project
  from the input path instead. Reasonable, but the asymmetry between two commands used back-to-back
  in the same workflow costs a failed invocation.
- **The same mask file is frame-extracted once per `masks[]` entry.**
  `src/render/native/videoFrames.ts:80` pushes one `rsmask${i}_${j}` job per entry keyed on
  `m.maskSrc`. Two objects packed into one `mask.mp4` — precisely the configuration this whole line
  of work exists to support — therefore decodes and writes the identical PNG sequence twice. Costs
  ~600 KB and a second decode pass here; scales with clip length and object count. Deduping by
  `maskSrc` needs the consumer side to map entry → job key, so it is not a one-liner; written up and
  left.
- **vast.ai's `/etc/environment` sets `HOME=/root` globally**, which survives `su - kino`. npm then
  tries to write `/root/.npm` as the non-root user and dies with `EACCES`. Fix: pass
  `env HOME=/home/kino npm_config_cache=/home/kino/.npm` explicitly. Cost two failed setup runs.
- **`ffmpeg` consumes stdin.** Piping a setup script into `ssh` lets an `ffmpeg` call inside it eat
  the remaining script text (a `for` loop arrived as `or i in ...`). Use `ffmpeg -nostdin`, or `scp`
  the script and run it by path. Not a kino issue; recorded so the next agent does not lose an hour.

## Artefacts

- `examples/segmentation/per-object-zebras.json` — the spec.
- `examples/segmentation/region-object0-cyan.frag`, `region-object1-amber.frag`,
  `region-backdrop.frag` — the three bodies.
- Footage: Pexels #37425597 by Magda Ehlers, 1280x720 25fps, trimmed to the first 2s.
- Output `per-object-zebras-16x9.mp4` (3.5 MB, 1920x1080, 25fps, 51 frames).
