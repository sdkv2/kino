# Agent skills (canonical)

This directory is the **only** source of truth for kino’s agent playbooks. It ships in the npm package.
Edit here. Do not maintain parallel copies under agent dirs.

| Skill | Use |
|---|---|
| `video-production` | Specs, build, media, sound |
| `ad-voice` | VO/caption language + brand Tone/Voice |
| `adversarial-critique` | Subagent frame QA (overlap / layout) |
| `importing-footage` | Source recordings → beat map, clip windows, chrome frame, speed/pause |
| `speech-synced-ui` | VO-locked typed UI, caption-free montage, seamless-loop typed surfaces, real-VO retune |

## Install for local agents

Agents discover skills under `.agents/skills/`, `.cursor/skills/`, `.claude/skills/`, `.codex/skills/`.
Those dirs are **local-only** (gitignored) — they must not clutter the repo.

```bash
kino skills --install
# → relative symlinks (or copies) into the agent dirs above
kino skills --install --agents cursor,claude   # subset
```

`kino init` runs the full fan-out. `kino doctor` warns if any target is missing a skill.

Agents may also **Read** `skills/<name>/SKILL.md` directly. After `--install`, the agent-specific paths resolve to the same files.
