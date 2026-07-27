#!/usr/bin/env bash
# Live-DOM OSR motion → BGRA paint → IPC → WebGL compositor spike.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
exec ./node_modules/.bin/electron spike/osr-relay/main.mjs "$@"
