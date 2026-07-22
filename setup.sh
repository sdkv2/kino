#!/usr/bin/env bash
# kino setup — thin shim; the real installer is setup.mjs (cross-platform).
# Windows: run `node setup.mjs` directly.
set -euo pipefail
command -v node >/dev/null 2>&1 || { echo "✗ Node.js not found — install Node 20+ (https://nodejs.org) and re-run." >&2; exit 1; }
exec node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/setup.mjs" "$@"
