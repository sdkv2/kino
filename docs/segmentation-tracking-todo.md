# Video segmentation: true temporal tracking (follow-up)

**Status today (Task 8):** `kino segment <video>` on the CoreML backend runs **per-frame image
segmentation** — each frame is segmented independently by the SAM3.1 image pipeline
(ImageEncoder → TextEncoder → Detector), masks are packed into a grayscale/RGB `mask.mp4`, and the
manifest is written with **`tracked: false`**. There is no temporal coherence: object identity is
not carried across frames and fast motion can flicker. This is deliberate and honest — see the gap
below for why real tracking is not yet wired.

## Why it's per-frame (the video-tracking gap)

The deployed tracker package (`sdkv2/sam3.1-coreml-tracker-spike` /
`scratchpad/sam3-coreml/dense_sam3_trackstep.mlpackage`) does **propagation only**. Its stateful
`predict` loop needs three per-session conditioning tensors from the *prompt frame*:

- `cond_mem` `[1,256,72,72]`, `cond_img` `[5184,1,256]`, `cond_ptr` `[1,16,256]`

These come from encoding frame 0 (detector/text-prompt → initial masks → SAM heads +
`_encode_new_memory`). **That init + memory-encode step is NOT exported to CoreML.** Without it the
tracker cannot be driven end-to-end from a real video. See
`.superpowers/sdd/coreml-io-reference.md` for the full I/O contract.

## What true tracking needs (three concrete steps)

1. **Export the cond-frame memory-encode step to CoreML.** A second conversion producing
   `cond_mem/cond_img/cond_ptr` from frame 0's image features + initial masks (the SAM head +
   `_encode_new_memory` front-half). This is the missing piece — everything downstream exists.
2. **Bridge the image encoder's hi-res levels into the tracker inputs.** Apply the
   `sam_mask_decoder.conv_s0` / `conv_s1` projections to the encoder's level-0/level-1 outputs to
   produce `hires0 [1,32,288,288]` and `hires1 [1,64,144,144]`, and flatten level-2 (256-ch, 72×72)
   into `vis72 [5184,1,256]`. Exact shapes/construction in
   `scratchpad/sam3-coreml/dense_wrapper.py::frame_inputs` and `common.synth_frame_features`.
3. **Drive the tracker's stateful predict loop.** Feed `cond_*` (per session) + per-frame
   `vis72/hires0/hires1/frame_pos` into the already-built, already-verified tracker mlpackage; its
   rolling `mem_bank/img_bank/ptr_bank` state auto-manages across calls. Working loop:
   `scratchpad/sam3-coreml/verify_coreml_lean.py`.

The tracker package is already built and verified — **only the front-half (steps 1–2) is missing.**
When it lands, `sam_runner.py`'s `--video` path gains a tracked branch that sets `tracked: true`;
until then it stays per-frame and honest.

## mask.mp4 packing notes (per-frame path)

- 1 object → true grayscale (`R=G=B=mask`, luma-only) so h264 4:2:0 keeps edges crisp.
- 2–3 objects → R/G/B channels. h264 4:2:0 chroma subsampling softens the G/B mask edges — acceptable
  for a lossy fallback; upgrade to a 4:4:4 or alpha-capable container if precision matters.
- 4 objects → h264/mp4 has no alpha channel; only 3 are packed (logged). Use ≤3 objects for video,
  or run image seg per keyframe.

## Video-mask render animation (separate from tracking)

Video masks (`mask.mp4`) and video beat assets currently render FROZEN at frame 0
in the deterministic capture: the region-shader / bgTextures video path uses a
`<video>` element seek, which does not advance under headless capture (same reason
kino pre-extracts footage frames node-side). Verified 2026-07-24: a moving-ellipse
mask.mp4 rendered identical splits at t=0 and t=1.5, while plain footage of the same
clip animated correctly.

Fix: route video mask + video asset textures through the existing footage frame
pipeline — `src/render/native/videoFrames.ts` extraction → `/vframes/<dir>/<N>` →
the current-frame `<img>` (as `FrameVideo` does) drawn into the GL texture each
composition frame — instead of a `<video>` seek. Infra already exists; it is a
wiring task in `RegionShader.tsx` (headline) and the bgTextures video channel.

### UPDATE 2026-07-24: region-shader video FIXED

Region-shader video masks + video assets now animate — routed through the
`/vframes` node-side frame pipeline (commit b49315e). Verified: moving-ellipse
mask renders the split at different x-positions at t=0 vs t=1.5.

REMAINING: the generic `backgroundTextures` `{kind:"video"}` channel
(`bgTextures.ts`) still uses the frozen `<video>`-seek (page-global scope, not
trivially routable through per-beat /vframes). Apply the same /vframes routing
there. Lower priority — region shaders are the primary video-mask surface.
