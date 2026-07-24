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
  "objects": [{ "id": 0, "label": "the person", "channel": "r" }],
  "backend": "coreml", "tracked": false }
```

### Backends

- **coreml** (macOS/Apple Silicon) — real SAM3.1 segmentation via CoreML. Video is **per-frame** (`tracked:false`). Downloads models once to `~/.kino/sam/models/`. Needs a Python env; see Setup.
- **cuda** (Linux/Windows + NVIDIA) — the **full** SAM3.1 model in native PyTorch (`scripts/sam_runner_cuda.py`). This is the cross-platform path and the only one with **real video tracking**: the multiplex video predictor tracks each object across frames, so video masks are temporally coherent (`tracked:true`). Needs a Python env with a CUDA-enabled `torch` + the `sam3` package; see Setup.
- **mock** — deterministic synthetic ellipse mask, no model, any platform. For pipeline/CI tests and for authoring specs on a non-Mac machine.

`kino doctor` shows readiness rows (platform, models, python) for both real backends.

### Setup (coreml backend)

The CoreML runner (`scripts/sam_runner.py`) needs a Python env with `coremltools`, `torch`, and SAM3's tokenizer — like `whisper-cli`, kino does **not** auto-build it. Point `KINO_SAM_PYTHON` at such a venv:

```bash
export KINO_SAM_PYTHON=/path/to/venv/bin/python
```

Models auto-download from Hugging Face on first run (image: `AllanVester/SAM3.1-CoreML-FP16`; tracker: `sdkv2/sam3.1-coreml-tracker-spike`). Override the models dir with `KINO_SAM_MODEL`.

### Setup (cuda backend)

The PyTorch runner (`scripts/sam_runner_cuda.py`) needs a Python env with a **CUDA-enabled `torch`** and the **`sam3` package** installed. kino does **not** build this GPU env for you:

```bash
git clone https://github.com/facebookresearch/sam3 && pip install -e sam3   # + a CUDA torch
export KINO_SAM_PYTHON=/path/to/venv/bin/python
```

The checkpoint auto-downloads on first run (`sam3.1_multiplex.pt` — image + tracker in one file; from `facebook/sam3.1`, or set `SAM3_HF_REPO` to an open mirror / `KINO_SAM_CHECKPOINT` to a local file). `KINO_SAM_DEVICE` selects the device (default `cuda`; set `cpu` to run the identical logic on CPU — correct but very slow, for verification only).

**License:** SAM3.1 weights are Meta's **SAM License** (share-alike, field-of-use, attribution) — not permissive. Downloaded, never bundled.

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

### How region shaders assemble (for the curious)

`assembleRegionShaderSource` (`src/render/shaderSource.ts`) namespaces the two bodies with the GLSL preprocessor (`#define mainImage regionSubject` … `#undef` … `#define mainImage regionBg`), binds the beat asset to `uTex0` and the mask to `uMask`, and emits `fragColor = mix(bgColor, subjectColor, dot(texture(uMask, uv), uChannel))`. Both bodies run every pixel, then mix — fine for short-form; a `ponytail:` note marks the discard/stencil upgrade if cost ever matters.

## Video: tracking status

Tracking depends on the backend:

- **coreml** — **per-frame** (`tracked: false`). Each frame is segmented independently, so fast motion can flicker. True temporal tracking is verified as a CoreML package but not yet wired end-to-end (the conditioning-frame memory-encode export is the gap; see `docs/segmentation-tracking-todo.md` and `.superpowers/sdd/coreml-io-reference.md`).
- **cuda** — **real temporal tracking** (`tracked: true`). The full SAM3.1 multiplex video predictor runs in PyTorch: a text prompt is added on frame 0 and propagated through the clip, so each object keeps a stable identity across frames (its R/G/B channel) and masks are temporally coherent. This is the recommended path for moving subjects.

  > **Verification status (2026-07-24):** the CUDA image path is CPU-verified (real `backend:cuda` mask). The video-tracking pipeline is confirmed to *run* end-to-end on CPU (session start → `add_prompt` → `propagate_in_video` all execute), but a full tracked `mask.mp4` has **not** been produced-and-checked yet: CPU propagation is ~45 min/frame (unusable) and needs a real NVIDIA GPU + a realistic clip to verify. Run it on GPU to confirm `tracked:true` output before relying on it. The runner fails cleanly (`exit 2`) if the detector finds no objects — it never fabricates a mask.

## Platform

- **Generating masks**: macOS/Apple Silicon → **coreml**; Linux/Windows + NVIDIA → **cuda** (native PyTorch, real video tracking); `mock` anywhere.
- **Rendering** specs that use masks: any platform kino renders on.
- The backend seam (`src/segment/backend.ts` — union type + flat module + dispatch, mirroring `src/avatar/`) makes adding a backend a new module + one dispatch case (`src/segment/cuda.ts` is the second real one).
