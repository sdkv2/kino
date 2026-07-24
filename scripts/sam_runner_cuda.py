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
         -> handle_request(add_prompt on the first frame that detects, see
         seed_prompt) -> handle_stream_request(propagate_in_video, both
         directions) -> per-frame per-object masks keyed by a STABLE
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


def _use_fa3(device: str) -> bool:
    """FlashAttention-3 needs the `flash_attn_interface` package AND Hopper-class silicon
    (fp8 tensor cores, compute capability 9.0+ — H100/H200). Every consumer/prosumer card
    (Turing/Ampere/Ada: 2080 Ti, 3060/3080/3090, 4070/4090, ...) is below that, and sam3's
    fa3 module has no capability check of its own — it imports flash_attn_interface
    unconditionally and crashes with ModuleNotFoundError on anything less than Hopper (that
    package isn't even installable there). Auto-detect instead of hardcoding True; override
    with KINO_SAM_FA3=1/0 if you know better than the capability check.

    Capability alone is not enough: Blackwell (sm_120) reports major=12 but does not ship
    flash_attn_interface either, so we check the package actually imports rather than
    inferring it from "new enough GPU"."""
    override = os.environ.get("KINO_SAM_FA3")
    if override is not None:
        return override == "1"
    if device != "cuda":
        return False
    import importlib.util

    import torch

    major, _ = torch.cuda.get_device_capability()
    return major >= 9 and importlib.util.find_spec("flash_attn_interface") is not None


def _amp_dtype(device: str):
    """bf16 everywhere except pre-Ampere CUDA, where it must be fp16.

    SAM3 hardcodes bf16 autocast throughout ("use bfloat16 inference for Flash Attention
    kernel") — an Ampere assumption. On Turing/Volta (sm_75 and below) PyTorch's
    memory-efficient SDPA kernel rejects bf16 outright ("Expected query, key and value to
    all be of dtype: {Half, Float}"), and flash needs sm_80, so EVERY attention call falls
    back to the math kernel, which materializes the full [B,heads,N,N] score matrix. On a
    2080 Ti that is fatal: one global-attention call in the ViT trunk at B=8 frames asks for
    12.81 GiB (6.4 GiB of bf16 scores, doubled by the fp32 softmax upcast) against 11 GiB of
    board. fp16 re-enables the mem-efficient kernel, which never materializes the matrix —
    measured on this box at the exact OOMing shape [8,16,5184,64]: bf16 OOM at 12.81 GiB vs
    fp16 0.08 GiB peak, and it stays linear in frame count instead of quadratic in tokens.

    Ampere+ keeps bf16 (wider exponent range, and its kernels support it natively).
    Override with KINO_SAM_DTYPE=fp16|bf16."""
    import torch

    override = os.environ.get("KINO_SAM_DTYPE")
    if override:
        return {"fp16": torch.float16, "bf16": torch.bfloat16}[override]
    if device == "cuda" and torch.cuda.get_device_capability()[0] < 8:
        return torch.float16
    return torch.bfloat16


def apply_pre_ampere_workarounds(target, device):
    """Undo sam3's two hardcoded "this GPU is an Ampere with flash-attn" assumptions.

    Must run BEFORE `import sam3` — both patches target names sam3 binds at import time
    (`@torch.autocast(...)` decorators construct their context object when the class body is
    evaluated, and `from torch.nn.attention import sdpa_kernel` copies the function into
    sam3's module namespace). Patching after the import is too late for either.

      1. dtype   — every bf16 autocast becomes `target` (see _amp_dtype).
      2. backend — decoder.py wraps its attention in `sdpa_kernel(SDPBackend.FLASH_ATTENTION)`,
                   an *exclusive* request. Flash needs sm_80, so on Turing that raises
                   "RuntimeError: No available kernel. Aborting execution." rather than
                   falling back. Rewrite flash requests to prefer the mem-efficient kernel,
                   with math last so a request can never come up empty."""
    import torch

    # Both patches are pre-Ampere fixups; Ampere+ has real flash-attn and native bf16.
    if device != "cuda" or torch.cuda.get_device_capability()[0] >= 8:
        return

    import torch.nn.attention as tna

    import functools

    _orig_kernel = tna.sdpa_kernel

    # torch's sdpa_kernel is a @contextlib.contextmanager; keep the wrapper's metadata
    # (notably __wrapped__, which torch's contextlib plumbing reads) or the import blows up.
    @functools.wraps(_orig_kernel)
    def sdpa_kernel(backends, *a, **k):
        bs = list(backends) if isinstance(backends, (list, tuple)) else [backends]
        if tna.SDPBackend.FLASH_ATTENTION in bs:
            bs = [b for b in bs if b is not tna.SDPBackend.FLASH_ATTENTION]
            # mem-efficient first (never materializes the score matrix), math as backstop.
            for b in (tna.SDPBackend.EFFICIENT_ATTENTION, tna.SDPBackend.MATH):
                if b not in bs:
                    bs.append(b)
        return _orig_kernel(bs, *a, **k)

    tna.sdpa_kernel = sdpa_kernel

    orig = torch.amp.autocast_mode.autocast.__init__

    # Param must literally be named `dtype` — sam3 passes it as a keyword.
    def patched(self, device_type, dtype=None, *a, **k):
        if device_type == "cuda" and dtype is torch.bfloat16:
            dtype = target
        return orig(self, device_type, dtype, *a, **k)

    torch.amp.autocast_mode.autocast.__init__ = patched
    # sam3 also hard-casts a few tensors (maskmem_features, backbone_fpn) to bf16 outside any
    # autocast; those flow straight into SDPA and would drag it back to the math kernel.
    orig_to = torch.Tensor.to

    def to(self, *a, **k):
        a = tuple(target if x is torch.bfloat16 else x for x in a)
        if k.get("dtype") is torch.bfloat16:
            k["dtype"] = target
        return orig_to(self, *a, **k)

    torch.Tensor.to = to


def _tight_vram(device: str) -> bool:
    """True on boards where SAM3's defaults don't fit. The weights alone are 3.25 GiB
    resident, so an 11 GiB card has ~6.5 GiB for everything else."""
    import torch

    if device != "cuda":
        return False
    return torch.cuda.get_device_properties(0).total_memory / 2**30 < 16


def _tune_vram(model, device: str):
    """Shrink the detector's frame-batch to fit small boards.

    The video path re-runs the grounding detector over a *chunk* of frames at a time
    (`batched_grounding_batch_size`, sam3 default 16) purely for throughput — every frame in
    the chunk is encoded and mask-decoded simultaneously, so peak transient memory scales
    straight with it. The weights alone are 3.25 GiB resident, which on an 11 GiB board
    leaves ~6.5 GiB for transients: a 16-frame chunk blows that in the maskformer pixel
    embedding. Chunk size does not affect the masks, only how many frames share one pass.

    Scaled off total VRAM rather than hardcoded, since the same runner serves 11 GiB 2080 Tis
    and 80 GiB H100s. Override with KINO_SAM_GROUNDING_BATCH."""
    import torch

    override = os.environ.get("KINO_SAM_GROUNDING_BATCH")
    if override:
        n = int(override)
    elif device != "cuda":
        return
    else:
        gib = torch.cuda.get_device_properties(0).total_memory / 2**30
        # ponytail: coarse 3-step ladder off measured headroom, not a per-GPU table.
        # Raise KINO_SAM_GROUNDING_BATCH if you have room; lower it if you still OOM.
        n = 1 if gib < 16 else (4 if gib < 32 else 16)
    n = max(1, n)
    if n != getattr(model, "batched_grounding_batch_size", n):
        log(f"grounding batch {model.batched_grounding_batch_size} -> {n} (VRAM fit)")
    model.batched_grounding_batch_size = n

    tracker = getattr(model, "tracker", None)
    if not _tight_vram(device) or tracker is None:
        return
    # Park the tracker's per-frame state on the host. The tracker retains every past frame's
    # results so it can attend back over them — measured per frame at 1080x1920 with 3
    # objects: ~2 MiB of full-res bool masks, ~2.5 MiB of memory-bank features, ~0.8 MiB of
    # maskmem. That is ~16 MB/frame of pure retention, which is what makes peak VRAM climb
    # with clip length rather than with per-frame cost. sam3 routes all three through
    # inference_state["storage_device"], and its init_state takes an offload_state_to_cpu
    # flag that flips that to CPU — but every call site inside the multiplex model omits it,
    # so it can only be reached by wrapping the tracker's init_state here.
    #
    # It is a device move only; masks are bit-identical. sam3's own note: "saves the GPU
    # memory at the cost of a lower tracking fps".
    #
    # Deliberately NOT touching trim_past_non_cond_mem_for_eval, the other memory knob: that
    # one *discards* past non-conditioning outputs and asserts only frame 0 is ever prompted,
    # which seed_prompt + both-direction propagation break.
    _orig_ts = tracker.init_state

    def _init_state(*a, **k):
        k.setdefault("offload_state_to_cpu", True)
        return _orig_ts(*a, **k)

    tracker.init_state = _init_state

    # Nobody upstream turns that flag on for the multiplex model, so its masklet-reconditioning
    # path was never run against host-side state and assumes both sides are already colocated:
    #   video_tracking_multiplex._merge:  d1[k1][d2_idx] = d2[k2].to(dtype=d1[k1].dtype)
    # d1 is the stored state (now CPU), d2 a fresh GPU output — it matches dtype but not
    # device, so the assignment raises "Expected all tensors to be on the same device". Same
    # cast, with the device carried across too.
    import sam3.model.video_tracking_multiplex as vtm

    def _merge(d1, d2, k1, k2, d2_idx, strict=True):
        if k1 not in d1:
            assert not strict, f"{k1} not found"
            return
        d1[k1][d2_idx] = d2[k2].to(dtype=d1[k1].dtype, device=d1[k1].device)

    vtm._merge = _merge
    log("tracker state offloaded to host (VRAM fit)")


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


def frame_count(path, fps):
    """Frame count from the container, else duration x fps. Rough is fine — it only sets
    the spread of seed probes, never anything written to the mask."""
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=nb_frames:format=duration", "-of", "json", path],
        capture_output=True, text=True,
    )
    try:
        j = json.loads(out.stdout)
        n = int(j["streams"][0].get("nb_frames") or 0)
        if n > 0:
            return n
        return max(1, int(float(j["format"]["duration"]) * fps))
    except Exception:
        return 1


# How many frames to try seeding on before giving up. Each is one detector pass (~0.4s).
SEED_PROBES = 12


def seed_prompt(predictor, sid, prompt, nframes):
    """add_prompt on the first probed frame whose detector actually finds the object.

    SAM3's text detector runs on ONE frame — the seed — and the tracker propagates that
    identity across the clip. Frame 0 is not special, and seeding there blindly is a real
    failure mode: if the subject is absent, occluded, or merely under the confidence
    threshold at t=0, nothing is seeded, and the clip comes back empty except where the
    multiplex detector happens to re-fire on its own later. Measured on a 3s ocean clip
    ("the wave", a wave that has not broken yet at t=0): seeding at frame 0 detected 0
    objects and produced masks on 38/60 frames with nothing before frame 22; seeding at
    the first frame that detects (23) produces 60/60.

    Probes are spread across the clip rather than walking frame by frame — each one is a
    detector pass, and a probe that finds nothing adds nothing to the session, so
    re-seeding on the same session is safe and needs no reset. Returns the seed frame
    index, or None if nothing was detected anywhere probed."""
    step = max(1, (nframes - 1) // SEED_PROBES) if nframes > 1 else 1
    probes = list(range(0, nframes, step))
    # range() lands short of the end whenever step does not divide the clip evenly (60 frames
    # at step 4 stops at 56), which would miss a subject that only appears in the last frames.
    if probes[-1] != nframes - 1:
        probes.append(nframes - 1)
    for f in probes:
        r = predictor.handle_request(
            dict(type="add_prompt", session_id=sid, frame_index=int(f), text=prompt)
        )
        ids = np.asarray(r.get("outputs", {}).get("out_obj_ids", [])).tolist()
        if ids:
            if f:
                log(f"seeded on frame {f} — the prompt matched nothing on earlier probes")
            return int(f)
    return None


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
    # SAM3 is a low-precision-AMP model (its fused vit MLP casts activations); inference must
    # run under autocast so the fp32 layers match. GPU=cuda, verify=cpu. See _amp_dtype for
    # why pre-Ampere CUDA uses fp16 rather than sam3's hardcoded bf16.
    with torch.autocast(device_type=args.device, dtype=args.amp_dtype):
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
        use_fa3=_use_fa3(args.device),
        async_loading_frames=False,
    )

    _tune_vram(predictor.model, args.device)

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

    # offload_video_to_cpu: init_state otherwise preloads EVERY decoded frame onto the GPU as
    # a normalized float tensor and holds it for the whole session — ~2.5 GiB for a 5s 30fps
    # clip at sam3's 1152px working size, growing linearly with clip length regardless of how
    # cheap the per-frame inference is. Staged back per frame instead; the extra host-to-device
    # copy is noise next to the encoder pass. Left off on big boards, where it is a pure
    # slowdown. (start_session forwards this straight into init_state.)
    resp = predictor.handle_request(dict(
        type="start_session",
        resource_path=args.input,
        offload_video_to_cpu=_tight_vram(args.device),
    ))
    sid = resp["session_id"]
    # AMP model — inference runs under autocast (GPU=cuda, verify=cpu). The predictor entered
    # a cuda-autocast at init (a no-op off-GPU); this nested one matches the device.
    outputs_per_frame = {}
    with torch.autocast(device_type=args.device, dtype=args.amp_dtype):
        seed = seed_prompt(predictor, sid, args.prompt, frame_count(args.input, fps))
        if seed is None:
            fail(f"no instances above confidence {CONF} for prompt {args.prompt!r} on any probed frame")
        # Propagate the seed frame's prompt through the whole clip; obj_id is STABLE across
        # frames (that IS the temporal track). "both", not "forward": when the seed is not
        # frame 0, everything before it is only reachable by propagating backward.
        for r in predictor.handle_stream_request(
            dict(type="propagate_in_video", session_id=sid, propagation_direction="both")
        ):
            out = r["outputs"]
            # Pull each frame's masks off the GPU as they stream. Retaining the raw outputs
            # (out_binary_masks are CUDA tensors) for the whole clip grows VRAM linearly with
            # frame count — ~25 MB/frame at 1080x1920 with 3 objects, which is what took a 5s
            # clip from 6.0 GiB to 9.2 GiB on an 11 GiB board. Converting here keeps the GPU
            # working set flat in clip length; only the encoder-side buffer grows.
            # ponytail: that buffer is now CPU uint8, ~6 MB/frame at 1080p — fine for the
            # short clips kino cuts, but a minute-plus source wants incremental PNG writes.
            outputs_per_frame[int(r["frame_index"])] = {
                "out_obj_ids": np.asarray(out["out_obj_ids"]).tolist(),
                "masks": [to_uint8_mask(m) for m in out["out_binary_masks"]],
            }
    if not outputs_per_frame:
        fail("propagate_in_video yielded no frames")

    frame_idxs = sorted(outputs_per_frame)
    # Choose which tracked objects get channels. Bidirectional propagation hands the SAME
    # physical object a different obj_id per direction — the forward pass from the seed frame
    # is one id, the backward pass covering everything before it is another — so "first-seen
    # in frame order" reliably picks the backward fragment (it owns frame 0) and throws the
    # longer forward track away. Measured on a 3s ocean clip: id 0 carried 103 frames, id 1
    # carried 29, first-seen chose id 1 and the mask was empty on 155 of 184 frames.
    #
    # Rank by how many frames each id actually carries a mask on, so a channel is spent on a
    # real track rather than whichever fragment happened to start first.
    span = {}
    for fi in frame_idxs:
        out = outputs_per_frame[fi]
        bm = out["masks"]
        for idx, oid in enumerate(out["out_obj_ids"]):
            if bm[idx].any():
                span[int(oid)] = span.get(int(oid), 0) + 1
    if not span:
        fail(f"no tracked objects for prompt {args.prompt!r}")
    ranked = sorted(span, key=lambda o: (-span[o], o))
    if vch == 1:
        # One grayscale channel was requested, so there is nothing to keep the direction-split
        # ids apart in — union every track into it, matching how the image path unions the
        # objects it keeps into a single mask.png.
        chan_ids = ranked
        log(f"union of {len(chan_ids)} track(s) -> gray: frames per id {[span[o] for o in ranked]}")
    else:
        chan_ids = ranked[:vch]
    id_to_chan = {oid: (0 if vch == 1 else i) for i, oid in enumerate(chan_ids)}
    log(f"tracking {len(chan_ids)} object(s) over {len(frame_idxs)} frames @ {fps:.3f}fps ({vw}x{vh})")

    with tempfile.TemporaryDirectory() as work:
        mdir = os.path.join(work, "masks")
        os.makedirs(mdir)
        for i, fi in enumerate(frame_idxs):
            out = outputs_per_frame[fi]
            ids = out["out_obj_ids"]
            bm = out["masks"]  # list of uint8 [H,W], already off the GPU
            rgb = np.zeros((vh, vw, 3), dtype=np.uint8)
            for idx, oid in enumerate(ids):
                if oid not in id_to_chan:
                    continue
                m = bm[idx]
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

    # Must precede the sam3 imports inside run_image/run_video (decorator-time autocast).
    args.amp_dtype = _amp_dtype(args.device)
    apply_pre_ampere_workarounds(args.amp_dtype, args.device)
    log(f"device={args.device} amp={str(args.amp_dtype).split('.')[-1]}")

    if args.video:
        run_video(args, n_want)
    else:
        run_image(args, n_want)


if __name__ == "__main__":
    main()
