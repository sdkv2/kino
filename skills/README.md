# Agent skills (canonical)

This directory is the **only** source of truth for kino’s agent playbooks. It ships in the npm package.

| Skill | Use |
|---|---|
| `video-production` | Specs, build, media, sound |
| `ad-voice` | VO/caption language + brand Tone/Voice |
| `adversarial-critique` | Subagent frame QA (overlap / layout) |
| `importing-footage` | Source recordings → beat map, clip windows, chrome frame, speed/pause |

## Install into a workspace (any machine)

```bash
kino skills --install
# → relative symlinks (or copies) into:
#    .agents/skills/   .cursor/skills/   .claude/skills/   .codex/skills/
kino skills --install --agents cursor,claude   # subset
```

`kino init` runs the full fan-out. `kino doctor` warns if any target is missing a skill.

Agents should **Read** their usual skill path (e.g. `.cursor/skills/video-production/SKILL.md`) —
all resolve to the same files here. Edit under `skills/`; re-run `--install` if a copy went stale.
