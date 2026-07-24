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
| `--backend <coreml\|mock>` | default: `coreml` on macOS, else error. `mock` runs anywhere. |
| `--format json` | machine-readable manifest to stdout (auto when non-TTY). |

Image input → `mask.png` (8-bit grayscale, white = object). Video input → `mask.mp4` (grayscale, or R/G/B/A when multi-object). Both come with `manifest.json`:

```json
{ "kind": "video", "source": "clip.mp4", "prompt": "the person",
  "width": 1080, "height": 1920, "fps": 30, "frames": 90,
  "objects": [{ "id": 0, "label": "the person", "channel": "r" }],
  "backend": "coreml", "tracked": false }
```

### Backends

- **coreml** (macOS/Apple Silicon) — real SAM3.1 segmentation. Downloads models once to `~/.kino/sam/models/`. Needs a Python env; see Setup.
- **mock** — deterministic synthetic ellipse mask, no model, any platform. For pipeline/CI tests and for authoring specs on a non-Mac machine.

`kino doctor` shows readiness rows (platform, models, python).

### Setup (coreml backend)

The CoreML runner (`scripts/sam_runner.py`) needs a Python env with `coremltools`, `torch`, and SAM3's tokenizer — like `whisper-cli`, kino does **not** auto-build it. Point `KINO_SAM_PYTHON` at such a venv:

```bash
export KINO_SAM_PYTHON=/path/to/venv/bin/python
```

Models auto-download from Hugging Face on first run (image: `AllanVester/SAM3.1-CoreML-FP16`; tracker: `sdkv2/sam3.1-coreml-tracker-spike`). Override the models dir with `KINO_SAM_MODEL`.

**License:** SAM3.1 weights are Meta's **SAM License** (share-alike, field-of-use, attribution) — not permissive. Downloaded, never bundled.

## Using masks

Three consumption paths, cheapest to richest.

### 1. Mask as a shader texture channel

Any mask file is a `backgroundTextures` channel (`uTex0..uTex3`). Image mask = static; a video mask channel currently renders at its first frame (see the video-mask limitation under Region shaders):

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

> **Video-mask animation — known limitation (2026-07-24).** In the deterministic render capture, a `mask.mp4` (and a video beat asset) currently render **frozen at their first frame** — the `<video>`-seek seam does not advance under headless capture, the same reason kino extracts footage frames node-side (`src/render/native/videoFrames.ts`). So a *moving* subject is NOT tracked frame-to-frame yet. **Image masks and image assets work fully.** For video today, either use a single representative mask frame, or wait for the fix below. Upgrade path (queued in `docs/segmentation-tracking-todo.md`): route the video mask/asset through the same node-side per-frame extraction footage uses, instead of a `<video>` element.

**Multi-object addressing is video-only.** Image masks pack every object into one grayscale `mask.png`, so `object` must be `0` for an image mask (build errors otherwise). Distinct objects need a video mask, where they occupy separate R/G/B channels.

Inside a region shader you can sample:
- `uTex0` — the beat's own asset (the thing being segmented).
- the shader's own params/uniforms (`u_*` aliases, `iTime`, etc.) as any shader.

**Worked example:** `examples/segmentation/` — a blue disc image, a mock mask, a solid-red subject shader and solid-green background shader. Its `README.md` has the exact commands (make a fixture asset, `kino segment --backend mock`, `kino still`). You get a red ellipse (subject) on green (background) — the mask boundary is the seam.

### How region shaders assemble (for the curious)

`assembleRegionShaderSource` (`src/render/shaderSource.ts`) namespaces the two bodies with the GLSL preprocessor (`#define mainImage regionSubject` … `#undef` … `#define mainImage regionBg`), binds the beat asset to `uTex0` and the mask to `uMask`, and emits `fragColor = mix(bgColor, subjectColor, dot(texture(uMask, uv), uChannel))`. Both bodies run every pixel, then mix — fine for short-form; a `ponytail:` note marks the discard/stencil upgrade if cost ever matters.

## Video: tracking status

Video masks are currently **per-frame** (`tracked: false`) — each frame is segmented independently, so fast motion can flicker. True temporal object tracking (the SAM3.1 multiplex tracker) is verified as a CoreML package but not yet wired end-to-end; the remaining work (export the conditioning-frame memory encoder, apply the `conv_s0/s1` projections) is in `docs/segmentation-tracking-todo.md`.

## Platform

- **Generating masks**: macOS/Apple Silicon (CoreML). `mock` backend elsewhere.
- **Rendering** specs that use masks: any platform kino renders on.
- Windows/CUDA backend: a clean seam exists (`src/segment/backend.ts` — union type + flat module + dispatch, mirroring `src/avatar/`); adding a backend is a new module + one dispatch case.
