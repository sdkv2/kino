#!/usr/bin/env python3
"""Export SAM3.1 vision backbone (propagation path + conv_s0/s1) to CoreML.

Produces a STATELESS single-input mlpackage matching the tracker contract:

    image [1,3,1008,1008] fp32
      -> vis72 [5184,1,256], hires0 [1,32,288,288], hires1 [1,64,144,144]

This is exactly what scripts/sam_track.encode_frame + tracker_inputs emit for per-frame
propagation (was the ~7–8s PyTorch CPU bottleneck). Frame-0 init stays on PyTorch.

Usage (must use the sam3-coreml venv):
  scratchpad/sam3-coreml/.venv/bin/python scripts/export_sam_backbone_coreml.py
  scratchpad/sam3-coreml/.venv/bin/python scripts/export_sam_backbone_coreml.py --parity-only PATH
  scratchpad/sam3-coreml/.venv/bin/python scripts/export_sam_backbone_coreml.py --precision float32

Gotchas applied:
  - use_rope_real=True (CoreML cannot represent complex tensors)
  - addmm_act fp32 patch (via sam_track.build_model_with_backbone)
  - hide incomplete triton stub before torch.export
  - ep.run_decompositions({}) before ct.convert when export succeeds
  - ct.target.iOS18, compute_units CPU_AND_GPU at convert time
  - torch.export hits CoreML wall: "non-contiguous dim order" → fall back to torch.jit.trace
  - default fp16 package (~875MB): cosine≈0.99997 vs PyTorch, tracking sub-pixel;
    FLOAT32 (~1.7GB) for tighter numeric parity (rel≈7e-4) but little/no speedup
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import time

import numpy as np
import torch
import torch.nn as nn

_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

import sam_track  # noqa: E402

E = sam_track.E
IMG = sam_track.IMG
PKG_NAME = "sam3_vision_backbone.mlpackage"

SP_OUT = os.path.join(
    os.path.dirname(_SCRIPTS), "scratchpad", "sam3-coreml", PKG_NAME
)
HOME_OUT = os.path.join(os.path.expanduser("~"), ".kino", "sam", "models", PKG_NAME)


class PropagationEncoder(nn.Module):
    """Plain-tensor wrap of trunk + propagation FPN + sam_mask_decoder.conv_s0/s1.

    Avoids NestedTensor so torch.export / jit.trace stay happy. Position encodings are
    unused by the CoreML tracker contract (only vision_feats matter).
    """

    def __init__(self, trunk, propagation_convs, conv_s0, conv_s1):
        super().__init__()
        self.trunk = trunk
        self.propagation_convs = propagation_convs
        self.conv_s0 = conv_s0
        self.conv_s1 = conv_s1

    def forward(self, img: torch.Tensor):
        xs = self.trunk(img)
        x = xs[-1]
        x_data = x.tensors if hasattr(x, "tensors") else x
        outs = [conv(x_data) for conv in self.propagation_convs]
        hires0 = self.conv_s0(outs[0])  # (1,32,288,288)
        hires1 = self.conv_s1(outs[1])  # (1,64,144,144)
        vis72 = outs[2].flatten(2).permute(2, 0, 1).contiguous()  # (5184,1,256)
        return vis72, hires0, hires1


def hide_triton_stub():
    """Remove incomplete triton stub so torch.export's inductor import fails cleanly."""
    for stub in (
        os.path.join(os.path.dirname(_SCRIPTS), "scratchpad", "sam3-coreml", "triton_stub"),
    ):
        while stub in sys.path:
            sys.path.remove(stub)
    for k in list(sys.modules):
        if k == "triton" or k.startswith("triton."):
            del sys.modules[k]


def build_encoder(model=None):
    if model is None:
        model = sam_track.build_model_with_backbone()
    neck = model.backbone.vision_backbone
    enc = PropagationEncoder(
        trunk=neck.trunk,
        propagation_convs=neck.propagation_convs,
        conv_s0=model.sam_mask_decoder.conv_s0,
        conv_s1=model.sam_mask_decoder.conv_s1,
    )
    enc.eval().requires_grad_(False)
    return enc, model


def pytorch_ref(model, img_t):
    with torch.no_grad():
        prop = sam_track.encode_frame(model, img_t)["sam2_backbone_out"]
        return sam_track.tracker_inputs(prop)


def synth_image(seed=0):
    rng = np.random.RandomState(seed)
    bg = rng.randint(20, 60, (IMG, IMG, 3), dtype=np.uint8)
    yy, xx = np.mgrid[0:IMG, 0:IMG]
    m = (xx - 400) ** 2 + (yy - 500) ** 2 <= 90 ** 2
    bg[m] = (240, 200, 40)
    return bg


def rel_err(a, b):
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    denom = max(float(np.abs(b).max()), 1e-9)
    return float(np.abs(a - b).max()), float(np.abs(a - b).max() / denom)


def cosine(a, b):
    a = np.asarray(a, dtype=np.float64).ravel()
    b = np.asarray(b, dtype=np.float64).ravel()
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-12))


def verify_wrapper_vs_ref(enc, model, img_t):
    with torch.no_grad():
        w_vis, w_h0, w_h1 = enc(img_t)
    r_vis, r_h0, r_h1 = pytorch_ref(model, img_t)
    rows = []
    for name, w, r in (("vis72", w_vis, r_vis), ("hires0", w_h0, r_h0), ("hires1", w_h1, r_h1)):
        assert w.shape == r.shape, (name, w.shape, r.shape)
        mx, rel = rel_err(w.numpy(), r.numpy())
        rows.append((name, mx, rel))
        print(f"  wrapper vs encode_frame {name}: max={mx:.3e} rel={rel:.3e}")
    return rows


def export_torch(enc, img_t, frontend: str):
    sam_track.log(f"export frontend={frontend}")
    if frontend == "export":
        hide_triton_stub()
        t0 = time.time()
        with torch.no_grad():
            try:
                ep = torch.export.export(enc, (img_t,))
            except Exception as e:
                print(f"strict export failed ({type(e).__name__}: {e}); retrying strict=False")
                ep = torch.export.export(enc, (img_t,), strict=False)
            ep = ep.run_decompositions({})
        print(f"torch.export + decompositions OK in {time.time()-t0:.1f}s")
        return ep, "exported_program"
    if frontend == "trace":
        t0 = time.time()
        with torch.no_grad():
            traced = torch.jit.trace(enc, img_t, strict=False)
        print(f"torch.jit.trace OK in {time.time()-t0:.1f}s")
        return traced, "traced"
    raise ValueError(frontend)


def convert_coreml(artifact, kind, out_path, precision):
    import coremltools as ct

    t0 = time.time()
    kwargs = dict(
        inputs=[ct.TensorType(name="image", shape=(1, 3, IMG, IMG), dtype=np.float32)],
        outputs=[
            ct.TensorType(name="vis72"),
            ct.TensorType(name="hires0"),
            ct.TensorType(name="hires1"),
        ],
        minimum_deployment_target=ct.target.iOS18,
        compute_units=ct.ComputeUnit.CPU_AND_GPU,
    )
    if precision == "float32":
        kwargs["compute_precision"] = ct.precision.FLOAT32
    mlmodel = ct.convert(artifact, **kwargs)
    print(f"coremltools convert OK in {time.time()-t0:.1f}s "
          f"(kind={kind}, precision={precision})")
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    if os.path.exists(out_path):
        shutil.rmtree(out_path)
    mlmodel.save(out_path)
    print(f"saved {out_path}")
    return mlmodel


def load_coreml(path):
    import coremltools as ct

    cu = (os.environ.get("KINO_SAM_BACKBONE_COMPUTE")
          or os.environ.get("KINO_SAM_COMPUTE")
          or "ALL")
    unit = getattr(ct.ComputeUnit, cu, ct.ComputeUnit.ALL)
    return ct.models.MLModel(path, compute_units=unit)


def predict_coreml(mlmodel, img_t):
    feed = {"image": img_t.numpy().astype(np.float32)}
    got = mlmodel.predict(feed)
    by_shape = {tuple(np.asarray(v).shape): np.asarray(v, dtype=np.float32) for v in got.values()}
    named = {k: np.asarray(v, dtype=np.float32) for k, v in got.items()}

    def pick(name, shape):
        if name in named and named[name].shape == shape:
            return named[name]
        return by_shape[shape]

    return (
        pick("vis72", (E * E, 1, 256)),
        pick("hires0", (1, 32, 4 * E, 4 * E)),
        pick("hires1", (1, 64, 2 * E, 2 * E)),
    )


def parity_coreml_vs_ref(mlmodel, model, img_t):
    ref = pytorch_ref(model, img_t)
    t0 = time.time()
    cm = predict_coreml(mlmodel, img_t)
    dt = time.time() - t0
    print(f"CoreML backbone predict: {dt:.2f}s")
    rows = []
    for name, c, r in zip(("vis72", "hires0", "hires1"), cm, ref):
        mx, rel = rel_err(c, r.numpy())
        cos = cosine(c, r.numpy())
        rows.append((name, mx, rel, cos, c.shape))
        print(f"  CoreML vs PyTorch {name}: shape={c.shape} "
              f"max={mx:.3e} rel={rel:.3e} cosine={cos:.6f}")
    return rows, dt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=SP_OUT, help="primary .mlpackage output path")
    ap.add_argument("--no-home", action="store_true",
                    help=f"skip copy to {HOME_OUT}")
    ap.add_argument("--frontend", choices=("export", "trace", "auto"), default="auto")
    ap.add_argument("--precision", choices=("float16", "float32"), default="float16",
                    help="float16 (default, fast) or float32 (tighter parity, slower)")
    ap.add_argument("--parity-only", metavar="PATH",
                    help="skip export; just parity-check an existing mlpackage")
    ap.add_argument("--bench", type=int, default=3, help="timed CoreML predicts after export")
    args = ap.parse_args()

    sam_track.log("building PyTorch model + PropagationEncoder")
    t0 = time.time()
    enc, model = build_encoder()
    print(f"model+encoder ready in {time.time()-t0:.1f}s")

    img_u8 = synth_image()
    img_t = sam_track.to_model_tensor(img_u8)

    print("wrapper vs encode_frame (must be ~0 — same weights/path):")
    wrows = verify_wrapper_vs_ref(enc, model, img_t)
    if max(r[1] for r in wrows) > 1e-4:
        print("FAIL: wrapper diverges from encode_frame — abort before export")
        sys.exit(2)

    if args.parity_only:
        mlmodel = load_coreml(args.parity_only)
        rows, _ = parity_coreml_vs_ref(mlmodel, model, img_t)
        worst_rel = max(r[2] for r in rows)
        worst_cos = min(r[3] for r in rows)
        # fp16: cosine is the honest gate (rel can be ~6e-2); fp32: rel << 1e-3
        ok = worst_cos >= 0.999 or worst_rel < 5e-2
        print("PARITY:", "PASS" if ok else "FAIL",
              f"(worst rel={worst_rel:.3e}, min cosine={worst_cos:.6f})")
        sys.exit(0 if ok else 3)

    frontends = (["export", "trace"] if args.frontend == "auto" else [args.frontend])
    last_err = None
    mlmodel = None
    for fe in frontends:
        try:
            artifact, kind = export_torch(enc, img_t, fe)
            mlmodel = convert_coreml(artifact, kind, args.out, args.precision)
            break
        except Exception as e:
            last_err = e
            print(f"frontend {fe} FAILED: {type(e).__name__}: {e}")
            continue
    if mlmodel is None:
        print("EXPORT FAILED — leaving PyTorch pipeline untouched")
        raise SystemExit(f"all frontends failed; last error: {last_err}") from last_err

    if not args.no_home:
        os.makedirs(os.path.dirname(HOME_OUT), exist_ok=True)
        if os.path.exists(HOME_OUT):
            shutil.rmtree(HOME_OUT)
        shutil.copytree(args.out, HOME_OUT)
        print(f"also copied → {HOME_OUT}")

    print("\nCoreML vs PyTorch parity:")
    # re-load with ALL (runtime default) for the numbers that matter in prod
    mlmodel = load_coreml(args.out)
    rows, _ = parity_coreml_vs_ref(mlmodel, model, img_t)
    worst_rel = max(r[2] for r in rows)
    worst_cos = min(r[3] for r in rows)
    ok = worst_cos >= 0.999 or worst_rel < 5e-2
    print(f"worst rel={worst_rel:.3e}  min cosine={worst_cos:.6f}")
    if not ok:
        print("PARITY: FAIL — do not wire this package")
        sys.exit(3)
    print("PARITY: PASS")

    if args.bench > 0:
        times = []
        for i in range(args.bench):
            t0 = time.time()
            predict_coreml(mlmodel, img_t)
            times.append(time.time() - t0)
            print(f"  bench[{i}]: {times[-1]:.2f}s")
        print(f"CoreML backbone mean: {sum(times)/len(times):.2f}s "
              f"(vs PyTorch CPU ~7–8s)")


if __name__ == "__main__":
    main()
