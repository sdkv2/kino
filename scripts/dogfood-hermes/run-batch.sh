#!/usr/bin/env bash
# Orchestrates a batch of hermes/deepseek agents independently attempting kino video-ad
# tasks, to surface where the pipeline (CLI ergonomics, docs, error messages, spec
# validation) makes an outside agent struggle or falter.
#
# Each brief in briefs/*.txt runs in its own isolated git worktree, as its own hermes
# chat session, with real `kino build` allowed. Every session's full tool-call + reasoning
# transcript is exported to disk, alongside the agent's own self-reported friction log.
#
# Usage:
#   scripts/dogfood-hermes/run-batch.sh [run-id] [max-parallel]
#
# Env overrides:
#   DOGFOOD_MODEL      deepseek-v4-flash (default) | deepseek-v4-pro
#   DOGFOOD_REASONING  high (default) — passed to `hermes chat --reasoning`
#   DOGFOOD_MAX_TURNS  140 (default) — passed to `hermes chat --max-turns`
#
# Requires: the `hermes` CLI configured with a working DeepSeek key (`hermes status`),
# and enough headroom to run --yolo unattended shell commands (this script does not run
# under a sandboxed Bash tool — run it directly in a real terminal).
set -euo pipefail

KINO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BRIEFS_DIR="$KINO_ROOT/scripts/dogfood-hermes/briefs"
RUN_ID="${1:-$(date +%Y%m%d-%H%M%S)}"
MAX_PARALLEL="${2:-2}"
RUN_DIR="$KINO_ROOT/dogfood-runs/$RUN_ID"
WORKTREE_ROOT="$KINO_ROOT/.worktrees/dogfood-hermes/$RUN_ID"

MODEL="${DOGFOOD_MODEL:-deepseek-v4-flash}"
REASONING="${DOGFOOD_REASONING:-high}"
MAX_TURNS="${DOGFOOD_MAX_TURNS:-140}"

mkdir -p "$RUN_DIR" "$WORKTREE_ROOT"

# A stand-in "device recording" for the footage-cut brief — kino's importing-footage
# surface cares about the import/cut/retime workflow, not the literal provenance of the
# source clip, so any real mp4 exercises it.
FOOTAGE_SOURCE="$KINO_ROOT/demos/projects/crate/assets/pexels/35982896.mp4"

run_one() {
  local brief_file="$1"
  local slug wt branch out status session_id
  slug="$(basename "$brief_file" .txt)"
  wt="$WORKTREE_ROOT/$slug"
  branch="dogfood/hermes-$RUN_ID-$slug"
  out="$RUN_DIR/$slug"
  mkdir -p "$out"

  echo "[$slug] creating worktree at $wt"
  if ! git -C "$KINO_ROOT" worktree add -q "$wt" -b "$branch" >"$out/worktree.log" 2>&1; then
    echo "[$slug] FAILED to create worktree — see $out/worktree.log"
    return 1
  fi

  # Worktrees ship without node_modules — symlink it in (deps only, no content leak).
  # brands/ and projects/ are deliberately NOT linked in: they live outside the repo now
  # (KINO_WORKSPACE_ROOT) specifically so a dogfood agent can't browse real, finished
  # brand/project content as an answer key. `kino init <brand>` inside the worktree just
  # creates a fresh local brands/projects there, genuinely from scratch.
  #
  # A fresh worktree still checks out brands/kino/brand.md + projects/kino-meta/* — those
  # two paths are committed in git history (kino's own self-branding + self-demo project),
  # independent of whatever the main checkout's working tree currently has. Strip them so
  # a dogfood agent can't read a real, finished example project as a reference answer.
  rm -rf "$wt/brands" "$wt/projects"
  ln -s "$KINO_ROOT/node_modules" "$wt/node_modules"
  cp "$KINO_ROOT/.env" "$wt/.env" && chmod 600 "$wt/.env"

  # The CLI runs from dist/, not src/ — build once so the worktree's compiled output
  # matches its checked-out source.
  echo "[$slug] building dist/..."
  ( cd "$wt" && npm run build ) >"$out/build.log" 2>&1

  local brief
  brief="$(cat "$brief_file")"
  if [ "$slug" = "footage-cut" ]; then
    mkdir -p "$wt/assets"
    cp "$FOOTAGE_SOURCE" "$wt/assets/incoming-demo-recording.mp4"
  fi

  echo "[$slug] launching hermes ($MODEL, reasoning=$REASONING)..."
  set +e
  # KINO_WORKSPACE_ROOT (set in the shell profile for normal day-to-day kino use) must NOT
  # reach this subprocess — it points at the real brands/projects library, and inheriting
  # it here would silently defeat the whole point of not linking those dirs into the
  # worktree above.
  ( cd "$wt" && unset KINO_WORKSPACE_ROOT && hermes chat \
      -q "$brief" \
      -m "$MODEL" \
      --provider deepseek \
      -t terminal,file,code_execution,vision \
      --reasoning "$REASONING" \
      --max-turns "$MAX_TURNS" \
      --yolo \
      --pass-session-id \
      --source dogfood \
      -Q ) >"$out/stdout.log" 2>"$out/stderr.log"
  status=$?
  set -e
  echo "$status" > "$out/exit-code"
  echo "[$slug] hermes exited with status $status"

  session_id="$(grep -hoE 'session_id: [A-Za-z0-9_]+' "$out/stdout.log" "$out/stderr.log" | tail -1 | awk '{print $2}')"
  if [ -n "${session_id:-}" ]; then
    echo "$session_id" > "$out/session-id"
    hermes sessions export --format md --redact --session-id "$session_id" "$out" >>"$out/stdout.log" 2>&1 || true
    hermes sessions export --format trace --redact --session-id "$session_id" "$out/trace.jsonl" >>"$out/stdout.log" 2>&1 || true
  else
    echo "[$slug] WARNING: could not find session_id in stdout — no transcript export"
  fi

  if [ -f "$wt/dogfood-report.md" ]; then
    cp "$wt/dogfood-report.md" "$out/dogfood-report.md"
  else
    echo "[$slug] WARNING: agent did not write dogfood-report.md"
  fi

  echo "$slug|$wt|$branch|${session_id:-none}|$status" >> "$RUN_DIR/manifest.txt"
  echo "[$slug] done"
}
export -f run_one
export KINO_ROOT WORKTREE_ROOT RUN_ID RUN_DIR MODEL REASONING MAX_TURNS FOOTAGE_SOURCE

echo "Run ID: $RUN_ID"
echo "Model: $MODEL  Reasoning: $REASONING  Max turns: $MAX_TURNS  Parallel: $MAX_PARALLEL"
echo "Output: $RUN_DIR"
echo

find "$BRIEFS_DIR" -name '*.txt' | xargs -P "$MAX_PARALLEL" -I{} bash -c 'run_one "$@"' _ {}

echo
echo "=== Batch complete: $RUN_DIR ==="
cat "$RUN_DIR/manifest.txt" 2>/dev/null || true
echo
hermes sessions stats 2>&1 || true
echo
echo "Worktrees are left in place for inspection at $WORKTREE_ROOT"
echo "Remove them with: git -C '$KINO_ROOT' worktree remove <path> (or --force), then git worktree prune"
