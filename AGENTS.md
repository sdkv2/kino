# Agent notes — Kino

## Video production

Work from the **`kino/` package root** (the git repo / npm package — has `brands/`, `projects/`, `skills/`).
Empty sibling folders are not the install.

### Skills (single source of truth)

See [`kino/skills/README.md`](kino/skills/README.md) for the full skill playbook directory, role mappings, and `kino skills --install` details.

Canonical playbooks live under [`kino/skills/<name>/SKILL.md`](kino/skills/).
Agent-facing local symlinks are generated in `.agents/skills/`, `.cursor/skills/`, `.claude/skills/`, and `.codex/skills/`.


### Quick path

1. `kino doctor` — keys + assets-lib + agent skills installed
2. Follow `video-production`: brand Tone/Voice → Pexels (local thumbs) → **cold-open plan** → spec → `inspect` / `still --around` (motion) → `storyboard` → **`adversarial-critique`** → `build` → **`inspect --real` + retune** speech-locked UIs → ship
3. Typed / loop / spoof-window ads: also `speech-synced-ui` (env.words, static `.bg` for seams, harness specs)
4. Shader / liquid-glass stages: also `shader-backgrounds` — `.frag` + `backgroundTextures`, draft with `KINO_SHADER_DRAFT=1` / SSAA1, prove on old-light + vesper
5. Music: `kino music` (bundled) or Freesound CC0 via `kino music "…" --get N --project …`. **Never** scrape Mixkit/Pixabay/Bensound. Short-form: volume ~0.12, hard duck.
6. SFX: bare ids; retime with `kino audio-markers` / `inspect --real` after first real build

CLI: `npx tsx src/cli.ts` from `kino/`, or the installed `kino` bin.
