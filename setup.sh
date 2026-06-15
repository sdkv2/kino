#!/usr/bin/env bash
# kino setup — installs the `kino` terminal command and writes a project .env with API keys.
#
#   cd <your-project> && bash /path/to/kino/setup.sh        # .env lands in the current dir
#   bash /path/to/kino/setup.sh ~/Downloads/EvidentCvMarketing   # ...or a dir you pass
#
# Keys can also be supplied via the environment (ELEVENLABS_API_KEY=... bash setup.sh) to run
# non-interactively. Nothing is printed back; the .env is chmod 600 and added to .gitignore.
set -euo pipefail

KINO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${1:-$PWD}" && pwd)"

echo "▸ Installing the 'kino' command from $KINO_DIR …"
( cd "$KINO_DIR" && npm install && npm run build && npm link )
if command -v kino >/dev/null 2>&1; then
  echo "✓ kino installed → $(command -v kino) ($(kino --version))"
else
  echo "✗ 'kino' is not on your PATH — check that npm's global bin dir is on PATH." >&2
  exit 1
fi

ENV_FILE="$PROJECT_DIR/.env"
echo
echo "▸ API keys → $ENV_FILE  (press Enter to skip; required: ELEVENLABS_API_KEY)"
if [ -f "$ENV_FILE" ]; then
  cp "$ENV_FILE" "$ENV_FILE.bak"
  echo "  (existing .env backed up → .env.bak)"
fi
: > "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "# kino API keys — DO NOT COMMIT" >> "$ENV_FILE"

add_key() { # $1 = var name, $2 = description
  local name="$1" desc="$2" val="${!1:-}"
  if [ -z "$val" ]; then
    printf "  %s — %s\n  > " "$name" "$desc"
    read -rs val </dev/tty 2>/dev/null || true
    echo
  fi
  if [ -n "$val" ]; then
    printf '%s=%s\n' "$name" "$val" >> "$ENV_FILE"
    echo "    ✓ set"
  else
    echo "    – skipped"
  fi
}

add_key ELEVENLABS_API_KEY  "voiceover — required (elevenlabs.io)"
add_key HEYGEN_API_KEY      "HeyGen avatars — optional"
add_key HEDRA_API_KEY       "Hedra avatars — optional (hedra.com/api-profile)"
add_key REPLICATE_API_TOKEN "Replicate lip-sync — optional (replicate.com/account/api-tokens)"

# Make sure the secrets never get committed.
GITIGNORE="$PROJECT_DIR/.gitignore"
grep -qxF ".env" "$GITIGNORE" 2>/dev/null || echo ".env" >> "$GITIGNORE"

echo
echo "✓ Done. Next:  cd $PROJECT_DIR && kino doctor"
