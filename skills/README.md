# Agent skills

| Skill | Use |
|---|---|
| `video-production` | Producing a short-form vertical ad with the `kino` CLI — spec authoring, build workflow, cost/compliance guardrails. Start here for any new video. |
| `ad-voice` | Writing/rewriting segment `text`/`caption`/CTAs so copy sounds human, not AI slop; filling a brand's Tone/Voice section. |
| `adversarial-critique` | Fresh-eyes subagent QA pass over storyboard/build stills — overlap, overflow, bad positioning, legibility. Run after `kino storyboard` and before calling a build done. |
| `importing-footage` | Turning a long source recording (screen capture, device scroll, desktop demo) into beats — clip windows, chrome frame seating, speed/pause retiming. |
| `speech-synced-ui` | On-screen UI text that must type/reveal in lockstep with VO (terminal prompts, chat inputs, spoof AI windows, code editors); caption-free montages; seamless-loop typed surfaces. |
| `motion-design` | Visual craft for motion graphics (Tier-1 HTML, Tier-2 JS, motionOverlay) — composition, color, type, camera/choreography, spoof-UI craft, anti-generic checks. |
| `shader-backgrounds` | WebGL `.frag` / `.glsl` custom backgrounds (ShaderToy `mainImage`, texture channels, `kino-glass` pairing) — raymarch / plasma stages, not Canvas2D wash or Blender. |

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
