#!/usr/bin/env bash
# Standalone installer for the SAM3.1 `coreml` segment backend (macOS / Apple Silicon).
# Deliberately NOT part of setup.sh/setup.mjs — heavy opt-in env (coremltools + torch + sam3).
#
# Usage:
#   scripts/sam/setup_sam_coreml.sh [venv_dir]   # default: ~/.kino/sam
#
# Needs Python 3.11–3.12 (coremltools 9 + torch 2.7 are not on 3.14 yet). Homebrew:
#   brew install python@3.12
set -euo pipefail

SAM_DIR="${1:-$HOME/.kino/sam}"
VENV="$SAM_DIR/venv"

pick_python() {
  for c in "${KINO_SAM_SETUP_PYTHON:-}" \
           "$(command -v python3.12 2>/dev/null || true)" \
           "/opt/homebrew/opt/python@3.12/bin/python3.12" \
           "$(command -v python3.11 2>/dev/null || true)"; do
    [ -n "$c" ] && [ -x "$c" ] && { echo "$c"; return; }
  done
  echo "✗ need Python 3.11 or 3.12 (brew install python@3.12). coremltools 9 is not on 3.14 yet." >&2
  exit 1
}

PY_BOOT="$(pick_python)"
command -v git >/dev/null 2>&1 || { echo "✗ git not found." >&2; exit 1; }

mkdir -p "$SAM_DIR"
if [ -d "$VENV" ]; then
  rm -rf "$VENV"
fi
"$PY_BOOT" -m venv "$VENV"
PY="$VENV/bin/python"
PIP="$VENV/bin/pip"

"$PIP" install --quiet --upgrade pip

echo "→ coremltools 9 + torch 2.7 + runtime deps"
"$PIP" install --quiet "coremltools==9.0" "torch==2.7.0" "torchvision==0.22.0" huggingface_hub pillow "numpy<2" "setuptools<81"

if [ -d "$SAM_DIR/sam3/.git" ]; then
  git -C "$SAM_DIR/sam3" pull --quiet
else
  git clone --quiet https://github.com/facebookresearch/sam3 "$SAM_DIR/sam3"
fi

echo "→ sam3 package (CLIP-BPE tokenizer for TextEncoder)"
"$PIP" install --quiet -e "$SAM_DIR/sam3"
"$PIP" install --quiet einops pycocotools psutil "opencv-python<4.12"
"$PIP" install --quiet "numpy<2"

echo "→ verifying"
"$PY" -c "
import coremltools as ct, torch
import importlib.util
spec = importlib.util.spec_from_file_location('sam_runner', '$(dirname "$0")/sam_runner.py')
print(f'python ok, coremltools {ct.__version__}, torch {torch.__version__}')
"

cat <<EOF

✓ SAM coreml backend ready at $VENV
  Models auto-download on first 'kino segment' run (~2.4GB one-time).

Add to your shell profile:
  export KINO_SAM_PYTHON=$PY
EOF
