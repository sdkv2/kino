# Segmentation — masks and mask-region shaders

`kino segment` turns any image or video into object **masks**, and those masks drive **shaders** — most powerfully, splitting a beat's frame so the segmented subject and the background each run their own shader.

## TL;DR

```bash
# 1. author-time: make a mask (macOS/Apple Silicon — CoreML)
kino segment path/to/clip.mp4 --prompt "the person"

# 2. use it: split a beat's frame by the mask, different shader per region
#    (spec app beat)
"regionShader": {
  "mask": "masks/clip",
  "subject": "backgrounds/glow.frag",       // where the person is
  "background": "backgrounds/plasma.frag"    // everywhere else
}
```

Masks are plain files (`mask.png` / `mask.mp4` + `manifest.json`) written into the project's `assets/masks/`. Generating them needs a Mac; **consuming** them at render time is cross-platform (Linux/CI/Pi all render specs that use masks).

## `kino segment`

```
kino segment <input> --prompt "<text>" [options]
```

| option | meaning |
|---|---|
| `--prompt <text>` | concept to segment ("the car", "the dog"). Required. |
| `--objects <n>` | cap objects (default 1, max 4 — packed into mask R/G/B/A). |
| `--out <name>` | artifact dir name under `assets/masks/` (default: input basename). |
| `--no-track` | video: force per-frame (no temporal tracking). |
| `--backend <coreml\|cuda\|mock>` | default: `coreml` on macOS, `cuda` elsewhere. `mock` runs anywhere. |
| `--format json` | machine-readable manifest to stdout (auto when non-TTY). |

Image input → `mask.png` (8-bit grayscale, white = object). Video input → `mask.mp4` (grayscale, or R/G/B/A when multi-object). Both come with `manifest.json`:

```json
{ "kind": "video", "source": "clip.mp4", "prompt": "the person",
  "width": 1080, "height": 1920, "fps": 30, "frames": 90,
  "objects": [{ "id": 0, "label": "the person", "channel": "gray" }],
  "backend": "coreml", "tracked": true }
```

### Backends

- **coreml** (macOS/Apple Silicon) — real SAM3.1 segmentation via CoreML. Video defaults to **real temporal tracking** (`tracked:true`) — frame 0's text→mask seeds the stateful CoreML tracker, which propagates each object across the clip. `--no-track` selects the fast per-frame path (`tracked:false`). Tracking is **~2.9s/frame** with vision backbone, per-frame encode (default; set `KINO_SAM_BACKBONE_EVERY=2+` to re-encode less often — ~1.9s/frame at 2, at the cost of coarser mask edges on fast motion); falls back to ~7–8s/frame on PyTorch CPU. Downloads models once to `~/.kino/sam/models/`. Needs a Python env; see Setup.
- **cuda** (Linux/Windows + NVIDIA) — the **full** SAM3.1 model in native PyTorch (`scripts/sam_runner_cuda.py`). The multiplex video predictor tracks each object across frames, so video masks are temporally coherent (`tracked:true`). Needs a Python env with a CUDA-enabled `torch` + the `sam3` package; see Setup.
- **mock** — deterministic synthetic ellipse mask, no model, any platform. For pipeline/CI tests and for authoring specs on a non-Mac machine.

`kino doctor` shows readiness rows (platform, models, python) for both real backends.

### Setup (coreml backend)

The CoreML runner (`scripts/sam_runner.py`) needs a Python env with `coremltools`, `torch`, and SAM3's tokenizer — like `whisper-cli`, kino does **not** auto-build it. Point `KINO_SAM_PYTHON` at such a venv:

```bash
export KINO_SAM_PYTHON=/path/to/venv/bin/python
```

Models auto-download from Hugging Face on first run (image: `AllanVester/SAM3.1-CoreML-FP16`; tracker: `sdkv2/sam3.1-coreml (tracker/)`; vision backbone: `sdkv2/sam3.1-coreml (backbone/)`). Per-frame features prefer **MLX** when `KINO_SAM_MLX_PYTHON` points at a venv with `mlx` + `mlx-vlm==0.4.3` (`mlx-community/sam3.1-bf16`); else the CoreML backbone package; else PyTorch CPU. Force with `KINO_SAM_BACKBONE_ENGINE=mlx|coreml|pytorch`. Override models dir with `KINO_SAM_MODEL`.

### Setup (cuda backend)

The PyTorch runner (`scripts/sam_runner_cuda.py`) needs a Python env with a **CUDA-enabled `torch`** and the **`sam3` package** installed. This is a separate, opt-in pathway — deliberately not part of `setup.sh`/`setup.mjs` or the npm install, since it's a heavy GPU env most kino installs never touch.

```bash
scripts/setup_sam_cuda.sh                 # builds ~/.kino/sam/venv, clones+installs sam3
export KINO_SAM_PYTHON=~/.kino/sam/venv/bin/python
```

The script pins torch+torchvision to a matched CUDA build in one install call and fills in sam3's under-declared runtime deps (einops, pycocotools, psutil) — see comments in the script for the failure modes each step avoids. Run it again to update an existing venv/checkout in place. For manual setup instead:

```bash
git clone https://github.com/facebookresearch/sam3 && pip install -e sam3   # + a CUDA torch
export KINO_SAM_PYTHON=/path/to/venv/bin/python
```

The checkpoint auto-downloads on first run (`sam3.1_multiplex.pt` — image + tracker in one file; from `facebook/sam3.1`, or set `SAM3_HF_REPO` to an open mirror / `KINO_SAM_CHECKPOINT` to a local file). `KINO_SAM_DEVICE` selects the device (default `cuda`; set `cpu` to run the identical logic on CPU — correct but very slow, for verification only).

**License:** SAM3.1 weights are Meta's **SAM License** (share-alike, field-of-use, attribution) — not permissive. Downloaded, never bundled.

#### Small-VRAM and pre-Ampere GPUs

SAM3's defaults assume a big Ampere-or-newer datacentre card. The runner detects a smaller or
older board and adapts automatically — no flags needed. What it changes, and why:

| Condition | Adaptation | Why |
| --- | --- | --- |
| compute capability < 8.0 (Turing/Volta: 2080 Ti, T4, …) | autocast runs **fp16** instead of sam3's hardcoded bf16 | Pre-Ampere mem-efficient SDPA rejects bf16 (`Expected query, key and value to all be of dtype: {Half, Float}`) and flash needs sm_80, so every attention call falls back to the math kernel and materializes the full N² score matrix. One ViT global-attention call asked for **12.81 GiB**; in fp16 the same shape peaks at **0.08 GiB**. |
| compute capability < 8.0 | flash-only `sdpa_kernel` requests are rewritten to prefer mem-efficient, math last | `decoder.py` wraps attention in an *exclusive* `sdpa_kernel(FLASH_ATTENTION)`, which raises `No available kernel. Aborting execution.` on Turing instead of falling back. |
| < 16 GiB VRAM | `batched_grounding_batch_size` 16 → 1 | The detector grounds a whole chunk of frames in one pass purely for throughput; peak transient memory scales with it. Does not affect the masks. |
| < 16 GiB VRAM | `offload_video_to_cpu`, plus the tracker's `offload_state_to_cpu` | Otherwise every decoded frame *and* every past frame's masks/memory-bank features sit in VRAM for the whole session — pure retention, ~16 MB/frame at 1080×1920. Device moves only: mask output is bit-identical (verified by md5). |

Overrides, if the auto-detection guesses wrong: `KINO_SAM_DTYPE=fp16|bf16`,
`KINO_SAM_GROUNDING_BATCH=<n>` (raise it if you have headroom, lower it if you still OOM).

**Measured on an 11 GiB RTX 2080 Ti** (sm_75), prompt `dog`, `--objects 3`:

| clip | peak VRAM | wall |
| --- | --- | --- |
| 32 frames @ 1080×1920 | 5.4 GiB | 37 s |
| 155 frames @ 1080×1920 | 6.1 GiB | 108 s |
| 884 frames @ 720×1280 | 8.4 GiB | 503 s |

fp16 vs bf16 is not a quality tradeoff: on an identical frame the two agree at **IoU 0.999**
(81 differing pixels out of 2.07 M).

Peak still grows with clip length (~6 MB/frame at 1080p) because the tracker must retain past
frames to attend over them — budget roughly **30 s of 1080p** on an 11 GiB board before it
OOMs. Longer sources want to be cut into segments first.

> Enabling the tracker's state offload also patches two upstream sam3 helpers
> (`video_tracking_multiplex._merge` / `_append`). sam3 never turns that flag on for the
> multiplex model, so the path is untested upstream and both helpers fold a fresh GPU result
> into now-host-side state without carrying the device across. The runner reinstates the
> device; if a future sam3 fixes this, the patch becomes a harmless no-op rewrite.

## Using masks

Three consumption paths, cheapest to richest.

### 1. Mask as a shader texture channel

Any mask file is a `backgroundTextures` channel (`uTex0..uTex3`). Image mask = static. **Note:** a *video* source in this generic `backgroundTextures` channel currently renders **frozen at frame 0** (it still uses the `<video>`-seek path). For animated video masks use **region shaders** (below), which route video through the `/vframes` frame pipeline. Routing this generic channel the same way is queued in `docs/segmentation-tracking-todo.md`.

```json
"background": "custom",
"backgroundComponent": "backgrounds/replace.frag",
"backgroundTextures": [
  "footage-still.png",
  { "source": "masks/clip/mask.mp4", "kind": "video" }
]
```

The shader samples `uTex1` (the mask) to composite — e.g. `mix(bg, subject, texture(uTex1, uv).r)`.

### 2. Region shaders — the main event

On an `app` beat, `regionShader` splits the beat's own asset by the mask: the **subject** region (mask > 0.5) runs one shader, the **background** region (mask ≤ 0.5) runs another. Output is the beat's visual; captions/logo composite on top as usual.

```json
{
  "kind": "app",
  "asset": "segdemo/subject.png",
  "text": "...",
  "regionShader": {
    "mask": "masks/segdemo-mask",
    "subject": "backgrounds/region-red.frag",
    "background": "backgrounds/region-green.frag",
    "object": 0
  }
}
```

Each `.frag` is an ordinary ShaderToy-style `mainImage` body (the same format as a shader background) — normal shaders work as region shaders unchanged. Omit `subject` or `background` to pass that region's original asset pixels through. `object` picks which mask object (its R/G/B/A channel) does the split.

A **video** mask (`mask.mp4`) and a **video** beat asset both animate: each source is pre-extracted to per-frame images (`src/render/native/videoFrames.ts` → `/vframes`, the same pipeline footage uses) and the region shader uploads the current composition frame's image to GL each frame — so a moving subject stays masked. Image masks and image assets are static. (Verified: a moving-ellipse mask renders the split at a different position at t=0 vs t=1.5.)

**Multi-object addressing is video-only.** Image masks pack every object into one grayscale `mask.png`, so `object` must be `0` for an image mask (build errors otherwise). Distinct objects need a video mask, where they occupy separate R/G/B channels.

Inside a region shader you can sample:
- `uTex0` — the beat's own asset (the thing being segmented).
- the shader's own params/uniforms (`u_*` aliases, `iTime`, etc.) as any shader.

**Worked example:** `examples/segmentation/` — a blue disc image, a mock mask, a solid-red subject shader and solid-green background shader. Its `README.md` has the exact commands (make a fixture asset, `kino segment --backend mock`, `kino still`). You get a red ellipse (subject) on green (background) — the mask boundary is the seam.

#### Distance to the mask edge

A region body sees a binary in/out by default. `kinoMaskDist` gives it the **signed distance to the
silhouette in pixels** — negative inside the masked region, positive outside — which is what rim
light, outline, outward glow, chromatic fringe and erode/dilate all need:

```glsl
float d = kinoMaskDist(uMask0, uChannel0, fragCoord, 8.0);
float rim   = 1.0 - smoothstep(0.0, 3.0, -d);   // 3px band just inside the edge
float glow  = 1.0 - smoothstep(0.0, 8.0,  d);   // falloff outward from the edge
float eaten = step(-4.0, d);                    // erode the subject by 4px
```

Pass the same `uMaskN`/`uChannelN` pair the split itself uses (`uMask0`/`uChannel0` for a single
mask). It works from the subject body, the background body, or both.

It runs in two regimes. Inside the mask's own transition band it reads **sub-pixel** distance from
screen-space derivatives, costing no extra texture taps. Beyond that band the coverage saturates
and it falls back to a 24-tap search accurate only to roughly a third of `radius` — 24 samples over
a disc of radius R sit ~0.36R apart, which is an information limit rather than a tuning choice, and
the error varies with edge orientation. So **pass the smallest radius that covers your effect**: a
3px rim wants radius 4, not 32. The value saturates at `±radius`.

Cost is 24 taps per pixel per calling body, on top of the two bodies that already run for every
pixel — calling it once per mask across a 4-mask union would be 96.

### How region shaders assemble (for the curious)

`assembleRegionShaderSource` (`src/render/shaderSource.ts`) namespaces the two bodies with the GLSL preprocessor (`#define mainImage regionSubject` … `#undef` … `#define mainImage regionBg`), binds the beat asset to `uTex0` and the mask to `uMask`, and emits `fragColor = mix(bgColor, subjectColor, dot(texture(uMask, uv), uChannel))`. Both bodies run every pixel, then mix — fine for short-form; a `ponytail:` note marks the discard/stencil upgrade if cost ever matters.

> **The two bodies share one GLSL scope.** Only `mainImage` is renamed — everything else you declare at file scope lands in a single translation unit alongside the other frag. Declaring the same helper in both (`float lum(vec3)` is the classic) is a duplicate definition: `ERROR: 'lum' : function already has a body`. Either give the helpers distinct names or inline them. The same goes for file-scope `const`s and `struct`s.
>
> A program that won't compile now **fails the render** with the driver's log and the assembled source, line-numbered so the reported line is findable (the driver counts lines in the assembled program, which does not exist on disk). It used to render as a flat wash with no diagnostic — see `src/render/native/page/fatal.ts`.

## Video: tracking status

Both real backends do **real temporal tracking** by default (`tracked: true`):

- **coreml** — the frame-0 text→mask (CoreML image seg) seeds a PyTorch mask-prompt init; each frame's vision features (**MLX preferred** → CoreML `sam3_vision_backbone.mlpackage` → PyTorch CPU) feed the **stateful CoreML tracker** (`dense_sam3_trackstep.mlpackage`). `--no-track` forces the fast per-frame path (`tracked:false`), where each frame is segmented independently and fast motion can flicker.

  > **Cost:** **~2.9s/frame** measured with CoreML backbone, per-frame encode (default, `KINO_SAM_BACKBONE_EVERY=1`); `KINO_SAM_BACKBONE_EVERY=2` drops to ~1.9s/frame (encode 4/7 frames on the disc fixture, identical 210px centroid travel there) but visibly coarsens mask edges on fast-moving thin shapes in real video. MLX backbone (auto-preferred when a usable venv resolves) is ~3s/encode on this Mac, faster on published M3 Max (~0.8s ViT). Set `KINO_SAM_BACKBONE_ENGINE=coreml` to force CoreML. PyTorch released after frame-0 init. Export: `scripts/export_sam_backbone_coreml.py`. HF: `sdkv2/sam3.1-coreml (backbone/)`.
  >
  > **Verification status (2026-07-24):** verified end-to-end on this Mac — moving-disc clip → `mask.mp4`, `tracked:true`, centroid follows disc (every=1/2/3/5 all PASS the >100px travel gate; every=5 travel drops 210→175). CoreML-backbone vs PyTorch: fp16 cosine ≥ 0.99997. Tracker + backbone auto-download from HF.
- **cuda** — the full SAM3.1 multiplex video predictor runs in PyTorch: a text prompt is added on the first frame that actually detects, then propagated in **both** directions (everything before the seed frame is only reachable backwards), so each object keeps a stable identity across frames (its R/G/B channel) and masks are temporally coherent.

  > **Verification status (2026-07-24):** **GPU-verified** on an 11 GiB RTX 2080 Ti (sm_75, Turing). Real Pexels footage of three dogs on grass, prompt `dog`, `--objects 3` → `mask.mp4`, `tracked:true`, all three subjects masked with stable per-object R/G/B identity across the clip (including one heavily occluded third subject). 155 frames @1080×1920 peaks at 6.1 GiB; 884 frames @720×1280 at 8.4 GiB. See *Small-VRAM and pre-Ampere GPUs* for what the runner adapts and the measured numbers. The runner fails cleanly (`exit 2`) if the detector finds no objects — it never fabricates a mask.
  >
  > Not yet verified: tracker robustness over long clips. On a 15 s handheld clip of two small, fast, partly-occluded puppies, masks intermittently drop out mid-clip and one subject briefly picked up two object IDs. That is tracker behaviour on a hard clip, not a precision artifact — the fp16 path matches bf16 at IoU 0.999 on an identical frame — but it has not been characterized against a bf16 Ampere run.

## Platform

- **Generating masks**: macOS/Apple Silicon → **coreml**; Linux/Windows + NVIDIA → **cuda** (native PyTorch, real video tracking); `mock` anywhere.
- **Rendering** specs that use masks: any platform kino renders on.
- The backend seam (`src/segment/backend.ts` — union type + flat module + dispatch, mirroring `src/avatar/`) makes adding a backend a new module + one dispatch case (`src/segment/cuda.ts` is the second real one).
