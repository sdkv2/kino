# kino segmentation — design

Date: 2026-07-24
Branch: `feat/segmentation`
Status: authored autonomously (user asleep, explicit go-ahead). Review on wake; all decisions + rationale below. Work lands on branch, not `main`.

## Goal

`kino segment <image|video>` produces object masks from any image or video (arbitrary files or `kino pexels` footage). Masks become shader **texture channels** (`uTex0..uTex3`) so agents manipulate them with GLSL — cutout, matte, glow-around-subject, background-replace, selective warp. Agent-operated: text-prompt driven ("the person", "the car"), single-shot CLI, JSON out.

## Constraints (from user)

- **v1 is macOS / Apple-Silicon only** (CoreML backend — the verified SAM3.1 tracker + SAM3.1 image models). Windows/CUDA to be added later by the user, so the backend must be a clean seam, not a hardcode.
- Cross-platform render must not regress: kino renders on Linux/CI/Pi. The CoreML dependency is Mac-only.
- SAM3.1 is under Meta's **SAM License** (share-alike, field-of-use, attribution) — not permissive. Weights are downloaded on demand, never bundled.

## Core architecture — author-time masks, cross-platform consumption

The Mac-only dependency is quarantined to a **pre-render authoring step**:

```
[Mac only]                                    [any platform]
kino segment ──► mask artifacts ──────────► render consumes as
(CoreML)         (PNG / mask.mp4 + manifest)  shader texture channels
```

- `kino segment` runs the CoreML model (Mac) and writes **plain mask files** into the project's `assets/`. Nothing about the artifact is Mac-specific.
- Render (Linux/CI/Pi included) consumes those files as `backgroundTextures` → `uTexN`. No model, no CoreML at render time.
- Masks are committed project assets like any pexels clip — reproducible builds on any platform once authored.

This is the central decision: **segmentation is an asset-generation tool, not a render-time effect.** It keeps kino's cross-platform render intact and means a non-Mac machine can still *build* a spec that uses masks (it just can't *generate* new ones).

## Backend seam (extensible for Windows/CUDA)

Follow kino's existing provider pattern (`src/avatar/provider.ts` — union type + flat module + `if/else` dispatch, **no class hierarchy**):

```
src/segment/
  backend.ts     // type SegmentBackend = "coreml" | "mock"; pickBackend(env)
  coreml.ts      // Mac CoreML runner (subprocess to the python harness)
  mock.ts        // deterministic synthetic mask — CI/cross-platform, no model
  segment.ts     // orchestrator: dispatch, artifact writing, manifest
  manifest.ts    // mask-manifest read/write (shared with render)
```

Adding CUDA/Windows tomorrow = new `cuda.ts` + one dispatch case + one `SegmentBackend` member. Nothing else moves. `mock` is a first-class backend so the whole feature is testable on CI with no Mac and no model download.

## The CoreML engine (Mac backend)

Two model families, both downloaded lazily to `~/.kino/sam/` (whisper pattern: `existsSync` gate → `download()` → one `log.step`; `KINO_SAM_MODEL` env override):

- **Image seg** — complete, exists today: `AllanVester/SAM3.1-CoreML-FP16` (ImageEncoder + Detector + TextEncoder mlpackages). Text prompt → masks on any image. Fully achievable.
- **Video seg** — our verified tracker `sdkv2/sam3.1-coreml-tracker-spike` (stateful `track_step`, mux-16, fp16, `CPU_AND_GPU`) driven per-frame, seeded by the image encoder's features. Real temporal tracking.

**Runner:** a Python harness (managed venv under `~/.kino/sam/venv`, the patched-coremltools + torch-2.7.0 environment we already built) invoked as a subprocess — same shell-out shape as `whisper.cpp` (`src/vo/whisper.ts`), heavier setup. `coreml.ts` shells to it; the harness reads input frames, runs the model, writes mask artifacts. Venv bootstrap-on-first-use is new infra (no kino precedent) — documented as such.

**Honest scope risk (video):** the tracker was verified with *synthetic* image features; wiring the real image encoder's output shapes to the tracker's expected `vis72/hires0/hires1` is the one uncertain piece. If it lands: real tracked masks. If a piece doesn't come together overnight: **video falls back to per-frame image segmentation** (masks still produced for every frame, no temporal coherence — flicker possible) with an explicit `--no-track` note in output. The tracker stays wired for when the backbone bridge is finished. No faked success.

## Mask artifact format

Written under `<project>/assets/masks/<name>/`:

- `image` input → `mask.png` (8-bit grayscale, white = object) + `mask.<obj>.png` per object when multi-object.
- `video` input → `mask.mp4` (grayscale, one mask track; per-object via color channels R/G/B/A for ≤4 objects) at the source's fps/dimensions.
- `manifest.json` — `{ kind, source, prompt, fps?, frames?, width, height, objects: [{id, label, channel}], backend, tracked: bool }`. The render + `kino segment` both read/write it via `manifest.ts`.

## Shader consumption — video texture channel

Image masks already work as static `backgroundTextures` (`kind:"image"` → `uTexN`). **Video masks need a new texture kind** because today's `backgroundTextures` are static-image or per-frame-rasterized-HTML only — there is no video-sampled channel.

Extend the existing per-frame texture mechanism (`bgTextures.ts` already re-uploads a `CanvasImageSource` when its `revision` bumps — the animated-HTML path):

- Add `BgTexture` kind `"video"`: `{ kind:"video", src }`. Per frame, seek a hidden `FrameVideo`/decoded source to the composition time, draw its current frame to a canvas, bump `revision` → uploaded to `uTexN`. This reuses the exact animated-texture upload path; it is a bounded addition, not a new pipeline.
- Schema: `backgroundTextures` entry gains an object form `{ source, kind?: "video" }` (string stays image; `{source, param}` stays animated-html). A `.mp4`/`.webm` source auto-detects as video.

Agents then write an ordinary shader sampling `uTex0` (the mask) — e.g. `col = mix(bg, subject, texture(uTex0, uv).r)` for background replace. Ship one worked example shader + a docs section.

## Command surface

```
kino segment <input>            # image or video, auto-detected by extension/probe
  --prompt "<text>"             # concept prompt (SAM3.1 text). Required for auto-detect.
  --objects <n>                 # cap tracked objects (default 1; max 4 for RGBA video packing)
  --out <name>                  # artifact dir name (default: derived from input)
  --no-track                    # video: per-frame image seg, skip temporal tracking
  --backend <coreml|mock>       # default: auto (coreml on mac, else error unless mock)
  --format json                 # machine-readable result to stdout (default when non-TTY)
```

Follows the utility-command shape (`frames`/`transcribe`), lazy `await import("./commands/segment.js")`. `doctor.ts` gains: SAM model presence, venv presence, `HF_TOKEN` (if the gated official repo is used vs the open mirror), platform check.

Non-Mac invocation of the coreml backend exits non-zero with a structured error (`{error:"backend_unavailable", platform, hint}`) so an agent distinguishes "needs a Mac" from "bad input". `mock` works anywhere.

## Testing

- `mock` backend → deterministic mask → full command + manifest + schema + render-consumption path tested on CI, no Mac/model.
- Unit: manifest read/write round-trip; `backgroundTextures` video-kind schema validation; shader source assembly with a mask channel.
- `pickBackend` platform dispatch (mac→coreml, else→mock/error).
- One integration test: `kino segment fixture.png --backend mock` → asserts artifact + manifest.
- Mac-gated (skipped on CI): real image seg on a fixture, assert non-empty mask.

## Phasing (implementation plan will expand)

1. **Scaffolding + mock** — `src/segment/*`, `segment` command, manifest, schema fields, mock backend, tests, docs. Fully cross-platform, CI-green. (No model.)
2. **Video texture channel** — `BgTexture` `"video"` kind in `bgTextures.ts` + `ShaderBackground.tsx` + schema + example shader. Cross-platform.
3. **CoreML image backend** — venv bootstrap, HF model download, image runner, real masks on images.
4. **CoreML video backend** — image-encoder → tracker wiring; real tracked masks or documented per-frame fallback.

Phases 1–2 are the reusable, always-working core (mock + shader plumbing). 3–4 are the Mac engine. Build 1–2 solid; push 3–4 as far as they land tonight; leave honest status.

## Out of scope (YAGNI)

- Windows/CUDA backend (user does this next).
- Interactive point/box prompting (agents use text; add later if needed).
- >4 objects in a single video mask (RGBA packing ceiling; documented).
- ANE execution (platform-blocked; GPU path only).
- Real-time / streaming segmentation.
