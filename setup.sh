#!/usr/bin/env bash
# kino setup — guided install: prerequisites (Node 18+, ffmpeg, ImageMagick), the `kino`
# command, and your API keys.
#
#   cd <your-project> && bash /path/to/kino/setup.sh        # .env lands in the current dir
#   bash /path/to/kino/setup.sh ~/path/to/project           # ...or a dir you pass
#
# Non-interactive: supply keys via the environment (ELEVENLABS_API_KEY=... bash setup.sh) —
# any key already set skips its prompt. Nothing is echoed back; the .env is chmod 600 and
# git-ignored.
set -euo pipefail

KINO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${1:-$PWD}" && pwd)"

# ── style ────────────────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  DIM=$'\033[2m'; BOLD=$'\033[1m'; ACC=$'\033[38;5;166m'; GRN=$'\033[32m'; YLW=$'\033[33m'; RST=$'\033[0m'
else
  DIM=""; BOLD=""; ACC=""; GRN=""; YLW=""; RST=""
fi
ok()   { printf "  %s✓%s %s\n" "$GRN" "$RST" "$1"; }
warn() { printf "  %s!%s %s\n" "$YLW" "$RST" "$1"; }
note() { printf "  %s%s%s\n" "$DIM" "$1" "$RST"; }
step() { printf "\n%s▸ %s%s\n" "$BOLD" "$1" "$RST"; }
fail() { printf "  %s✗ %s%s\n" "$ACC" "$1" "$RST" >&2; exit 1; }

# yes/no prompt, default yes; non-interactive runs answer yes only when FORCE=1
ask() {
  local q="$1" a=""
  if [ -r /dev/tty ]; then
    printf "  %s [Y/n] " "$q"
    read -r a </dev/tty || true
  else
    [ "${FORCE:-0}" = "1" ] && a="y" || a="n"
  fi
  case "$a" in n|N|no|NO) return 1 ;; *) return 0 ;; esac
}

logo() {
  printf "\n  %s+--%s                                %s--+%s\n\n" "$ACC" "$RST" "$ACC" "$RST"
  cat <<'ART'
        _    _
       | | _(_)_ __   ___
       | |/ / | '_ \ / _ \
       |   <| | | | | (_) |
       |_|\_\_|_| |_|\___/
ART
  printf "\n       %sagent-driven video production%s\n" "$DIM" "$RST"
  printf "\n  %s+--%s                                %s--+%s\n" "$ACC" "$RST" "$ACC" "$RST"
}

logo

# ── prerequisites ────────────────────────────────────────────────────────────
step "Prerequisites"

command -v node >/dev/null 2>&1 || fail "Node.js not found — install Node 18+ (https://nodejs.org) and re-run."
NODE_MAJOR="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
[ "$NODE_MAJOR" -ge 18 ] || fail "Node $(node -v) is too old — kino needs Node 18+."
ok "node $(node -v)"

MISSING=()
if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
  ok "ffmpeg + ffprobe"
else
  warn "ffmpeg/ffprobe missing — required to render video"
  MISSING+=(ffmpeg)
fi
if command -v magick >/dev/null 2>&1 || command -v montage >/dev/null 2>&1; then
  ok "ImageMagick"
else
  warn "ImageMagick missing — optional, used for storyboard contact sheets"
  MISSING+=(imagemagick)
fi

if [ "${#MISSING[@]}" -gt 0 ]; then
  if command -v brew >/dev/null 2>&1; then
    if ask "Install ${MISSING[*]} with Homebrew?"; then
      brew install "${MISSING[@]}"
      ok "installed: ${MISSING[*]}"
    else
      note "skipped — install later with: brew install ${MISSING[*]}"
    fi
  elif command -v apt-get >/dev/null 2>&1; then
    if ask "Install ${MISSING[*]} with apt-get (needs sudo)?"; then
      sudo apt-get update && sudo apt-get install -y "${MISSING[@]}"
      ok "installed: ${MISSING[*]}"
    else
      note "skipped — install later with: sudo apt-get install ${MISSING[*]}"
    fi
  else
    warn "no brew/apt-get found — install manually: ${MISSING[*]}"
  fi
fi

# ── the kino command ─────────────────────────────────────────────────────────
step "Installing the kino command"
note "from $KINO_DIR (npm install → build → link)"
( cd "$KINO_DIR" && npm install --no-fund --no-audit && npm run build && npm link ) >/dev/null
command -v kino >/dev/null 2>&1 || fail "'kino' is not on your PATH — check that npm's global bin dir is on PATH."
ok "kino $(kino --version) → $(command -v kino)"

# ── API keys ─────────────────────────────────────────────────────────────────
step "API keys"
ENV_FILE="$PROJECT_DIR/.env"
note "written to $ENV_FILE (chmod 600, git-ignored) — press Enter to skip any key"
if [ -f "$ENV_FILE" ]; then
  cp "$ENV_FILE" "$ENV_FILE.bak"
  note "existing .env backed up → .env.bak"
fi
: > "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "# kino API keys — DO NOT COMMIT" >> "$ENV_FILE"

SET_KEYS=()
SKIPPED_KEYS=()
add_key() { # $1 = var name, $2 = required|optional, $3 = purpose, $4 = where to get it
  local name="$1" req="$2" desc="$3" url="$4" val="${!1:-}"
  printf "\n  %s%s%s %s(%s)%s — %s\n" "$BOLD" "$name" "$RST" "$DIM" "$req" "$RST" "$desc"
  note "get one: $url"
  if [ -z "$val" ]; then
    printf "  > "
    { read -rs val </dev/tty; } 2>/dev/null || true
    printf "\n"
  else
    note "taken from the environment"
  fi
  if [ -n "$val" ]; then
    printf '%s=%s\n' "$name" "$val" >> "$ENV_FILE"
    ok "set"
    SET_KEYS+=("$name")
  else
    note "skipped"
    SKIPPED_KEYS+=("$name")
  fi
}

add_key ELEVENLABS_API_KEY  required "voiceover (every real build)"          "https://elevenlabs.io → Profile → API keys"
add_key PEXELS_API_KEY      optional "stock b-roll via 'kino pexels'"        "https://www.pexels.com/api"
add_key HEYGEN_API_KEY      optional "HeyGen avatars (provider: heygen)"     "https://app.heygen.com → Settings → API"
add_key HEDRA_API_KEY       optional "Hedra avatars (provider: hedra)"       "https://www.hedra.com/api-profile"
add_key REPLICATE_API_TOKEN optional "open-source lip-sync (provider: replicate)" "https://replicate.com/account/api-tokens"

# make sure the secrets never get committed
GITIGNORE="$PROJECT_DIR/.gitignore"
grep -qxF ".env" "$GITIGNORE" 2>/dev/null || echo ".env" >> "$GITIGNORE"

# ── summary ──────────────────────────────────────────────────────────────────
step "Done"
[ "${#SET_KEYS[@]}" -gt 0 ] && ok "keys set: ${SET_KEYS[*]}"
[ "${#SKIPPED_KEYS[@]}" -gt 0 ] && note "skipped: ${SKIPPED_KEYS[*]} (re-run setup.sh or edit .env to add them)"
printf "\n  Next:\n"
printf "    cd %s\n" "$PROJECT_DIR"
printf "    kino doctor                        %s# verify the environment%s\n" "$DIM" "$RST"
printf "    kino init <brand>                  %s# scaffold a brand + first project%s\n" "$DIM" "$RST"
printf "    kino build specs/<spec>.json --mock  %s# free structural preview%s\n" "$DIM" "$RST"
printf "\n"
