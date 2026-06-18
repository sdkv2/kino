# CLI reference

Every `kino` command, its arguments, options, and examples. Run `kino <command> --help` for the same option list inline. New to kino? Start with [Getting started](getting-started.md).

Most commands resolve their **project** automatically from the spec's path (`projects/<name>/specs/...`); pass `--project <name>` to override. Anything that renders accepts `--mock` (or defaults to it) so you can iterate for **$0** before spending on APIs.

**Commands**

- Build & preview — [`build`](#build) · [`still`](#still) · [`storyboard`](#storyboard) · [`batch`](#batch) · [`inspect`](#inspect)
- Project setup — [`init`](#init) · [`projects`](#projects) · [`doctor`](#doctor)
- Discovery (what you can use) — [`brand`](#brand) · [`voices`](#voices) · [`avatars`](#avatars) · [`fonts`](#fonts) · [`backgrounds`](#backgrounds) · [`elements`](#elements) · [`motion`](#motion)
- Reference-video analysis (research only) — [`transcribe`](#transcribe) · [`scan`](#scan) · [`frames`](#frames)

---

## Build & preview

### `build`
Generate a video from a spec: voiceover → optional avatar → Remotion composite → MP4.

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
| `--segment <n>` | index | Render the midpoint of segment `n`. |
| `--format <fmt>` | `9:16\|3:4` | Output format. |
| `--font <name>` | font name | Override `brand.font`. |
| `--project <name>` | project | Use `projects/<name>`. |
| `--real` | — | Use real VO/avatar + true timing (default: mock, free). |

```bash
kino still specs/lie-test.json --segment 0
kino still specs/lie-test.json --at 2.5,7
```

### `storyboard`
Render one still per beat, tiled into a labeled contact sheet (needs ImageMagick).

```
kino storyboard <spec> [options]
```

| Option | Value | Meaning |
|---|---|---|
| `--format <fmt>` | `9:16\|3:4` | Output format. |
| `--font <name>` | font name | Override `brand.font`. |
| `--project <name>` | project | Use `projects/<name>`. |
| `--real` | — | Real VO/avatar + true timing (default: mock, free). |

```bash
kino storyboard specs/lie-test.json
```

### `batch`
Render many specs (a JSON array of spec paths).

```
kino batch <input> [--mock]
```

```bash
kino batch specs/all.json --mock
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
kino init evidentcv
```

### `projects`
List projects, or scaffold a new one.

```
kino projects [--new <name> --brand <brand>]
```

| Option | Value | Meaning |
|---|---|---|
| `--new <name>` | name | Scaffold a new project under `projects/`. |
| `--brand <brand>` | brand | Brand to assign to the new project. |

```bash
kino projects                               # list
kino projects --new evidentcv --brand evidentcv
```

### `doctor`
Check the environment (dependencies + API keys).

```
kino doctor
```

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
kino brand evidentcv      # resolved styling values + guidelines
```

### `voices`
List ElevenLabs voices.

```
kino voices [--gender <g>]
```

### `avatars`
List Avatar-IV photo-avatar looks (usable for lip-sync).

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
Extract frames from any video — explicit timestamps, or evenly.

```
kino frames <video> [options]
```

| Option | Value | Meaning |
|---|---|---|
| `--at <list>` | seconds | Comma-separated timestamps. |
| `--out <dir>` | dir | Output directory. |
| `--montage` | — | Also tile the frames into one image. |
| `--every <sec>` | seconds | A frame every N seconds (when `--at` is omitted). |
| `--count <n>` | n | N frames spaced evenly (when `--at` is omitted). |

```bash
kino frames reference.mp4 --count 12 --montage
kino frames reference.mp4 --at 0,3.5,10
```
