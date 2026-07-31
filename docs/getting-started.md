# Getting started

**kino** turns a JSON **spec** into a finished video: ElevenLabs voiceover → a background / motion graphic, with an optional AI presenter (HeyGen / Hedra / Replicate) → deterministic frame composite → MP4 (9:16, 3:4, 16:9, …). You (or a driving agent) author the creative as JSON; kino handles deterministic production.

This guide takes you from a clean checkout to your first rendered video. For the full command list see the [CLI reference](cli-reference.md); for the JSON format see the [Spec reference](spec-reference.md).

## Prerequisites

| Requirement | Why |
|---|---|
| **Node 22+** | runtime (the CLI is ESM) |
| **ffmpeg / ffprobe** | audio muxing, frame extraction |
| **ImageMagick** (`magick`) | storyboard contact sheets + frame montages |
| **ElevenLabs API key** | voiceover (required for real renders, with or without a presenter) |
| HeyGen / Hedra / Replicate key | only if a beat asks for an AI presenter (optional) |

Builds with no presenter need only ElevenLabs. Presenter builds usually need it too (kino VO → lip-sync), plus the
presenter provider. Get a key via [ElevenLabs](https://try.elevenlabs.io/7t4pgbmyxq67) (referral —
supports the project). With `--mock` you can preview structure and timing with **no API keys at all**
(silent VO + placeholder visuals).

## Install

Quickest path — from inside your project directory:

```bash
cd <your-project>
bash ~/kino/setup.sh          # installs the `kino` command + writes a project .env
node ~/kino/setup.mjs         # same installer, pure Node — use this on Windows
```

`setup.mjs` (which `setup.sh` execs) is a guided installer: it checks prerequisites (Node 22+, ffmpeg, ImageMagick) and offers to install any that are missing (Homebrew/apt/winget), runs `npm install && npm run build && npm link` in the kino repo (providing the global `kino` command), then walks through the API keys — what each is for and where to get it — and writes them to a **`chmod 600`, git-ignored `.env`** in your project. Re-running it keeps any keys already in the `.env` (press Enter at the prompt). Keys can also be supplied via the environment to run non-interactively:

```bash
ELEVENLABS_API_KEY=sk_... bash ~/kino/setup.sh
```

Or install by hand:

```bash
cd ~/kino && npm install && npm run build && npm link   # provides the `kino` command
```

No install at all also works — `npx @sdkv2/kino <command>` runs the published package, and
Puppeteer's Chromium ships with it. ffmpeg/ffprobe use your system install when they're on
PATH and fall back to a bundled binary otherwise. `npx` re-resolves dependencies on each first
run, so `npm i -g @sdkv2/kino` is worth it once you use kino regularly.

## Verify your environment

```bash
kino doctor      # checks deps (node, ffmpeg/ffprobe, ImageMagick, Electron render host, heygen CLI) + which API keys are present
kino update      # later: pull + rebuild a repo install (or npm -g @latest for a global one)
```

## Scaffold a project

```bash
kino init             # scaffold .env + projects/default/ with a ready-to-build sample spec
```

Every build runs inside a **project**:

- `kino init` scaffolds the workspace plus `projects/default/` with its own `specs/`, `assets/`, and `out/`. Name a brand (`kino init acme`) to also scaffold `brands/acme/brand.md` and a project that assigns it.
- `kino projects --new <name> [--brand <brand>]` adds more projects; `kino projects` lists what exists.
- A spec must live under a project's `specs/`. Building a spec that isn't inside a project fails with a message telling you to create one.

## Pick a colour scheme

Every build declares one — there is no silent house palette. The cheapest version is one line in the spec:

```jsonc
"colors": "midnight"   // or "noir" | "paper", or { "bg": "#…", "accent": "#…", … }
```

`kino colors` lists the presets, the five roles (`bg`, `fg`, `accent`, `accent2`, `deep`), and what each role paints. See [Spec reference → Colour scheme](spec-reference.md#colour-scheme).

A **brand** is optional and is the other place a palette can live. `brand.md` is YAML frontmatter (palette, fonts, disclosures, default presenter provider, voice/look aliases, banned phrases) followed by a free-form guidelines body for the driving agent — reach for one when several specs should share that context, not just to set colours. A brand whose frontmatter declares `colors` satisfies the requirement for every spec under it. See [Spec reference → brand.md](spec-reference.md#brandmd).

## Write a spec and render it

A spec is a JSON file describing the video as a list of **beats** (segments). Each beat is a `scene` (voiceover over the background — the default, so `kind` is optional), a `video` (footage or a screenshot cut in), or a `motion` graphic. Minimal example:

```json
{
  "title": "lie-test",
  "colors": "noir",
  "background": "aurora",
  "segments": [
    { "kind": "motion", "source": "motion/hook.html", "text": "Most cover letters get rejected in six seconds." },
    { "text": "Here's how to fix yours.", "caption": "Fix yours" }
  ]
}
```

`title` must be kebab-case; `segments` needs at least one beat; `colors` is required unless a brand declares them. Full field list in the [Spec reference](spec-reference.md).

The render loop is built for tight iteration — every preview step is free:

```bash
kino inspect  projects/acme/specs/lie-test.json            # resolved plan (beats, timings) as JSON
kino still    projects/acme/specs/lie-test.json --segment 0 # one frame, fast, free (mock by default)
kino storyboard projects/acme/specs/lie-test.json           # one still per beat, tiled into a labeled contact sheet
kino build    projects/acme/specs/lie-test.json --draft     # 720p structural render, silent, $0
kino build    projects/acme/specs/lie-test.json             # FULL-quality silent render, still $0 → projects/acme/out/lie-test/lie-test-9x16.mp4
kino build    projects/acme/specs/lie-test.json --tts       # add real voiceover (the only flag that spends)
```

Typical loop: **map beats → preview a beat → edit the spec → re-preview → `build`**. Use `kino inspect` to read per-word VO timings when you need to sync animations (background tweens, motion-graphic keyframes) to the voiceover.

## Output

Renders land at `projects/<name>/out/<title>/<title>[-<tag>]-<format>.mp4` (e.g. `projects/acme/out/lie-test/lie-test-9x16.mp4`). The `--tag` suffix (auto-set from `--background`/`--font`) keeps variant renders side-by-side instead of overwriting.

## Next steps

- **[CLI reference](cli-reference.md)** — every `kino` command and flag.
- **[Spec reference](spec-reference.md)** — the full JSON spec, `brand.md`, and `project.json`.
- **[Motion graphics](motion-graphics.md)** — author custom animated beats/overlays in HTML/CSS.
- **[Backgrounds & overlays](backgrounds-and-overlays.md)** — backgrounds, captions, kickers, shaders.
- **[Segmentation](segmentation.md)** — `kino segment` masks + `regionShader`.
- **[Agent skills](../skills/README.md)** — playbooks (`video-production`, `ad-voice`, `motion-design`, etc.) and `kino skills --install` local agent setup.
