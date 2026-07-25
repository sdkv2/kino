#!/usr/bin/env bash
# Standalone installer for the SAM3.1 `cuda` segment backend (Linux/Windows+WSL + NVIDIA).
# Deliberately NOT part of setup.sh/setup.mjs — this is a heavy, opt-in GPU env (torch + a
# cloned facebookresearch/sam3 checkout), not something every kino install needs.
#
# Usage:
#   scripts/setup_sam_cuda.sh [venv_dir]      # default: ~/.kino/sam
#
# What it does, and why each step exists (learned the hard way getting this running on a
# fresh vast.ai box):
#   1. venv — isolates from system Python.
#   2. torch + torchvision installed TOGETHER from the same cu126 index in one pip call.
#      Installing them separately (or letting a later package pull torchvision from the
#      default PyPI index) gives you a torchvision built against a different torch ABI —
#      it imports fine but blows up at first real call: `RuntimeError: operator
#      torchvision::nms does not exist`. Same-call, same-index is the fix.
#   3. sam3 cloned + `pip install -e .` — sam3's pyproject.toml under-declares its runtime
#      deps (einops, pycocotools, psutil, opencv-python/cv2 — the last used by the video
#      frame-IO path (sam3/model/io_utils.py), so image segmentation runs fine without it
#      and only the video/tracking path breaks — are imported but not listed). Installed
#      explicitly here instead.
#   4. numpy re-pinned <2 LAST — sam3 requires numpy<2, but installing pycocotools/
#      scikit-image afterward silently upgrades numpy past 2.0 as a side effect, which
#      then breaks sam3 imports again. Must be the final install step.
set -euo pipefail

SAM_DIR="${1:-$HOME/.kino/sam}"
VENV="$SAM_DIR/venv"
TORCH_INDEX="https://download.pytorch.org/whl/cu126"

command -v python3 >/dev/null 2>&1 || { echo "✗ python3 not found." >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo "✗ git not found." >&2; exit 1; }
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=name,driver_version --format=csv,noheader | sed 's/^/✓ GPU: /'
else
  echo "! nvidia-smi not found — no NVIDIA driver visible. This backend needs a real GPU." >&2
fi

mkdir -p "$SAM_DIR"
[ -d "$VENV" ] || python3 -m venv "$VENV"
PY="$VENV/bin/python"
PIP="$VENV/bin/pip"

"$PIP" install --quiet --upgrade pip

echo "→ torch + torchvision (cu126, matched build)"
"$PIP" install --quiet torch torchvision --index-url "$TORCH_INDEX"

if [ -d "$SAM_DIR/sam3/.git" ]; then
  git -C "$SAM_DIR/sam3" pull --quiet
else
  git clone --quiet https://github.com/facebookresearch/sam3 "$SAM_DIR/sam3"
fi

echo "→ sam3 package + under-declared runtime deps"
"$PIP" install --quiet -e "$SAM_DIR/sam3"
# opencv-python pinned <4.12: 4.12+ declares numpy>=2, which fights sam3's numpy<2 pin below.
# (4.13 does still work against numpy 1.26 in practice, but it makes pip print a resolver ERROR
# on every install — pin to a version whose metadata actually agrees rather than teaching people
# to ignore red text.) cv2 is needed for real on the video/tracking path (sam3/model/io_utils.py).
"$PIP" install --quiet einops pycocotools psutil "opencv-python<4.12"

echo "→ re-pinning numpy<2 (sam3 requirement — must be last)"
"$PIP" install --quiet "numpy<2"

echo "→ verifying"
"$PY" -c "
import torch, torchvision, sam3
print(f'torch {torch.__version__} / torchvision {torchvision.__version__} / cuda available: {torch.cuda.is_available()}')
"

cat <<EOF

✓ SAM cuda backend ready at $VENV
  Checkpoint auto-downloads on first 'kino segment --backend cuda' run (open HF mirror by
  default; set SAM3_HF_REPO/HF_TOKEN for the gated facebook/sam3.1 repo instead).

Add to your shell profile:
  export KINO_SAM_PYTHON=$PY
EOF
