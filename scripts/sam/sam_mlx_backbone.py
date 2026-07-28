#!/usr/bin/env python3
"""MLX SAM3.1 vision backbone → CoreML tracker feature contract.

Produces the same (vis72, hires0, hires1) tensors as scripts/sam_track.encode_frame_features
/ the CoreML sam3_vision_backbone.mlpackage, using mlx-community/sam3.1-bf16:

    image [1,3,1008,1008] fp32 [-1,1]
      → vis72 [5184,1,256], hires0 [1,32,288,288], hires1 [1,64,144,144]

Trunk + TriViTDetNeck.propagation_convs + tracker sam_mask_decoder.conv_s0/s1.
MLX lives in a separate Python (≥3.10; coreml venv is often 3.9), so the tracker
process talks to this module via a long-lived --worker subprocess (LOAD once).

Env:
  KINO_SAM_MLX_PYTHON   — python with mlx + mlx-vlm==0.4.3
  KINO_SAM_MLX_MODEL    — HF id or local path (default mlx-community/sam3.1-bf16)

Worker protocol (stdin lines → stdout lines):
  WARM                 → OK <s>
  ENCODE <img.npy> <out_dir>  → OK <s>   (writes vis72.npy hires0.npy hires1.npy)
  QUIT                 → OK
"""
from __future__ import annotations

import os
import sys
import time


E = 72
IMG = 1008
DEFAULT_MODEL = os.environ.get("KINO_SAM_MLX_MODEL", "mlx-community/sam3.1-bf16")


def log(*a):
    print("[sam_mlx]", *a, file=sys.stderr, flush=True)


def resolve_mlx_python():
    """Python that can `import mlx` + mlx_vlm. None if unavailable."""
    cands = []
    env = os.environ.get("KINO_SAM_MLX_PYTHON")
    if env:
        cands.append(env)
    # Same interpreter (merged venv).
    cands.append(sys.executable)
    home = os.path.expanduser("~")
    cands.append(os.path.join(home, ".kino", "sam", "mlx-venv", "bin", "python"))
    # Dev scratchpad (gitignored) — local convenience only.
    here = os.path.dirname(os.path.abspath(__file__))
    cands.append(
        os.path.join(here, "..", "scratchpad", "sam3-mlx", ".venv", "bin", "python")
    )
    seen = set()
    for p in cands:
        p = os.path.abspath(p) if p else ""
        if not p or p in seen or not os.path.exists(p):
            continue
        seen.add(p)
        try:
            import subprocess

            r = subprocess.run(
                [p, "-c", "import mlx, mlx_vlm"],
                capture_output=True,
                timeout=30,
            )
            if r.returncode == 0:
                return p
        except Exception:
            continue
    return None


class _MlxEncoder:
    """In-process encoder (worker side, or same-venv)."""

    def __init__(self, model_id: str = DEFAULT_MODEL):
        import mlx.core as mx
        from mlx_vlm.utils import get_model_path, load_model

        self.mx = mx
        log(f"loading {model_id} …")
        t0 = time.time()
        path = get_model_path(model_id) if not os.path.isdir(model_id) else model_id
        model = load_model(path)
        mx.eval(mx.array(0.0))
        self.ve = model.detector_model.vision_encoder
        self.conv_s0 = model.tracker_model.sam_mask_decoder.conv_s0
        self.conv_s1 = model.tracker_model.sam_mask_decoder.conv_s1
        log(f"loaded in {time.time() - t0:.1f}s")

    def encode_numpy(self, img_nchw):
        """img_nchw: (1,3,1008,1008) float32 → three float32 numpy arrays + elapsed."""
        import numpy as np

        mx = self.mx
        t0 = time.time()
        x = mx.array(np.asarray(img_nchw, dtype=np.float32).transpose(0, 2, 3, 1))
        bb = self.ve.backbone(x)
        _, _, prop = self.ve.neck(
            bb, need_det=False, need_interactive=False, need_propagation=True
        )
        h0 = self.conv_s0(prop[0])
        h1 = self.conv_s1(prop[1])
        vis72 = prop[2].reshape(1, E * E, 256).transpose(1, 0, 2)
        hires0 = h0.transpose(0, 3, 1, 2)
        hires1 = h1.transpose(0, 3, 1, 2)
        mx.eval(vis72, hires0, hires1)
        return (
            np.array(vis72, dtype=np.float32),
            np.array(hires0, dtype=np.float32),
            np.array(hires1, dtype=np.float32),
            time.time() - t0,
        )


def _worker_main():
    enc = None
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        cmd = parts[0].upper()
        try:
            if cmd == "QUIT":
                print("OK", flush=True)
                return
            if cmd == "WARM":
                if enc is None:
                    enc = _MlxEncoder()
                import numpy as np

                z = np.zeros((1, 3, IMG, IMG), dtype=np.float32)
                _, _, _, dt = enc.encode_numpy(z)
                print(f"OK {dt:.6f}", flush=True)
                continue
            if cmd == "ENCODE" and len(parts) == 3:
                if enc is None:
                    enc = _MlxEncoder()
                import numpy as np

                img = np.load(parts[1])
                out_dir = parts[2]
                os.makedirs(out_dir, exist_ok=True)
                vis72, h0, h1, dt = enc.encode_numpy(img)
                np.save(os.path.join(out_dir, "vis72.npy"), vis72)
                np.save(os.path.join(out_dir, "hires0.npy"), h0)
                np.save(os.path.join(out_dir, "hires1.npy"), h1)
                print(f"OK {dt:.6f}", flush=True)
                continue
            print(f"ERR unknown command: {line}", flush=True)
        except Exception as e:
            print(f"ERR {type(e).__name__}: {e}", flush=True)


class MlxBackboneWorker:
    """Long-lived MLX encode subprocess (LOAD on first WARM/ENCODE)."""

    def __init__(self, python: str):
        import atexit
        import subprocess
        import tempfile

        self._tmpdir = tempfile.mkdtemp(prefix="kino-sam-mlx-")
        # No caller closes the worker (it lives for the whole run), so registering here is what
        # actually removes the tmpdir — relying on an explicit close() leaked it on every run.
        # Covers normal exit and ^C (KeyboardInterrupt unwinds); close() stays idempotent.
        atexit.register(self.close)
        self._proc = subprocess.Popen(
            [python, os.path.abspath(__file__), "--worker"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=None,  # inherit — worker logs visible
            text=True,
            bufsize=1,
        )
        self._python = python
        log(f"MLX worker started (pid={self._proc.pid}, py={python})")

    def _ask(self, line: str) -> str:
        if self._proc.poll() is not None:
            raise RuntimeError(f"MLX worker exited early (code={self._proc.returncode})")
        self._proc.stdin.write(line + "\n")
        self._proc.stdin.flush()
        out = self._proc.stdout.readline()
        if not out:
            raise RuntimeError("MLX worker closed stdout")
        out = out.strip()
        if out.startswith("ERR"):
            raise RuntimeError(out)
        if not out.startswith("OK"):
            raise RuntimeError(f"MLX worker bad reply: {out}")
        return out

    def warm(self):
        t0 = time.time()
        self._ask("WARM")
        log(f"MLX backbone warm encode in {time.time() - t0:.2f}s")

    def encode(self, img_nchw):
        """Return (vis72, hires0, hires1, elapsed) as torch tensors + float."""
        import numpy as np
        import torch

        img_path = os.path.join(self._tmpdir, "image.npy")
        out_dir = os.path.join(self._tmpdir, "out")
        np.save(img_path, np.asarray(img_nchw, dtype=np.float32))
        reply = self._ask(f"ENCODE {img_path} {out_dir}")
        # OK <elapsed>
        parts = reply.split()
        dt = float(parts[1]) if len(parts) > 1 else 0.0
        vis72 = torch.from_numpy(np.load(os.path.join(out_dir, "vis72.npy")))
        hires0 = torch.from_numpy(np.load(os.path.join(out_dir, "hires0.npy")))
        hires1 = torch.from_numpy(np.load(os.path.join(out_dir, "hires1.npy")))
        return vis72, hires0, hires1, dt

    def close(self):
        # Idempotent: runs from atexit, and safely again if a caller closes explicitly.
        if getattr(self, "_closed", False):
            return
        self._closed = True
        try:
            if self._proc.poll() is None:
                self._ask("QUIT")
                self._proc.wait(timeout=10)
        except Exception:
            try:
                self._proc.kill()
            except Exception:
                pass
        try:
            import shutil

            shutil.rmtree(self._tmpdir, ignore_errors=True)
        except Exception:
            pass


def try_load_worker():
    """Start MLX worker if a usable MLX python exists. Returns worker or None."""
    py = resolve_mlx_python()
    if not py:
        return None
    try:
        return MlxBackboneWorker(py)
    except Exception as e:
        log(f"MLX worker failed to start: {e}")
        return None


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--worker":
        _worker_main()
    else:
        print("usage: sam_mlx_backbone.py --worker", file=sys.stderr)
        sys.exit(2)
