#!/usr/bin/env bash
# Resumes each completed session from a run-batch.sh manifest and asks the SAME
# model (DeepSeek, with full conversation context) to write a deep, self-critical
# retrospective — not just the inline dogfood-report.md friction log, but honest
# time-cost attribution, kino-vs-me judgment calls, and a single ranked
# recommendation. Writes <run-dir>/<slug>/deepseek-retrospective.md per task.
#
# Usage:
#   scripts/dogfood-hermes/retrospective.sh <run-dir> [max-parallel]
#   scripts/dogfood-hermes/retrospective.sh dogfood-runs/20260804-215423
#
# A resumed session re-reasons over its whole history before answering, which can
# comfortably take a couple of minutes per task — this runs all tasks concurrently
# (default 4 at once; it's a lightweight text call, no heavy tool use, so this is
# safe to raise). If you invoke `hermes chat --resume` by hand instead, give it
# minutes to finish before reading the output file, or you'll catch it mid-thought,
# still outlining structure instead of having written the actual retrospective.
set -euo pipefail

RUN_DIR="${1:?usage: retrospective.sh <run-dir> [max-parallel]}"
MAX_PARALLEL="${2:-4}"
[ -f "$RUN_DIR/manifest.txt" ] || { echo "no manifest.txt in $RUN_DIR" >&2; exit 1; }

MODEL="${DOGFOOD_MODEL:-deepseek-v4-flash}"

read -r -d '' RETRO_PROMPT <<'EOF' || true
Write a deep, honest retrospective of this entire session for the kino engineering team who will use it to fix the CLI/pipeline. Do not just restate your dogfood-report.md friction log verbatim — go deeper and broader than that file.

Cover:
1. Every moment you were confused, stuck, had to guess, or took a wrong turn — with the exact command and exact error/output that caused it.
2. Roughly how much time/turns each pain point cost you relative to the whole session (which was the single biggest time sink?).
3. For each pain point, your honest judgment: was this kino's fault (bad docs, bad error messages, missing validation, surprising/inconsistent behavior) versus your own mistake or just the inherent difficulty of the creative task?
4. If you could change exactly ONE thing about kino to have made this session dramatically easier, what would it be and why?
5. Anything that worked surprisingly well and should NOT change.

Be specific and quote real commands/errors/text from the session — a vague high-level summary is useless to the engineers reading this. Write in prose, not just bullet points. Aim for real depth.
EOF

run_one() {
  local slug="$1" session_id="$2"
  local out="$RUN_DIR/$slug/deepseek-retrospective.md"
  echo "[$slug] resuming $session_id..."
  hermes chat --resume "$session_id" --no-restore-cwd \
    -q "$RETRO_PROMPT" \
    -m "$MODEL" --provider deepseek \
    -Q --source dogfood --pass-session-id \
    > "$out" 2> "$RUN_DIR/$slug/deepseek-retrospective.stderr.log"
  echo "[$slug] wrote $out ($(wc -l < "$out") lines)"
}
export -f run_one
export RETRO_PROMPT MODEL RUN_DIR

grep -v '|none|' "$RUN_DIR/manifest.txt" | awk -F'|' '{print $1"|"$4}' \
  | xargs -P "$MAX_PARALLEL" -L 1 -I{} bash -c 'IFS="|" read -r slug sid <<<"{}"; run_one "$slug" "$sid"'
