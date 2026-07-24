#!/usr/bin/env python3
"""SAM3.1 CoreML text-prompt segmentation — kino's author-time mask engine.

Standalone CLI (invoked by src/segment/coreml.ts via a Mac Python):

    python sam_runner.py --input <img>   --prompt "<text>" --out <dir> [--objects N]
    python sam_runner.py --input <video> --prompt "<text>" --out <dir> [--objects N] --video

Loads the three AllanVester/SAM3.1-CoreML-FP16 mlpackages from ~/.kino/sam/models
(override: KINO_SAM_MODEL) and runs the full image pipeline:

    image  --ImageEncoder--> fpn feats (288/144/72) + vis_pos (72)
    prompt --tokenize------> token_ids[1,32] --TextEncoder--> text_features + text_mask
    Detector(feats, vis_pos, text_features, text_mask) --> boxes[200,4], scores[200], masks[200,288,288]

IMAGE (default): writes 8-bit grayscale mask.png (union of kept instances). When
--objects>1 and more than one instance is kept, also writes mask.<id>.png per
instance. manifest kind:"image", tracked:false.

VIDEO (--video): ffmpeg-decodes to frames at the source fps, runs the SAME
image pipeline on each frame INDEPENDENTLY (no temporal tracking — see the
tracker gap in .superpowers/sdd/coreml-io-reference.md), packs up to 3 objects
into R/G/B channels of a grayscale mask.mp4 (single object -> grayscale), and
writes manifest kind:"video", tracked:false. Per-frame means no temporal
coherence; fast motion can flicker.

Tensor names in these packages are auto-generated (x_495, var_2489, ...), so
inputs/outputs are matched by introspected SHAPE, never by assumed name — the
detector's own input names (fpn_feat0.., text_features, text_mask) are the only
human-stable ones and are used directly.
"""
import argparse
import glob
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image
import coremltools as ct

RES = 1008        # ImageEncoder input side
CTX = 32          # TextEncoder context length (token_ids[1,32])
CONF = 0.5        # SAM3 default confidence threshold

FFMPEG = os.environ.get("KINO_FFMPEG", "ffmpeg")
FFPROBE = os.environ.get("KINO_FFPROBE", "ffprobe")


def log(*a):
    print("[sam_runner]", *a, file=sys.stderr, flush=True)


def fail(msg):
    # Single-line structured error; coreml.ts surfaces stderr verbatim.
    log("ERROR:", msg)
    sys.exit(2)


def models_dir():
    d = os.environ.get("KINO_SAM_MODEL") or os.path.join(
        os.path.expanduser("~"), ".kino", "sam", "models"
    )
    return d


def find_package(d, stem):
    hits = glob.glob(os.path.join(d, f"{stem}*.mlpackage"))
    if not hits:
        fail(f"missing {stem}*.mlpackage in {d} — run `kino doctor` / re-download models")
    return hits[0]


def out_shape(spec_out):
    return tuple(spec_out.type.multiArrayType.shape)


def load(path):
    cu = os.environ.get("KINO_SAM_COMPUTE", "CPU_AND_GPU")
    unit = getattr(ct.ComputeUnit, cu, ct.ComputeUnit.CPU_AND_GPU)
    log(f"loading {os.path.basename(path)} (compute_units={unit.name})")
    return ct.models.MLModel(path, compute_units=unit)


def outputs_by_shape(model):
    """{shape_tuple: [names in spec order]} for a model's outputs."""
    m = {}
    for o in model.get_spec().description.output:
        m.setdefault(out_shape(o), []).append(o.name)
    return m


def _stub_triton():
    """sam3/model/edt.py does a bare `import triton` for a CUDA-only kernel the
    CoreML path never runs; no triton wheel exists on Mac. Register a no-op shim
    so importing the sam3 tokenizer doesn't die. (Mirrors scratchpad triton_stub.)"""
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

    t = types.ModuleType("triton")
    t.jit = lambda fn=None, **kw: (fn if fn is not None else (lambda f: f))
    t.cdiv = lambda a, b: (a + b - 1) // b
    t.language = _L()
    tl = types.ModuleType("triton.language")
    tl.constexpr = _L()
    tl.__getattr__ = lambda name: _L()
    sys.modules["triton"] = t
    sys.modules["triton.language"] = tl


def tokenizer():
    """The exact SAM3 CLIP-BPE tokenizer the TextEncoder was exported with.

    token_ids = [sot=49406] + bpe(lower(text)) + [eot=49407], zero-padded to 32.
    bpe vocab: KINO_SAM_BPE, else the assets file shipped with the sam3 package.
    """
    _stub_triton()
    try:
        from sam3.model.tokenizer_ve import SimpleTokenizer
        import sam3.model.tokenizer_ve as tv
    except Exception as e:  # noqa: BLE001
        fail(
            "sam3 package not importable for tokenization "
            f"({type(e).__name__}: {e}) — install `sam3` into the runner venv "
            "(the AllanVester models were exported with its CLIP-BPE tokenizer)"
        )
    bpe = os.environ.get("KINO_SAM_BPE")
    if not bpe or not os.path.exists(bpe):
        assets = os.path.join(os.path.dirname(os.path.dirname(tv.__file__)), "assets")
        bpe = os.path.join(assets, "bpe_simple_vocab_16e6.txt.gz")
    if not os.path.exists(bpe):
        fail(f"CLIP bpe vocab not found ({bpe}) — set KINO_SAM_BPE")
    return SimpleTokenizer(bpe_path=bpe)


def preprocess(path):
    """PIL RGB -> [1,3,1008,1008] fp16, normalized to [-1,1] (mean/std 0.5).

    Straight square resize (matches SAM3 v2.Resize(1008,1008)); masks are
    upsampled back to (orig_h, orig_w) so the squash round-trips.
    """
    img = Image.open(path).convert("RGB")
    ow, oh = img.size
    im = img.resize((RES, RES), Image.BILINEAR)
    a = np.asarray(im, dtype=np.float32) / 255.0
    a = (a - 0.5) / 0.5
    a = np.transpose(a, (2, 0, 1))[None].astype(np.float16)
    return a, ow, oh


def upsample_logit(mask288, ow, oh):
    """288x288 logit map -> (oh,ow) bilinear -> sigmoid -> uint8 {0,255}."""
    pil = Image.fromarray(np.asarray(mask288, dtype=np.float32))  # 2D float -> "F"
    up = np.asarray(pil.resize((ow, oh), Image.BILINEAR), dtype=np.float32)
    prob = 1.0 / (1.0 + np.exp(-up))
    return (prob > 0.5).astype(np.uint8) * 255


def load_models():
    d = models_dir()
    ie = load(find_package(d, "SAM3.1_ImageEncoder"))
    te = load(find_package(d, "SAM3.1_TextEncoder"))
    det = load(find_package(d, "SAM3.1_Detector"))
    return ie, te, det


def encode_text(te, prompt):
    """prompt -> (text_features[32,1,256], text_mask[1,32]). Same for every frame."""
    tok = tokenizer()
    token_ids = tok([prompt], context_length=CTX).cpu().numpy().astype(np.int32)
    te_out = te.predict({list(te.get_spec().description.input)[0].name: token_ids})
    te_by = outputs_by_shape(te)
    return te_out[te_by[(CTX, 1, 256)][0]], te_out[te_by[(1, CTX)][0]]


def segment_one(ie, det, ie_by, det_by, text_features, text_mask, img, ow, oh, n_want):
    """One preprocessed frame -> list of uint8 {0,255} masks (oh,ow), score order, <=n_want."""
    ie_out = ie.predict({list(ie.get_spec().description.input)[0].name: img})
    feat0 = ie_out[ie_by[(1, 256, 288, 288)][0]]
    feat1 = ie_out[ie_by[(1, 256, 144, 144)][0]]
    both72 = ie_by[(1, 256, 72, 72)]          # [feat2, vis_pos] in spec order
    feat2 = ie_out[both72[0]]
    vis_pos = ie_out[both72[1]]

    det_out = det.predict({
        "fpn_feat0": feat0, "fpn_feat1": feat1, "fpn_feat2": feat2,
        "vis_pos": vis_pos, "text_features": text_features, "text_mask": text_mask,
    })
    scores = np.asarray(det_out[det_by[(1, 200)][0]][0], dtype=np.float32)            # [200]
    masks = np.asarray(det_out[det_by[(1, 200, 288, 288)][0]][0], dtype=np.float32)   # [200,288,288]

    # var_4806 may be probs or logits depending on export; normalize to prob.
    prob = scores if (scores.min() >= 0.0 and scores.max() <= 1.0) else 1.0 / (1.0 + np.exp(-scores))
    order = np.argsort(-prob)
    kept = [i for i in order if prob[i] > CONF][:n_want]
    if not kept:
        kept = [int(order[0])]  # emit top-1 rather than a blank frame
    return [upsample_logit(masks[qi], ow, oh) for qi in kept]


def run_image(args, n_want):
    ie, te, det = load_models()
    ie_by, det_by = outputs_by_shape(ie), outputs_by_shape(det)
    text_features, text_mask = encode_text(te, args.prompt)

    img, ow, oh = preprocess(args.input)
    masks = segment_one(ie, det, ie_by, det_by, text_features, text_mask, img, ow, oh, n_want)
    log(f"prompt={args.prompt!r} kept={len(masks)}")

    union = None
    for oid, m in enumerate(masks):
        union = m if union is None else np.maximum(union, m)
        if len(masks) > 1:
            Image.fromarray(m).save(os.path.join(args.out, f"mask.{oid}.png"))
    Image.fromarray(union).save(os.path.join(args.out, "mask.png"))

    write_manifest(args, "image", ow, oh, len(masks), fps=None, frames=None)
    log("wrote", os.path.join(args.out, "mask.png"))


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


def run_video(args, n_want):
    rfr, fps, vw, vh = probe_video(args.input)
    # ponytail: h264/yuv420p needs even dims (true for real video); odd input fails loudly at encode.
    # ponytail: multi-object packs into R/G/B but 4:2:0 chroma subsampling softens G/B mask edges;
    #           single object -> true grayscale (luma) so it's crisp. 4th object (alpha) not stored in mp4.
    vch = min(n_want, 3)
    if n_want > 3:
        log(f"objects={n_want}: mask.mp4 (h264) has no alpha channel — packing 3 objects into R/G/B")
    chans = ["gray"] if vch == 1 else ["r", "g", "b"][:vch]

    ie, te, det = load_models()
    ie_by, det_by = outputs_by_shape(ie), outputs_by_shape(det)
    text_features, text_mask = encode_text(te, args.prompt)

    with tempfile.TemporaryDirectory() as work:
        fdir, mdir = os.path.join(work, "frames"), os.path.join(work, "masks")
        os.makedirs(fdir), os.makedirs(mdir)
        dec = subprocess.run(
            [FFMPEG, "-y", "-loglevel", "error", "-i", args.input,
             os.path.join(fdir, "%06d.png")],
            capture_output=True, text=True,
        )
        if dec.returncode != 0:
            fail(f"ffmpeg decode failed: {dec.stderr.strip()}")
        frames = sorted(glob.glob(os.path.join(fdir, "*.png")))
        if not frames:
            fail(f"no frames decoded from {args.input}")
        log(f"per-frame seg over {len(frames)} frames @ {fps:.3f}fps ({vw}x{vh}) — no temporal tracking")

        for i, fp in enumerate(frames):
            img, ow, oh = preprocess(fp)
            masks = segment_one(ie, det, ie_by, det_by, text_features, text_mask, img, ow, oh, n_want)
            rgb = np.zeros((oh, ow, 3), dtype=np.uint8)
            if vch == 1:
                if masks:
                    rgb[..., 0] = rgb[..., 1] = rgb[..., 2] = masks[0]
            else:
                for oid in range(min(len(masks), vch)):
                    rgb[..., oid] = masks[oid]
            Image.fromarray(rgb).save(os.path.join(mdir, f"{i:06d}.png"))  # 3-ch uint8 -> RGB

        enc = subprocess.run(
            [FFMPEG, "-y", "-loglevel", "error", "-framerate", rfr,
             "-i", os.path.join(mdir, "%06d.png"),
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16",
             os.path.join(args.out, "mask.mp4")],
            capture_output=True, text=True,
        )
        if enc.returncode != 0:
            fail(f"ffmpeg encode failed: {enc.stderr.strip()}")

    write_manifest(args, "video", vw, vh, vch, fps=fps, frames=len(frames), chans=chans)
    log("wrote", os.path.join(args.out, "mask.mp4"))


def write_manifest(args, kind, w, h, n_obj, fps, frames, chans=None):
    if chans is None:
        chans = ["gray"] * n_obj  # image path: union grayscale
    m = {
        "kind": kind,
        "source": args.input,
        "prompt": args.prompt,
        "width": w,
        "height": h,
        "objects": [
            {"id": i, "label": args.prompt, "channel": chans[i]} for i in range(n_obj)
        ],
        "backend": "coreml",
        "tracked": False,  # per-frame image seg — never true on this path
    }
    if fps is not None:
        m["fps"] = fps
    if frames is not None:
        m["frames"] = frames
    with open(os.path.join(args.out, "manifest.json"), "w") as f:
        json.dump(m, f, indent=2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--objects", type=int, default=1)
    ap.add_argument("--video", action="store_true", help="treat --input as a video (per-frame seg)")
    args = ap.parse_args()

    if not os.path.exists(args.input):
        fail(f"input not found: {args.input}")
    os.makedirs(args.out, exist_ok=True)
    n_want = max(1, min(4, args.objects))

    if args.video:
        run_video(args, n_want)
    else:
        run_image(args, n_want)


if __name__ == "__main__":
    main()
