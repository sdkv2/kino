# CLI reference

Every `kino` command, its arguments, options, and examples. Run `kino <command> --help` for the same option list inline. New to kino? Start with [Getting started](getting-started.md).

Most commands resolve their **project** automatically from the spec's path (`projects/<name>/specs/...`); pass `--project <name>` to override. Anything that renders accepts `--mock` (or defaults to it) so you can iterate for **$0** before spending on APIs.

**Commands**

- Build & preview — [`build`](#build) · [`still`](#still) · [`storyboard`](#storyboard) · [`retune`](#retune) · [`batch`](#batch) · [`inspect`](#inspect)
- Project setup — [`init`](#init) · [`projects`](#projects) · [`doctor`](#doctor) · [`skills`](#skills)
- Discovery (what you can use) — [`brand`](#brand) · [`voices`](#voices) · [`avatars`](#avatars) · [`fonts`](#fonts) · [`backgrounds`](#backgrounds) · [`elements`](#elements) · [`motion`](#motion) · [`pexels`](#pexels) · [`photos`](#photos) · [`music`](#music)
- Reference-video analysis (research only) — [`transcribe`](#transcribe) · [`scan`](#scan) · [`frames`](#frames)
- Audio analysis — [`audio-markers`](#audio-markers)

---

## Build & preview

### `build`
Generate a video from a spec: voiceover → optional avatar → frame composite → MP4. See [Build & preview](build-and-preview.md).

```
kino build <spec> [options]
```

| Option | Value | Meaning |
|---|---|---|
| `--mock` | — | Skip all paid APIs (silent VO + placeholder avatar). Free structural render. |
| `--format <list>` | e.g. `9:16,3:4` | Comma-separated output formats. |
| `--provider <name>` | `none\|heygen\|hedra\|replicate` | Override the avatar engine for this render. |
| `--background <kind>` | `glow\|image\|mesh\|aurora\|particles\|grid\|custom` | Override the faceless background. |
| `--font <name>` | font name | Override `brand.font` for this render (see [`fonts`](#fonts)). |
| `--project <name>` | project | Use `projects/<name>` (else inferred from the spec path). |
| `--tag <label>` | label | Suffix the output filename so variants are kept (auto-set from `--background`/`--font`). |

```bash
kino build specs/lie-test.json --mock                 # free preview, no API spend
kino build specs/lie-test.json                        # real render → out/lie-test/
kino build specs/lie-test.json --background aurora --format 9:16,3:4
```

Output: `out/<title>/<title>[-<tag>]-<format>.mp4`.

### `still`
Render a single frame fast (no encode) — the quickest visual check.

```
kino still <spec> [options]
```

| Option | Value | Meaning |
|---|---|---|
| `--at <list>` | seconds | Comma-separated timestamps to render. |
| `--around <sec>` | seconds | Sample N frames in a window around this point and tile them into one sheet (implies montage). |
| `--span <sec>` | seconds | Window width for `--around` (default `1`). |
| `--count <n>` | n | Frames in the `--around` window (default `5`). |
| `--montage` | — | Tile multiple stills into one contact sheet (also implied by `--around`). |
| `--segment <n>` | index | Render the midpoint of segment `n`. |
| `--word <word>` | spoken word | With `--segment`: center the `--around` sheet on that word's spoken start (case/punctuation-insensitive) — no hand-copying times from `inspect`. Word times shift when copy changes; this always resolves against the current VO. |
| `--format <fmt>` | `9:16\|3:4` | Output format. |
| `--font <name>` | font name | Override `brand.font`. |
| `--project <name>` | project | Use `projects/<name>`. |
| `--real` | — | Use real VO/avatar + true timing (default: mock, free). |
| `--platform <name>` | `tiktok\|reels\|shorts` | Overlay in-feed safe zones (right rail / bottom caption / top status) for QA. Still-only — not on `build`. |
| `--grid` | — | Overlay a rule-of-thirds grid for composition QA (fill budget / dead bands). Still-only — not on `build`. |

```bash
kino still specs/lie-test.json --segment 0
kino still specs/lie-test.json --at 2.5,7
kino still specs/lie-test.json --around 1.5            # 5 frames ±0.5s → one sheet
kino still specs/lie-test.json --around 1.5 --span 2 --count 7
kino still specs/lie-test.json --at 1,1.5,2 --montage
kino still specs/lie-test.json --segment 0 --platform tiktok
kino still specs/lie-test.json --segment 2 --word match   # sheet centered where "match" is spoken
kino still specs/lie-test.json --segment 0 --grid          # rule-of-thirds composition check
```

### `storyboard`
Render one still per beat, tiled into a labeled contact sheet (needs ImageMagick).

```
kino storyboard <spec> [options]
```

| Option | Value | Meaning |
|---|---|---|
| `--format <fmt>` | `9:16\|3:4` | Output format. |
| `--frames <n>` | number | Frames per beat (default `2`: composition + fully-revealed end-state; a 3rd/4th `·full` tile surfaces overflow/overlaps). |
| `--font <name>` | font name | Override `brand.font`. |
| `--project <name>` | project | Use `projects/<name>`. |
| `--real` | — | Real VO/avatar + true timing (default: mock, free). |
| `--platform <name>` | `tiktok\|reels\|shorts` | Same safe-zone overlay as [`still`](#still). |

```bash
kino storyboard specs/lie-test.json
kino storyboard specs/lie-test.json --platform reels
```

### `retune`
Rewrite beat-relative `triggers[].at` (and top-level `backgroundTriggers` if present) from **real** VO word timings — maps each trigger onto a spoken content word (exact match if counts line up, else first-N or last-N by position). Kills hand-editing after the first real build.

```
kino retune <spec> [--dry-run] [--project <name>]
```

| Option | Value | Meaning |
|---|---|---|
| `--dry-run` | — | Print each `at` change without writing the spec. |
| `--project <name>` | project | Use `projects/<name>`. |

```bash
kino build specs/advert.json            # produce real VO + word timings
kino retune specs/advert.json --dry-run # preview: segment[2].triggers[0].at: 1.6 → 1.567
kino retune specs/advert.json           # write the spec
```

### `batch`
Render many specs — either a JSON **array of paths**, or a **base + variants** file that patches one spec N ways and builds each with `--tag`.

```
kino batch <input> [--mock] [--project <name>]
```

**Legacy** — array of spec paths:

```json
["specs/a.json", "specs/b.json"]
```

**Variants** — one base × N hooks/tags:

```json
{
  "base": "specs/advert.json",
  "variants": [
    { "tag": "hook-a", "set": { "segments.0.text": "Make me a trailer." } },
    { "tag": "hook-b", "set": { "segments.0.text": "Make me a demo." }, "format": "9:16,3:4" }
  ]
}
```

`set` uses dotted paths into the parsed base (`segments.0.text`). Only replaces existing leaves / array indices. Variant specs land under `out/<title>/.batch/`, then each is built with `--tag <tag>`.

```bash
kino batch specs/all.json --mock
kino batch specs/hooks.json --mock
```

### `inspect`
Print the resolved render plan (beats, timings) as JSON — use it to read per-word VO times when syncing animations.

```
kino inspect <spec> [options]
```

| Option | Value | Meaning |
|---|---|---|
| `--real` | — | Use real VO timings instead of the mock estimate. |
| `--project <name>` | project | Use `projects/<name>`. |

```bash
kino inspect specs/lie-test.json          # fast, estimated timings
kino inspect specs/lie-test.json --real   # true ElevenLabs word timings
```

---

## Project setup

### `init [brand]`
Scaffold the workspace (`.env`, `brands/<brand>/brand.md`) plus a first project `projects/<brand>/` (with `specs/`, `assets/`, `out/`, and a `project.json` assigning the brand). Builds require a project, so this produces a ready-to-build layout. Defaults the brand/project name to `default`.

```
kino init [brand]
```

```bash
kino init acme
```

### `projects`
List projects, or scaffold a new one.

```
kino projects [--new <name>] [--brand <brand>]
```

| Option | Value | Meaning |
|---|---|---|
| `--new <name>` | name | Scaffold a new project under `projects/`. |
| `--brand <brand>` | brand | Brand to assign to the new project (omit for kino defaults). |

```bash
kino projects                               # list
kino projects --new acme --brand acme
kino projects --new scratch                 # no brand — kino house defaults
```

### `doctor`
Check the environment (dependencies + API keys) and whether agent skills are installed
for Cursor / Claude / Codex / `.agents`.

```
kino doctor
```

### `skills`
List bundled agent skills (`skills/` in the package), or install them for popular agents.

```
kino skills
kino skills --install
kino skills --install --agents cursor,claude
```

| Option | Meaning |
|---|---|
| `--install` | Symlink (or copy) each package `skills/<name>` into each agent’s project skill dir. |
| `--agents <list>` | `agents`, `cursor`, `claude` (`claude-code` alias), `codex`, or `all` (default). |

Default fan-out (local only, gitignored): `.agents/skills/`, `.cursor/skills/`, `.claude/skills/`, `.codex/skills/`.
`kino init` runs the full install. Canonical source remains `skills/` in the package (npm + git) — do not commit the agent dirs.
Browse the open directory via [skills.sh](https://skills.sh) after `npx skills add sdkv2/kino`.

---

## Discovery

These commands print machine-readable contracts the driving agent reads before authoring a spec.

### `brand`
List brands, or print a brand's resolved styling values + guidelines body — the brand context the agent reads before authoring a spec. With no `name`, lists the brands found under `brands/` (each a subdir containing a `brand.md`); brands are optional, so kino falls back to defaults when none exist. With a `name`, prints that brand's resolved frontmatter (colors, font, caption mode, background, voice, disclosure) followed by the free-form markdown guidelines body. See [Spec reference](spec-reference.md) for the `brand.md` format.

```
kino brand [name]
```

```bash
kino brand                # list available brands
kino brand acme      # resolved styling values + guidelines
```

### `voices`
List ElevenLabs voices.

```
kino voices [--gender <g>]
```

### `avatars`
List Avatar-IV photo-avatar looks (usable for lip-sync). See [Avatars & presenters](avatars.md).

```
kino avatars [--gender <g>]
```

### `fonts`
List the curated fonts (downloaded on demand) with descriptions + cache status.

```
kino fonts
```

### `backgrounds`
List animated backgrounds and their agent-controllable params + actions. See [Backgrounds & overlays](backgrounds-and-overlays.md).

```
kino backgrounds
```

### `elements`
List overlay elements (logo, captions, kickers) and their layout/tween controls. See [Backgrounds & overlays](backgrounds-and-overlays.md#overlay-elements).

```
kino elements
```

### `motion`
Show how to author motion-graphic HTML files + the CSS-variable contract. See [Motion graphics](motion-graphics.md).

```
kino motion
```

### `pexels`
Search Pexels stock **videos** (portrait by default) and download one into a project's `assets/pexels/`.
Downloaded clips are referenced from `app` segments like any asset (`"asset": "pexels/<id>.mp4"`).
Requires `PEXELS_API_KEY` in `.env` (free — [pexels.com/api](https://www.pexels.com/api/)).

```
kino pexels "city commute at night"                      # list matches: #, id, duration, size, author
kino pexels "city commute at night" --get 2 --project x  # download match 2 → assets/pexels/<id>.mp4
```

| Flag | Meaning |
|---|---|
| `--get <n>` | download result *n* from the search |
| `--count <n>` | results to list (default 8) |
| `--landscape` | search landscape instead of portrait |
| `--out <rel>` | asset-relative output path (default `pexels/<id>.mp4`) |
| `--project <name>` | project whose `assets/` receives the download (required for `--get`) |

### `photos`
Search Pexels stock **photos** (portrait by default) and download one into `assets/pexels/`.
Same key as `kino pexels`. Reference from `app` segments (`"asset": "pexels/<id>.jpg"`).

```
kino photos "coffee desk morning light"                      # list: #, id, size, author, thumb
kino photos "coffee desk morning light" --get 2 --project x  # → assets/pexels/<id>.jpg
```

| Flag | Meaning |
|---|---|
| `--get <n>` | download result *n* from the search |
| `--count <n>` | results to list (default 8) |
| `--landscape` | search landscape instead of portrait |
| `--out <rel>` | asset-relative output path (default `pexels/<id>.jpg`) |
| `--project <name>` | project whose `assets/` receives the download (required for `--get`) |

Screen local thumbs under `$TMPDIR/kino-pexels-photo-thumbs/` before `--get` (same habit as video).

### `music`
List library music beds (`assets-lib/music/` — ships empty; drop CC0 `.mp3`s there for bare ids),
or search Freesound CC0 tracks (15–90s, short-form length). A library bed's bare id resolves
straight from a spec's `music.src` — no copy needed; `--get` is only for pulling a bed into a
project or downloading a Freesound match. See [Audio](audio.md#music-beds).

```bash
kino music                                  # list library beds
kino music "lofi piano" --get 2 --project x # search Freesound, download match 2
kino music <id> --get --project x           # copy a library bed into the project
```

| Flag | Meaning |
|---|---|
| `--get [n]` | Copy a library bed (bare id, no query needed), or download Freesound result `n`. |
| `--count <n>` | Freesound results to list (default 8). |
| `--project <name>` | Project whose `assets/` receives the download/copy (required for `--get`). |

---

## Reference-video analysis (research only)

> These analyse **external** reference videos for research. They are **not** part of kino's own render pipeline and never touch your specs or renders.

### `transcribe`
Transcribe an external video's speech to a timestamped transcript (ElevenLabs Scribe).

```
kino transcribe <video> [options]
```

| Option | Value | Meaning |
|---|---|---|
| `--format <fmt>` | `json\|srt\|vtt\|text` (default `json`) | Output format. |
| `--out <file>` | path | Write to a file instead of stdout. |
| `--mock` | — | Offline canned transcript (no ffmpeg/network). |

### `scan`
Transcript + frames + contact sheet for an external video, in one shot.

```
kino scan <video> [options]
```

| Option | Value | Meaning |
|---|---|---|
| `--count <n>` | n | Extract N frames evenly (default: one per transcript segment). |
| `--every <sec>` | seconds | Extract a frame every N seconds. |
| `--out <dir>` | dir | Output directory. |
| `--mock` | — | Offline canned transcript. |

### `frames`
Extract frames from any video — explicit timestamps, around a point, or evenly.

```
kino frames <video> [options]
```

| Option | Value | Meaning |
|---|---|---|
| `--at <list>` | seconds | Comma-separated timestamps. |
| `--around <sec>` | seconds | Sample N frames in a window around this point and tile them (implies montage). |
| `--span <sec>` | seconds | Window width for `--around` (default `1`). |
| `--out <dir>` | dir | Output directory. |
| `--montage` | — | Also tile the frames into one image (also implied by `--around`). |
| `--every <sec>` | seconds | A frame every N seconds (when `--at`/`--around` is omitted). |
| `--count <n>` | n | With `--around`: frames in the window (default `5`). Else N frames spaced evenly. |

Precedence: `--at` > `--around` > `--count` > `--every`.

```bash
kino frames reference.mp4 --count 12 --montage
kino frames reference.mp4 --at 0,3.5,10
kino frames out/ad.mp4 --around 1.5 --span 1 --count 5   # QA a moment as one sheet
```

---

## Audio analysis

### `audio-markers`
Analyze any audio or video file and write three artifacts: `<name>.markers.json` —
`{ durationSec, rms[], onsets[], peaks[], silences[] }` timestamps to author `sfx[].at` and
cuts against — plus `<name>.wave.png` (waveform) and `<name>.spectrum.png` (spectrogram) for
an at-a-glance read of the track. Works on the VO track in `.kino-cache`, an imported music
bed, or an external reference video. See [Audio](audio.md#authoring-against-real-audio).

```
kino audio-markers <file> [options]
```

| Option | Value | Meaning |
|---|---|---|
| `--out <dir>` | dir | Output directory (default: next to the input file). |

```bash
kino audio-markers .kino-cache/lie-test/vo-0.mp3
kino audio-markers assets/music/bed.mp3 --out markers/
```
