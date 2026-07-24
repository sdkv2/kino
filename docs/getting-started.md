# Getting started

**kino** turns a JSON **spec** into a finished video: ElevenLabs voiceover → optional AI avatar (HeyGen / Hedra / Replicate) or a **faceless** background / motion graphic → deterministic frame composite → MP4 (9:16, 3:4, 16:9, …). You (or a driving agent) author the creative as JSON; kino handles deterministic production.

This guide takes you from a clean checkout to your first rendered video. For the full command list see the [CLI reference](cli-reference.md); for the JSON format see the [Spec reference](spec-reference.md).

## Prerequisites

| Requirement | Why |
|---|---|
| **Node 20+** | runtime (the CLI is ESM) |
| **ffmpeg / ffprobe** | audio muxing, frame extraction |
| **ImageMagick** (`magick`) | storyboard contact sheets + frame montages |
| **ElevenLabs API key** | voiceover (required for real renders — faceless and most avatar setups) |
| HeyGen / Hedra / Replicate key | only if you use an AI avatar (optional) |

Faceless needs only ElevenLabs. Avatar builds usually need it too (kino VO → lip-sync), plus the
avatar provider. Get a key via [ElevenLabs](https://try.elevenlabs.io/7t4pgbmyxq67) (referral —
supports the project). With `--mock` you can preview structure and timing with **no API keys at all**
(silent VO + placeholder visuals).

## Install

Quickest path — from inside your project directory:

```bash
cd <your-project>
bash ~/kino/setup.sh          # installs the `kino` command + writes a project .env
node ~/kino/setup.mjs         # same installer, pure Node — use this on Windows
```

`setup.mjs` (which `setup.sh` execs) is a guided installer: it checks prerequisites (Node 20+, ffmpeg, ImageMagick) and offers to install any that are missing (Homebrew/apt/winget), runs `npm install && npm run build && npm link` in the kino repo (providing the global `kino` command), then walks through the API keys — what each is for and where to get it — and writes them to a **`chmod 600`, git-ignored `.env`** in your project. Re-running it keeps any keys already in the `.env` (press Enter at the prompt). Keys can also be supplied via the environment to run non-interactively:

```bash
ELEVENLABS_API_KEY=sk_... bash ~/kino/setup.sh
```

Or install by hand:

```bash
cd ~/kino && npm install && npm run build && npm link   # provides the `kino` command
```

## Verify your environment

```bash
kino doctor      # checks deps (node, ffmpeg/ffprobe, ImageMagick, headless Chrome, heygen CLI) + which API keys are present
kino update      # later: pull + rebuild a repo install (or npm -g @latest for a global one)
```

## Scaffold a project

```bash
kino init acme        # scaffold .env, a brand.md, and projects/acme/
```

Every build runs inside a **project**:

- `kino init <brand>` scaffolds the workspace plus a first project named after the brand: `projects/<brand>/` with its own `specs/`, `assets/`, and `out/`, plus a `project.json` that assigns the brand.
- `kino projects --new <name> [--brand <brand>]` adds more projects (omit `--brand` for a brandless project on kino defaults); `kino projects` lists what exists.
- A spec must live under a project's `specs/`. Building a spec that isn't inside a project fails with a message telling you to create one.

A **brand** (`brand.md`) is YAML frontmatter (an optional subset of palette/font/voice/disclosure and other settings) followed by a free-form guidelines body. The frontmatter holds the palette, fonts, disclosures, default avatar provider, voice/look aliases, and banned phrases; the body is prose for the driving agent. Everything is optional and falls back to kino defaults — see [Spec reference → brand.md](spec-reference.md#brandmd).

## Write a spec and render it

A spec is a JSON file describing the video as a list of **beats** (segments). Each beat is an `avatar` (talking head / faceless VO), an `app` (a screenshot cut-in), or a `motion` graphic. Minimal faceless example:

```json
{
  "title": "lie-test",
  "background": "aurora",
  "segments": [
    { "kind": "motion", "source": "motion/hook.html", "text": "Most cover letters get rejected in six seconds." },
    { "kind": "avatar", "text": "Here's how to fix yours.", "caption": "Fix yours" }
  ]
}
```

`title` must be kebab-case; `segments` needs at least one beat. Full field list in the [Spec reference](spec-reference.md).

The render loop is built for tight iteration — every preview step is free:

```bash
kino inspect  projects/acme/specs/lie-test.json            # resolved plan (beats, timings) as JSON
kino still    projects/acme/specs/lie-test.json --segment 0 # one frame, fast, free (mock by default)
kino storyboard projects/acme/specs/lie-test.json           # one still per beat, tiled into a labeled contact sheet
kino build    projects/acme/specs/lie-test.json --mock      # full structural render, silent VO, $0
kino build    projects/acme/specs/lie-test.json             # real render → projects/acme/out/lie-test/lie-test-9x16.mp4
```

Typical loop: **map beats → preview a beat → edit the spec → re-preview → `build`**. Use `kino inspect` to read per-word VO timings when you need to sync animations (background tweens, motion-graphic keyframes) to the voiceover.

## Output

Renders land at `projects/<name>/out/<title>/<title>[-<tag>]-<format>.mp4` (e.g. `projects/acme/out/lie-test/lie-test-9x16.mp4`). The `--tag` suffix (auto-set from `--background`/`--font`) keeps variant renders side-by-side instead of overwriting.

## Next steps

- **[CLI reference](cli-reference.md)** — every `kino` command and flag.
- **[Spec reference](spec-reference.md)** — the full JSON spec, `brand.md`, and `project.json`.
- **[Motion graphics](motion-graphics.md)** — author custom animated beats/overlays in HTML/CSS.
- **[Backgrounds & overlays](backgrounds-and-overlays.md)** — faceless backgrounds, logo, captions, kickers, shaders.
- **[Segmentation](segmentation.md)** — `kino segment` masks + `regionShader`.
- Agent skills (canonical): [`skills/`](../skills/). `kino skills --install` (also `kino init`) creates local (gitignored) symlinks under `.agents` / `.cursor` / `.claude` / `.codex`.
- Playbooks: `video-production`, `ad-voice`, `adversarial-critique`, `importing-footage`, `speech-synced-ui`, `motion-design`, `shader-backgrounds`. Also: `npx skills add sdkv2/kino`.
