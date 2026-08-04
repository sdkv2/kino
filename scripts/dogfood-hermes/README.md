# Hermes/DeepSeek pipeline dogfooding

Finds where the `kino` pipeline (CLI ergonomics, docs, error messages, spec validation)
makes an independent agent struggle — by pointing real `hermes` agents running DeepSeek
(a different model, with no access to this session's context or the `video-production`
skill's polished playbook) at plain creative briefs and watching where they falter.

Distinct from the existing skill-dogfood-loop convention (`kino-skill-dogfood-loop`
memory), which uses Claude subagents in mock mode to pressure-test `skills/*/SKILL.md`
prose specifically. This harness uses a different model, allows real builds, and is
aimed at the pipeline as a whole, not just the skill docs.

## What it does

1. For each brief in `briefs/*.txt`, creates an isolated git worktree
   (`.worktrees/dogfood-hermes/<run-id>/<slug>`) with `node_modules`/`brands`/`projects`
   symlinked back to the main checkout, and builds `dist/`.
2. Runs `hermes chat` in that worktree with the brief as the query, DeepSeek as the
   model, `terminal`/`file`/`code_execution`/`vision` toolsets, and `--yolo`
   (unattended — no per-command approval prompts). `vision_analyze` calls route
   through MiniMax M3 on NVIDIA NIM (`auxiliary.vision` in `~/.hermes/config.yaml`) —
   confirmed multimodal, wired in 2026-08-04 to close the no-vision gap the first
   batch hit repeatedly. Main chat model stays DeepSeek throughout; ~45s per vision
   call, so a batch with heavy pixel-checking will run slower than round 1.
3. Exports the full session transcript (tool calls + reasoning) to
   `dogfood-runs/<run-id>/<slug>/<session-id>-session.md`, and copies the agent's own
   self-reported friction log (`dogfood-report.md`, the four-section format every brief
   asks for) alongside it.

## Running a batch

```sh
scripts/dogfood-hermes/run-batch.sh [run-id] [max-parallel]
```

Defaults: `run-id` = timestamp, `max-parallel` = 2. Real `kino build`s are GPU/CPU-bound
(see the `kino-dont-over-benchmark` memory: this machine's steady-state capacity is ~1
host, concurrency 4) and cost real money (ElevenLabs TTS, DeepSeek tokens) — don't raise
parallelism much past 2–3 without a reason.

Override the model/reasoning/turn-cap via env:

```sh
DOGFOOD_MODEL=deepseek-v4-pro DOGFOOD_REASONING=high scripts/dogfood-hermes/run-batch.sh
```

**Run this in a real terminal, not through a sandboxed agent Bash tool** — `--yolo`
unattended shell execution gets blocked by Claude Code's own auto-mode classifier when
attempted from inside a Claude Code session.

## After a batch

- `dogfood-runs/<run-id>/manifest.txt` — one line per task: slug, worktree path,
  branch, session id, exit code.
- `dogfood-runs/<run-id>/<slug>/dogfood-report.md` — the agent's own ranked friction log,
  written inline during the task.
- `dogfood-runs/<run-id>/<slug>/<session-id>-session.md` — the full raw transcript.
- Worktrees are left in place (not auto-removed) so the actual repo state — spec files
  the agent authored, final mp4 under `projects/`, any dead ends — can be inspected
  directly. Clean up with `git worktree remove <path>` (or `--force`), then
  `git worktree prune`.

Then run the retrospective pass — same model, same full session context, but asked
after the fact (not mid-task) to go deeper than the inline friction log: honest
time-cost attribution per pain point, a kino-vs-me judgment call on each one, and a
single ranked recommendation instead of a flat top-5.

```sh
scripts/dogfood-hermes/retrospective.sh dogfood-runs/<run-id>
```

Writes `dogfood-runs/<run-id>/<slug>/deepseek-retrospective.md` per task by resuming
each session (`hermes chat --resume <session-id>`) rather than re-feeding the
transcript — it's cheaper and the model already has the full context loaded.

Per the dogfood-loop convention, treat friction claims as a RED baseline, not something
to act on unread: verify each one against source before fixing anything (grep the
CLI/spec/skill it's complaining about — several past "findings" turned out to be the
tool being right and the doc/example being wrong instead). A synthesis pass across all
`deepseek-retrospective.md` files is the next step after any batch — rank by how many
independent briefs hit the same wall; convergence across unrelated tasks is the
strongest signal a friction point is real and not one session's fixation.
