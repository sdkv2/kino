#!/usr/bin/env python3
"""SAM3.1 REAL video tracking building blocks (CoreML tracker + MLX/CoreML/PyTorch backbone).

Self-contained port of the VERIFIED spike (scratchpad/sam3-coreml/tracking_pipeline.py
+ common.py) into committed scripts/ — the runtime must NOT depend on the gitignored
scratchpad. scripts/sam_runner.py owns the I/O (ffmpeg decode, frame-0 text->mask via
the CoreML image seg, mask.mp4 encode); this module owns the ML:

    frame RGB  --MLX (preferred) / CoreML / PyTorch--> vis72/hires0/hires1
    frame 0    --PyTorch track_step(mask-prompt init)--------------------> cond_mem/cond_img/cond_ptr
    frames 1+  --CoreML dense_sam3_trackstep.mlpackage (stateful)--------> per-object mask logits

The frame-0 mask prompt is produced upstream (sam_runner's text->mask on frame 0) and
fed here as mask_inputs, exactly as tracking_pipeline.py did with its synthetic disc mask.

Speed: ~1.9s/frame with CoreML backbone + backbone_every=2 (default). MLX preferred when
KINO_SAM_MLX_PYTHON (or in-process mlx) is available — feeds the same CoreML tracker.
Release PyTorch post-init. PyTorch CPU fallback ~7–8s. Export:
scripts/export_sam_backbone_coreml.py. KINO_SAM_BACKBONE_EVERY=1 for max accuracy.
KINO_SAM_BACKBONE_ENGINE=auto|mlx|coreml|pytorch (default auto).

Requires the same venv as the image path PLUS the `sam3` package importable and the
multiplex checkpoint (sam3.1_multiplex.pt: backbone + tracker weights). CoreML packages
resolved from ~/.kino/sam/models (KINO_SAM_TRACKER / KINO_SAM_BACKBONE overrides).
MLX: separate python via KINO_SAM_MLX_PYTHON (mlx-vlm==0.4.3 + mlx-community/sam3.1-bf16).
"""
import glob
import os
import sys
import time

import numpy as np
import torch

# --- CPU-run workarounds: sam3 hardcodes .cuda()/.pin_memory() in eval paths (common.py) ---
torch.Tensor.cuda = lambda self, *a, **kw: self
torch.Tensor.pin_memory = lambda self, *a, **kw: self

E = 72            # sam_image_embedding_size (72x72 tracker grid)
IMG = 1008        # model internal resolution
MULTIPLEX_COUNT = 16  # released SAM3.1 multiplex slot count

SAM31_HF_REPO = os.environ.get("SAM3_HF_REPO", "AEmotionStudio/sam3.1")
SAM31_CKPT_NAME = os.environ.get("SAM3_CKPT_NAME", "sam3.1_multiplex.pt")


def log(*a):
    print("[sam_track]", *a, file=sys.stderr, flush=True)


def backbone_engine() -> str:
    """auto|mlx|coreml|pytorch — which per-frame vision path to use."""
    v = (os.environ.get("KINO_SAM_BACKBONE_ENGINE") or "auto").strip().lower()
    return v if v in ("auto", "mlx", "coreml", "pytorch") else "auto"


def _stub_triton():
    """sam3.model_builder does a bare `import triton` for CUDA-only kernels the eval
    path never runs; no triton wheel exists on Mac. Register a no-op shim so imports
    don't die. (Mirrors sam_runner_cuda._stub_triton — robust to dunder probes.)"""
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


def resolve_checkpoint():
    """Local path to sam3.1_multiplex.pt (HF download if needed; shared with the image path)."""
    p = os.environ.get("KINO_SAM_CHECKPOINT") or os.environ.get("SAM3_CHECKPOINT")
    if p:
        if not os.path.exists(p):
            raise FileNotFoundError(f"KINO_SAM_CHECKPOINT set but not found: {p}")
        return p
    from huggingface_hub import hf_hub_download

    log(f"resolving checkpoint {SAM31_CKPT_NAME} from {SAM31_HF_REPO} (cached after first run)")
    return hf_hub_download(repo_id=SAM31_HF_REPO, filename=SAM31_CKPT_NAME)


BACKBONE_PKG = "sam3_vision_backbone.mlpackage"


def backbone_every() -> int:
    """How often to re-run the vision backbone during tracking.

    Default 2 (MLX-style): reuse last vis72/hires0/hires1 for one frame between
    encodes. Measured on the moving-disc fixture: every=1 → ~2.9s/frame;
    every=2 → ~1.9s/frame with identical centroid travel. every=5 still PASSes
    the >100px travel gate but travel drops (175 vs 210). Set
    KINO_SAM_BACKBONE_EVERY=1 for per-frame encode (max accuracy).
    """
    try:
        n = int(os.environ.get("KINO_SAM_BACKBONE_EVERY", "2"))
    except ValueError:
        n = 2
    return max(1, n)


def tracker_package(models_dir):
    """CoreML tracker mlpackage path. KINO_SAM_TRACKER override, else under models_dir
    (ensureSamEnv downloads it to models_dir/models/dense_sam3_trackstep.mlpackage)."""
    env = os.environ.get("KINO_SAM_TRACKER")
    if env and os.path.exists(env):
        return env
    for cand in (
        os.path.join(models_dir, "dense_sam3_trackstep.mlpackage"),
        os.path.join(models_dir, "models", "dense_sam3_trackstep.mlpackage"),
    ):
        if os.path.exists(cand):
            return cand
    hits = [h for h in glob.glob(os.path.join(models_dir, "**", "dense_sam3_trackstep*.mlpackage"),
                                 recursive=True) if "_fp32" not in h]
    if hits:
        return hits[0]
    raise FileNotFoundError(
        f"CoreML tracker package (dense_sam3_trackstep.mlpackage) not found under {models_dir} — "
        "run `kino segment` once to auto-download from HF sdkv2/sam3.1-coreml-tracker-spike, "
        "or set KINO_SAM_TRACKER"
    )


def backbone_package(models_dir):
    """CoreML vision-backbone mlpackage path, or None if absent (MLX/PyTorch fallback).

    KINO_SAM_BACKBONE override, else models_dir[/models]/sam3_vision_backbone.mlpackage.
    Auto-downloaded by ensureSamEnv from sdkv2/sam3.1-coreml-vision-backbone.
    """
    env = os.environ.get("KINO_SAM_BACKBONE")
    if env:
        return env if os.path.exists(env) else None
    for cand in (
        os.path.join(models_dir, BACKBONE_PKG),
        os.path.join(models_dir, "models", BACKBONE_PKG),
    ):
        if os.path.exists(cand):
            return cand
    return None


def load_mlx_backbone():
    """Start MLX backbone worker if engine allows and MLX python is available."""
    eng = backbone_engine()
    if eng in ("coreml", "pytorch"):
        return None
    try:
        import sam_mlx_backbone
    except ImportError:
        log("sam_mlx_backbone import failed — skip MLX")
        return None
    worker = sam_mlx_backbone.try_load_worker()
    if worker is None and eng == "mlx":
        raise RuntimeError(
            "KINO_SAM_BACKBONE_ENGINE=mlx but no usable MLX python — set KINO_SAM_MLX_PYTHON "
            "to a venv with mlx + mlx-vlm==0.4.3"
        )
    return worker


# ---------------------------------------------------------------- model build
def _patch_cpu_fused_mlp():
    """sam3.perflib.fused.addmm_act hardcodes bf16 (CUDA AMP path); on CPU the following
    fp32 fc2 then dtype-mismatches. Replace with plain fp32 eager (spike CPU fix #2)."""
    import sam3.model.vitdet as vitdet

    def addmm_act_fp32(activation, linear, x):
        act = activation() if isinstance(activation, type) else activation
        return act(linear(x))

    vitdet.addmm_act = addmm_act_fp32


def _tracker_state_dict(ckpt):
    if isinstance(ckpt, dict) and "model" in ckpt and isinstance(ckpt["model"], dict):
        ckpt = ckpt["model"]
    if any(k.startswith("tracker.model.") for k in ckpt):
        return {k[len("tracker.model."):]: v for k, v in ckpt.items()
                if k.startswith("tracker.model.")}
    return ckpt


def build_model_with_backbone():
    """Multiplex video tracker (tracker.model.* weights) with the REAL vision backbone
    re-attached from detector.backbone.vision_backbone.* of the same checkpoint.

    common.build_model() nulls model.backbone because tracker weights don't include it;
    the backbone lives under detector.* in the merged multiplex file (spike wall #1)."""
    _stub_triton()
    from sam3.model_builder import build_sam3_multiplex_video_model, _create_multiplex_tri_backbone
    from sam3.model.vl_combiner import TriHeadVisionOnly

    model = build_sam3_multiplex_video_model(
        checkpoint_path=None, load_from_HF=False, multiplex_count=MULTIPLEX_COUNT,
        use_fa3=False, use_rope_real=True,  # real rope: CoreML cannot represent complex tensors
        device="cpu", strict_state_dict_loading=False,
    )
    model.backbone = None
    ckpt_path = resolve_checkpoint()
    raw = torch.load(ckpt_path, map_location="cpu", weights_only=True)
    if isinstance(raw, dict) and "model" in raw:
        raw = raw["model"]
    sd = _tracker_state_dict(raw)
    missing, unexpected = model.load_state_dict(sd, strict=True)
    assert not missing and not unexpected, (missing[:5], unexpected[:5])
    log(f"loaded tracker weights: {len(sd)} tensors")

    _patch_cpu_fused_mlp()
    backbone = TriHeadVisionOnly(
        visual=_create_multiplex_tri_backbone(use_rope_real=True), n_features=256, scalp=0,
    )
    pref = "detector.backbone."
    bb_sd = {k[len(pref):]: v for k, v in raw.items()
             if k.startswith(pref + "vision_backbone.")}
    bb_missing, bb_unexpected = backbone.load_state_dict(bb_sd, strict=False)
    assert not bb_unexpected, f"unexpected backbone keys: {bb_unexpected[:5]}"
    real_missing = [k for k in bb_missing if ".position_encoding." not in k
                    and "rotary" not in k and "freqs" not in k]
    assert not real_missing, f"missing backbone weights: {real_missing[:5]}"
    log(f"backbone loaded: {len(bb_sd)} tensors "
        f"({sum(p.numel() for p in backbone.parameters())/1e6:.0f}M params)")
    backbone.eval().requires_grad_(False)
    model.backbone = backbone
    model.eval().requires_grad_(False)
    return model


def make_multiplex_state(model):
    return model.multiplex_controller.get_state(
        MULTIPLEX_COUNT, torch.device("cpu"), torch.float32, random=False)


# ---------------------------------------------------------------- features
def to_model_tensor(img_u8):
    """HxWx3 uint8 RGB -> (1,3,1008,1008) fp32 normalized to [-1,1]. img_u8 must be 1008px."""
    x = torch.from_numpy(np.array(img_u8, dtype=np.float32)).permute(2, 0, 1) / 255.0
    x = (x - 0.5) / 0.5
    return x.unsqueeze(0)


def encode_frame(model, img_t, need_interactive=False):
    from sam3.model.data_misc import NestedTensor

    bb_out = model.forward_image(
        NestedTensor(tensors=img_t, mask=None),
        need_interactive_out=need_interactive, need_propagation_out=True,
    )
    return model._prepare_backbone_features(bb_out)


def tracker_inputs(prop_feats):
    """propagation vision_feats -> (vis72, hires0, hires1) at the tracker's exact contract."""
    vf = prop_feats["vision_feats"]
    vis72 = vf[2].contiguous()                                     # (5184,1,256)
    hires0 = vf[0].permute(1, 2, 0).view(1, 32, 4 * E, 4 * E).contiguous()
    hires1 = vf[1].permute(1, 2, 0).view(1, 64, 2 * E, 2 * E).contiguous()
    assert vis72.shape == (E * E, 1, 256), vis72.shape
    return vis72, hires0, hires1


def load_backbone(models_dir):
    """Load CoreML vision backbone if present and engine allows. Returns MLModel or None.

    Default ComputeUnit.CPU_AND_GPU. Isolated ~2.7s/frame; co-resident with the PyTorch
    467M backbone was ~6.7s — callers must release PyTorch after frame-0 init. Opt in to
    ALL via KINO_SAM_BACKBONE_COMPUTE (ANE can hang on first load). Falls back to
    KINO_SAM_COMPUTE, then CPU_AND_GPU. Tracker keeps its own KINO_SAM_COMPUTE default.
    Skipped when engine is mlx/pytorch, or when MLX already selected under auto.
    """
    eng = backbone_engine()
    if eng in ("mlx", "pytorch"):
        return None
    import coremltools as ct

    path = backbone_package(models_dir)
    if not path:
        log(f"CoreML backbone absent under {models_dir} — per-frame features use PyTorch CPU")
        return None
    cu = (os.environ.get("KINO_SAM_BACKBONE_COMPUTE")
          or os.environ.get("KINO_SAM_COMPUTE")
          or "CPU_AND_GPU")
    unit = getattr(ct.ComputeUnit, cu, ct.ComputeUnit.CPU_AND_GPU)
    log(f"loading CoreML backbone {os.path.basename(path)} (compute_units={unit.name})")
    return ct.models.MLModel(path, compute_units=unit)


def encode_frame_features(model, img_t, coreml_backbone=None, mlx_backbone=None):
    """Per-frame (vis72, hires0, hires1) for the tracker.

    Preference when callers pass both: mlx_backbone > coreml_backbone > PyTorch model.
    Returns (vis72, hires0, hires1, elapsed_s). Frame-0 interactive init still needs
    encode_frame(..., need_interactive=True) on PyTorch — this is the per-frame path only.
    When an accelerated backbone is set, `model` may be None (PyTorch already released).
    """
    t0 = time.time()
    if mlx_backbone is not None:
        return mlx_backbone.encode(img_t.numpy() if hasattr(img_t, "numpy") else img_t)
    if coreml_backbone is not None:
        feed = {"image": img_t.numpy().astype(np.float32)}
        got = coreml_backbone.predict(feed)
        by_shape = {tuple(np.asarray(v).shape): np.asarray(v, dtype=np.float32)
                    for v in got.values()}
        named = {k: np.asarray(v, dtype=np.float32) for k, v in got.items()}

        def pick(name, shape):
            if name in named and tuple(named[name].shape) == shape:
                return named[name]
            return by_shape[shape]

        vis72 = torch.from_numpy(pick("vis72", (E * E, 1, 256)))
        hires0 = torch.from_numpy(pick("hires0", (1, 32, 4 * E, 4 * E)))
        hires1 = torch.from_numpy(pick("hires1", (1, 64, 2 * E, 2 * E)))
        return vis72, hires0, hires1, time.time() - t0
    if model is None:
        raise RuntimeError("encode_frame_features: no accelerated backbone and model is None")
    prop = encode_frame(model, img_t)["sam2_backbone_out"]
    vis72, hires0, hires1 = tracker_inputs(prop)
    return vis72, hires0, hires1, time.time() - t0


def release_pytorch_after_init(model):
    """Drop the 467M PyTorch vision backbone after frame-0 init.

    Holding it alongside the CoreML/MLX backbone contended for Metal/RAM and inflated
    per-frame CoreML time from ~2.7s (isolated) to ~6.7s (co-resident). Call only
    when an accelerated backbone will handle frames 1+.
    """
    import gc

    if model is None:
        return
    model.backbone = None
    # Drop heavy decoder weights we won't call again on the CoreML path.
    for attr in ("sam_mask_decoder", "interactive_sam_mask_decoder",
                 "memory_attention", "maskmem_backbone", "transformer"):
        if hasattr(model, attr):
            try:
                setattr(model, attr, None)
            except Exception:
                pass
    gc.collect()
    log("released PyTorch vision backbone (+ unused heads) after frame-0 init")


def warm_backbone(coreml_backbone=None, img_t=None, mlx_backbone=None):
    """One throwaway predict so first real frame isn't paying compile/load cost."""
    if mlx_backbone is not None:
        mlx_backbone.warm()
        return
    if coreml_backbone is None:
        return
    if img_t is None:
        img_t = torch.zeros(1, 3, IMG, IMG)
    t0 = time.time()
    encode_frame_features(None, img_t, coreml_backbone=coreml_backbone)
    log(f"CoreML backbone warm predict in {time.time()-t0:.2f}s")


# ---------------------------------------------------------------- frame-0 init
def frame0_init(model, ms, feats0, prop0, mask_inputs, num_frames):
    """PyTorch track_step mask-prompt init -> (cond_mem, cond_img, cond_ptr) constants.

    mask_inputs: (MULTIPLEX_COUNT,1,IMG,IMG) with object i's initial mask in slot i."""
    output_dict = {"cond_frame_outputs": {}, "non_cond_frame_outputs": {}}
    with torch.no_grad():
        out0 = model.track_step(
            frame_idx=0, is_init_cond_frame=True,
            backbone_features_interactive=feats0["interactive"],
            backbone_features_propagation=prop0,
            image=None, point_inputs=None, mask_inputs=mask_inputs, gt_masks=None,
            frames_to_add_correction_pt=[], output_dict=output_dict,
            num_frames=num_frames, multiplex_state=ms,
        )
    cond_mem = out0["maskmem_features"].float().contiguous()
    cond_img = out0["image_features"].float().contiguous()
    cond_ptr = out0["obj_ptr"]
    if cond_ptr.dim() == 2:  # (OBJ,C) data space -> muxed (1,OBJ,C)
        cond_ptr = ms.mux(cond_ptr)
    cond_ptr = cond_ptr.float().contiguous()
    assert cond_mem.shape == (1, 256, E, E), cond_mem.shape
    assert cond_img.shape == (E * E, 1, 256), cond_img.shape
    assert cond_ptr.shape == (1, MULTIPLEX_COUNT, 256), cond_ptr.shape
    return cond_mem, cond_img, cond_ptr


# ---------------------------------------------------------------- CoreML tracker
def load_tracker(models_dir):
    """(mlmodel, input_names, state) for the stateful CoreML tracker."""
    import coremltools as ct

    cu = os.environ.get("KINO_SAM_COMPUTE", "CPU_AND_GPU")
    unit = getattr(ct.ComputeUnit, cu, ct.ComputeUnit.CPU_AND_GPU)
    path = tracker_package(models_dir)
    log(f"loading tracker {os.path.basename(path)} (compute_units={unit.name})")
    mlmodel = ct.models.MLModel(path, compute_units=unit)
    in_names = [i.name for i in mlmodel.input_description._fd_spec]
    return mlmodel, in_names, mlmodel.make_state()


def tracker_step(mlmodel, in_names, state, vis72, hires0, hires1,
                 cond_mem, cond_img, cond_ptr, frame_pos):
    """One stateful propagation predict. Returns (high_logits[16,1,1008,1008], scores[16,1])."""
    fi = (vis72, hires0, hires1, cond_mem, cond_img, cond_ptr,
          torch.tensor([float(frame_pos)]))
    feed = {n: v.numpy().astype(np.float32) for n, v in zip(in_names, fi)}
    got = mlmodel.predict(feed, state=state)
    by_shape = {tuple(np.asarray(v).shape): np.asarray(v) for v in got.values()}
    return by_shape[(MULTIPLEX_COUNT, 1, IMG, IMG)], by_shape[(MULTIPLEX_COUNT, 1)]
