#!/usr/bin/env python3
"""SAM3.1 native-PyTorch text-prompt segmentation — kino's CUDA mask engine.

Standalone CLI (invoked by src/segment/cuda.ts via a PyTorch/sam3 Python):

    python sam_runner_cuda.py --input <img>   --prompt "<text>" --out <dir> [--objects N] [--device cuda|cpu]
    python sam_runner_cuda.py --input <video> --prompt "<text>" --out <dir> [--objects N] --video [--device cuda|cpu]

Unlike the CoreML backend (scripts/sam_runner.py — per-frame image seg, no
tracker), this runs the FULL facebookresearch/sam3 model in PyTorch:

  IMAGE  build_sam3_image_model -> Sam3Processor.set_image / set_text_prompt
         -> state["masks"]/["scores"]  (kind:"image", tracked:false)
  VIDEO  build_sam3_multiplex_video_predictor -> handle_request(start_session)
         -> handle_request(add_prompt frame 0) -> handle_stream_request(
         propagate_in_video) -> per-frame per-object masks keyed by a STABLE
         obj_id  ==> REAL temporal tracking  (kind:"video", tracked:TRUE)

--device cuda (default, KINO_SAM_DEVICE) runs on an NVIDIA GPU. --device cpu
runs the identical code path on CPU (slow, for verification): it monkeypatches
the sam3 eval-path .cuda()/.pin_memory() hardcodes into no-ops and stubs the
CUDA-only `triton` import, mirroring scratchpad/sam3-coreml/common.py.

Checkpoint: KINO_SAM_CHECKPOINT / SAM3_CHECKPOINT if set, else hf_hub_download
from SAM3_HF_REPO (default AEmotionStudio/sam3.1 — the open mirror of the gated
facebook/sam3.1; same sam3.1_multiplex.pt weights, image + tracker in one file).
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

CONF = 0.5  # SAM3 default confidence threshold

FFMPEG = os.environ.get("KINO_FFMPEG", "ffmpeg")
FFPROBE = os.environ.get("KINO_FFPROBE", "ffprobe")

SAM3_HF_REPO = os.environ.get("SAM3_HF_REPO", "AEmotionStudio/sam3.1")
SAM3_CKPT_NAME = os.environ.get("SAM3_CKPT_NAME", "sam3.1_multiplex.pt")


def log(*a):
    print("[sam_runner_cuda]", *a, file=sys.stderr, flush=True)


def fail(msg):
    log("ERROR:", msg)
    sys.exit(2)


def _stub_triton():
    """sam3 does a bare `import triton` for CUDA-only kernels the eval path may
    skip; no triton wheel exists on Mac/CPU. Register a no-op shim so imports
    don't die. (Mirrors scratchpad/sam3-coreml/triton_stub + sam_runner._stub_triton.)"""
    import types

    if "triton" in sys.modules:
        return

    class _L:
        def __getattr__(self, k):
            return _L()

        def __call__(self, *a, **k):
            return _L()

        def __getitem__(self, k):
            return _L()

    def _modgetattr(name):
        # inspect/importlib probe dunders (__file__, __path__, __spec__); return
        # nothing for those so they fall back to the module's real (absent) attrs.
        if name.startswith("__") and name.endswith("__"):
            raise AttributeError(name)
        return _L()

    t = types.ModuleType("triton")
    t.__file__ = "<triton-stub>"
    t.jit = lambda fn=None, **kw: (fn if fn is not None else (lambda f: f))
    t.cdiv = lambda a, b: (a + b - 1) // b
    t.language = _L()
    t.__getattr__ = _modgetattr
    tl = types.ModuleType("triton.language")
    tl.__file__ = "<triton-stub>"
    tl.constexpr = _L()
    tl.__getattr__ = _modgetattr
    sys.modules["triton"] = t
    sys.modules["triton.language"] = tl


def apply_cpu_workarounds():
    """CPU-run shims for sam3's CUDA-hardcoded eval paths (extends common.py).
    Only applied when --device cpu; the CUDA path leaves torch untouched.

    sam3 hardcodes device="cuda" in a few places (model.cuda(), Tensor.cuda(),
    torch.arange(device="cuda") in the decoder's coord cache, .to("cuda")).
    On a CPU-only torch those raise "Torch not compiled with CUDA"; here we
    redirect every cuda reference to cpu so the identical logic runs."""
    import torch

    torch.Tensor.cuda = lambda self, *a, **kw: self
    torch.Tensor.pin_memory = lambda self, *a, **kw: self
    torch.nn.Module.cuda = lambda self, *a, **kw: self  # build_*_predictor does model.cuda()

    def _coerce(dev):
        # handles "cuda", "cuda:0", torch.device("cuda"), and device-like objects
        if dev is not None and str(dev).startswith("cuda"):
            return torch.device("cpu") if isinstance(dev, torch.device) else "cpu"
        return dev

    # Tensor factories that take an explicit device="cuda" at build time.
    for fname in ("arange", "zeros", "ones", "empty", "full", "tensor",
                  "randn", "rand", "linspace", "eye", "as_tensor"):
        orig = getattr(torch, fname)

        def wrap(orig):
            def f(*a, **k):
                if "device" in k:
                    k["device"] = _coerce(k["device"])
                return orig(*a, **k)
            return f

        setattr(torch, fname, wrap(orig))

    # sam3_multiplex_base.py has a module-level `torch.cuda.get_device_properties(0).major`
    # probe (not guarded by is_available) that raises on CPU-only torch; return a fake
    # capability-0 device so it takes the non-Ampere/non-flash path.
    class _FakeProps:
        major = 0
        minor = 0
        name = "cpu"
        total_memory = 0

    torch.cuda.get_device_properties = lambda *a, **k: _FakeProps()
    torch.cuda.get_device_capability = lambda *a, **k: (0, 0)
    torch.cuda.current_device = lambda *a, **k: 0

    # .to("cuda") / .to(device="cuda") on tensors and modules.
    for cls in (torch.Tensor, torch.nn.Module):
        orig_to = cls.to

        def wrap_to(orig_to):
            def f(self, *a, **k):
                a = tuple(_coerce(x) if isinstance(x, (str, torch.device)) else x for x in a)
                if "device" in k:
                    k["device"] = _coerce(k["device"])
                return orig_to(self, *a, **k)
            return f

        cls.to = wrap_to(orig_to)

    _stub_triton()


def resolve_checkpoint():
    p = os.environ.get("KINO_SAM_CHECKPOINT") or os.environ.get("SAM3_CHECKPOINT")
    if p:
        if not os.path.exists(p):
            fail(f"KINO_SAM_CHECKPOINT set but not found: {p}")
        return p
    try:
        from huggingface_hub import hf_hub_download
    except Exception as e:  # noqa: BLE001
        fail(
            f"cannot import huggingface_hub to fetch the checkpoint ({e}); "
            "pip install huggingface_hub or set KINO_SAM_CHECKPOINT"
        )
    log(f"resolving checkpoint {SAM3_CKPT_NAME} from {SAM3_HF_REPO} (cached after first run)")
    return hf_hub_download(repo_id=SAM3_HF_REPO, filename=SAM3_CKPT_NAME)


def probe_video(path):
    """(r_frame_rate_str, fps_float, width, height) from the first video stream."""
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=r_frame_rate,width,height", "-of", "json", path],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        fail(f"ffprobe failed on {path}: {out.stderr.strip()}")
    s = json.loads(out.stdout)["streams"][0]
    num, den = (s["r_frame_rate"].split("/") + ["1"])[:2]
    fps = float(num) / float(den) if float(den) else float(num)
    return s["r_frame_rate"], fps, int(s["width"]), int(s["height"])


def to_uint8_mask(m):
    """bool/float mask (numpy or torch, incl. bf16) -> uint8 {0,255} 2D."""
    if hasattr(m, "detach"):  # torch tensor (bf16 has no numpy dtype -> float first)
        m = m.detach().float().cpu().numpy()
    a = np.asarray(m)
    if a.dtype == bool:
        a = a.astype(np.uint8) * 255
    else:
        a = (a > 0.5).astype(np.uint8) * 255
    return np.squeeze(a)


def write_manifest(args, kind, w, h, chans, fps, frames, tracked):
    m = {
        "kind": kind,
        "source": args.input,
        "prompt": args.prompt,
        "width": int(w),
        "height": int(h),
        "objects": [
            {"id": i, "label": args.prompt, "channel": chans[i]} for i in range(len(chans))
        ],
        "backend": "cuda",
        "tracked": tracked,
    }
    if fps is not None:
        m["fps"] = fps
    if frames is not None:
        m["frames"] = frames
    with open(os.path.join(args.out, "manifest.json"), "w") as f:
        json.dump(m, f, indent=2)


def run_image(args, n_want):
    import torch  # noqa: F401  (import after workarounds applied)
    from sam3.model_builder import build_sam3_image_model
    from sam3.model.sam3_image_processor import Sam3Processor

    ckpt = resolve_checkpoint()
    log(f"building image model on {args.device}")
    model = build_sam3_image_model(
        device=args.device, load_from_HF=False, checkpoint_path=ckpt
    )
    processor = Sam3Processor(model, device=args.device, confidence_threshold=CONF)

    img = Image.open(args.input).convert("RGB")
    ow, oh = img.size
    # SAM3 is a bf16-AMP model (its fused vit MLP casts activations to bf16);
    # inference must run under autocast so the fp32 layers match. GPU=cuda, verify=cpu.
    with torch.autocast(device_type=args.device, dtype=torch.bfloat16):
        state = processor.set_image(img)
        state = processor.set_text_prompt(state=state, prompt=args.prompt)

    masks = state["masks"]  # bool [K,1,H,W] (already confidence-filtered)
    scores = state["scores"]  # [K]
    k = int(masks.shape[0]) if masks is not None else 0
    if k == 0:
        fail(f"no instances above confidence {CONF} for prompt {args.prompt!r}")
    # scores/masks may be bf16 (computed under autocast); bf16 has no numpy dtype -> .float() first.
    order = np.argsort(-scores.detach().float().cpu().numpy().astype(np.float32))
    keep = [int(i) for i in order[:n_want]]
    log(f"prompt={args.prompt!r} kept={len(keep)}/{k}")

    union = None
    for oid, qi in enumerate(keep):
        m = to_uint8_mask(masks[qi].detach().float().cpu().numpy())
        union = m if union is None else np.maximum(union, m)
        if len(keep) > 1:
            Image.fromarray(m).save(os.path.join(args.out, f"mask.{oid}.png"))
    Image.fromarray(union).save(os.path.join(args.out, "mask.png"))

    # image path packs the union into one grayscale mask.png (image masks are single-channel)
    write_manifest(args, "image", ow, oh, ["gray"] * len(keep), None, None, tracked=False)
    log("wrote", os.path.join(args.out, "mask.png"))


def run_video(args, n_want):
    import torch  # noqa: F401
    from sam3.model_builder import build_sam3_multiplex_video_predictor

    rfr, fps, vw, vh = probe_video(args.input)
    # ponytail: h264/yuv420p has no alpha and needs even dims. Mirror sam_runner.py:
    #   pack <=3 tracked objects into R/G/B (single -> grayscale luma, crisp); a 4th
    #   (alpha) object is not storable in mp4. Consumer already handles r/g/b video masks.
    vch = min(n_want, 3)
    if n_want > 3:
        log(f"objects={n_want}: mask.mp4 (h264) has no alpha — packing 3 tracked objects into R/G/B")

    ckpt = resolve_checkpoint()
    log(f"building multiplex video predictor on {args.device} (real tracking)")
    predictor = build_sam3_multiplex_video_predictor(
        checkpoint_path=ckpt,
        use_fa3=(args.device == "cuda"),  # FlashAttention-3 is CUDA-only
        async_loading_frames=False,
    )

    # sam3 API skew: Sam3BasePredictor.start_session always passes offload_state_to_cpu, but the
    # multiplex model.init_state signature doesn't accept it. Filter to the params it declares.
    import inspect

    _orig_init = predictor.model.init_state
    _params = inspect.signature(_orig_init).parameters
    if not any(p.kind == p.VAR_KEYWORD for p in _params.values()):
        _accepts = set(_params)

        def _init_state(*a, **k):
            return _orig_init(*a, **{kk: vv for kk, vv in k.items() if kk in _accepts})

        predictor.model.init_state = _init_state

    resp = predictor.handle_request(dict(type="start_session", resource_path=args.input))
    sid = resp["session_id"]
    # bf16-AMP model — inference runs under autocast (GPU=cuda, verify=cpu). The predictor
    # entered a cuda-autocast at init (a no-op off-GPU); this nested one matches the device.
    outputs_per_frame = {}
    with torch.autocast(device_type=args.device, dtype=torch.bfloat16):
        predictor.handle_request(
            dict(type="add_prompt", session_id=sid, frame_index=0, text=args.prompt)
        )
        # Propagate frame 0's prompt through the whole clip; obj_id is STABLE across
        # frames (that IS the temporal track).
        for r in predictor.handle_stream_request(
            dict(type="propagate_in_video", session_id=sid, propagation_direction="forward")
        ):
            outputs_per_frame[int(r["frame_index"])] = r["outputs"]
    if not outputs_per_frame:
        fail("propagate_in_video yielded no frames")

    frame_idxs = sorted(outputs_per_frame)
    # Choose which tracked objects get channels: deterministic, first-seen order.
    chan_ids = []
    for fi in frame_idxs:
        for oid in np.asarray(outputs_per_frame[fi]["out_obj_ids"]).tolist():
            if oid not in chan_ids:
                chan_ids.append(int(oid))
            if len(chan_ids) >= vch:
                break
        if len(chan_ids) >= vch:
            break
    if not chan_ids:
        fail(f"no tracked objects for prompt {args.prompt!r}")
    id_to_chan = {oid: i for i, oid in enumerate(chan_ids)}
    log(f"tracking {len(chan_ids)} object(s) over {len(frame_idxs)} frames @ {fps:.3f}fps ({vw}x{vh})")

    with tempfile.TemporaryDirectory() as work:
        mdir = os.path.join(work, "masks")
        os.makedirs(mdir)
        for i, fi in enumerate(frame_idxs):
            out = outputs_per_frame[fi]
            ids = np.asarray(out["out_obj_ids"]).tolist()
            bm = out["out_binary_masks"]  # [N,H,W]
            rgb = np.zeros((vh, vw, 3), dtype=np.uint8)
            for idx, oid in enumerate(ids):
                if oid not in id_to_chan:
                    continue
                m = to_uint8_mask(bm[idx])
                if m.shape != (vh, vw):
                    m = np.asarray(Image.fromarray(m).resize((vw, vh), Image.NEAREST))
                ch = id_to_chan[oid]
                if vch == 1:
                    rgb[..., 0] = rgb[..., 1] = rgb[..., 2] = np.maximum(rgb[..., 0], m)
                else:
                    rgb[..., ch] = np.maximum(rgb[..., ch], m)
            Image.fromarray(rgb).save(os.path.join(mdir, f"{i:06d}.png"))

        enc = subprocess.run(
            [FFMPEG, "-y", "-loglevel", "error", "-framerate", rfr,
             "-i", os.path.join(mdir, "%06d.png"),
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16",
             os.path.join(args.out, "mask.mp4")],
            capture_output=True, text=True,
        )
        if enc.returncode != 0:
            fail(f"ffmpeg encode failed: {enc.stderr.strip()}")

    chans = ["gray"] if vch == 1 else ["r", "g", "b"][:len(chan_ids)]
    write_manifest(args, "video", vw, vh, chans, fps, len(frame_idxs), tracked=True)
    log("wrote", os.path.join(args.out, "mask.mp4"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--objects", type=int, default=1)
    ap.add_argument("--video", action="store_true", help="treat --input as a video (real tracking)")
    ap.add_argument("--device", default=os.environ.get("KINO_SAM_DEVICE", "cuda"),
                    choices=["cuda", "cpu"])
    args = ap.parse_args()

    if not os.path.exists(args.input):
        fail(f"input not found: {args.input}")
    os.makedirs(args.out, exist_ok=True)
    n_want = max(1, min(4, args.objects))

    if args.device == "cpu":
        apply_cpu_workarounds()
    # CUDA path: leave torch/triton untouched — the GPU kernels need the real thing.

    if args.video:
        run_video(args, n_want)
    else:
        run_image(args, n_want)


if __name__ == "__main__":
    main()
