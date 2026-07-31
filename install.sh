#!/usr/bin/env bash
# kino one-line installer.
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/sdkv2/kino/main/install.sh)
#
# Run it FROM the project directory you want to build videos in — that's where the .env lands,
# not $KINO_DIR. This script's own job is small on purpose: get a kino checkout onto disk (clone,
# or `git pull` an existing one), then hand off to setup.mjs, which does the real work
# (prerequisite checks, `npm install && npm run build && npm link`, guided API-key setup).
#
# `curl URL | bash` also works, but process substitution (the form above) is what keeps your
# terminal attached for setup.mjs's prompts — piping into bash hands your shell's stdin to the
# script text itself, which would make setup.mjs think it's running non-interactively. This
# script also falls back to reading prompts from /dev/tty directly, so either invocation is safe.
#
# Override the install location with KINO_DIR=<path>; override the source with KINO_REPO=<url>
# (e.g. to install from a fork).
#
# Windows: this is a POSIX shell script (Git Bash / WSL only). Elsewhere, clone by hand and run
# the installer directly — see docs/getting-started.md:
#   git clone https://github.com/sdkv2/kino ~/kino
#   node ~/kino/setup.mjs
set -euo pipefail

REPO="${KINO_REPO:-https://github.com/sdkv2/kino.git}"
KINO_DIR="${KINO_DIR:-$HOME/kino}"

if ! command -v git >/dev/null 2>&1; then
  echo "kino needs git to install — https://git-scm.com/downloads" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "kino needs Node 22+ — https://nodejs.org" >&2
  exit 1
fi

if [ -d "$KINO_DIR/.git" ]; then
  echo "▸ Updating existing kino checkout at $KINO_DIR"
  git -C "$KINO_DIR" pull --ff-only
else
  echo "▸ Cloning kino to $KINO_DIR"
  git clone --depth 1 "$REPO" "$KINO_DIR"
fi

# See header: without this, `curl | bash` would leave setup.mjs's stdin pointed at the (already
# fully consumed) script text instead of your terminal, silently skipping every prompt.
if [ -r /dev/tty ]; then
  exec node "$KINO_DIR/setup.mjs" < /dev/tty
else
  exec node "$KINO_DIR/setup.mjs"
fi
