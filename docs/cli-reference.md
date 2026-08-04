# CLI reference

Every `kino` command, its arguments, options, and examples. Run `kino <command> --help` for the same option list inline. New to kino? Start with [Getting started](getting-started.md).

Most commands resolve their **project** automatically from the spec's path (`projects/<name>/specs/...`); pass `--project <name>` to override.

**One vocabulary.** A flag means the same thing on every command that has it:

| Flag | Always means | Spends? |
|---|---|---|
| `--draft` | fast, low-fidelity preview | never |
| `--real` | reuse the real voiceover cached by a previous `build --tts` — errors if there is none | never |
| `--tts` | buy real voiceover from ElevenLabs (`build` only) | **yes — the only flag that does** |
| `--format` | video shape: `9:16`, `3:4`, `16:9`, `-4k` for UHD | — |
| `--as` | file format of the output (`json`, `srt`, …) | — |
| `--out` | a path you choose, anywhere on disk | — |
| `--name` | a path inside the project's `assets/` | — |

`--mock` still works as a deprecated alias of `--draft`, as do `--format` for `--as` and `--out` for `--name`; only the new spellings appear in `--help`.

**Commands**

- Build & preview — [`build`](#build) · [`still`](#still) · [`storyboard`](#storyboard) · [`retune`](#retune) · [`batch`](#batch) · [`inspect`](#inspect)
- Project setup — [`init`](#init) · [`projects`](#projects) · [`doctor`](#doctor) · [`skills`](#skills) · [`update`](#update)
- Assets — [`segment`](#segment) · [`pexels`](#pexels) · [`photos`](#photos) · [`music`](#music)
- Discovery (what you can use) — [`colors`](#colors) · [`brand`](#brand) · [`voices`](#voices) · [`avatars`](#avatars) · [`fonts`](#fonts) · [`backgrounds`](#backgrounds) · [`elements`](#elements) · [`motion`](#motion)
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
| `--tts` | — | **The only flag that spends.** Adds real ElevenLabs voiceover (and a presenter, unless `--no-avatar`). Omit it and the build is silent, full quality, and free. |
| `--no-avatar` | — | With `--tts`: keep the voiceover, skip the presenter. No effect on a silent build — there was no presenter to drop. |
| `--draft` | — | Fast free preview rendered onto a **720p canvas** (same layout, fewer pixels — `KINO_DRAFT_EDGE` overrides). Always silent. `--mock` is a deprecated alias. |
| `--quality <preset>` | `standard\|very-high` | `very-high` supersamples the composite 2× (4× fill). |
| `--beat <n>` | 1-indexed | Render only beat n as a standalone clip. Not supported with `--tts`. |
| `--format <list>` | e.g. `9:16,3:4,16:9` | Comma-separated output formats. |
| `--provider <name>` | `none\|heygen\|hedra\|replicate` | Override the avatar engine for this render. |
| `--background <kind>` | `glow\|image\|mesh\|aurora\|particles\|grid\|custom` | Override the background. |
| `--font <name>` | font name | Override `brand.font` for this render (see [`fonts`](#fonts)). |
| `--project <name>` | project | Use `projects/<name>` (else inferred from the spec path). |
| `--tag <label>` | label | Suffix the output filename so variants are kept (auto-set from `--background`/`--font`). |

```bash
kino build specs/lie-test.json --draft                # free 720p preview
kino build specs/lie-test.json                        # free FULL-quality silent render → out/lie-test/
kino build specs/lie-test.json --tts                  # add real voiceover (bills ElevenLabs)
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
| `--format <fmt>` | `9:16\|3:4\|16:9` | Output format. |
| `--font <name>` | font name | Override `brand.font`. |
| `--project <name>` | project | Use `projects/<name>`. |
| `--real` | — | Use the real VO timings cached by a previous `kino build <spec> --tts`. Errors if there is none — it never buys voiceover itself. Pointless on a silent build: there the estimate *is* what renders. |
| `--platform <name>` | `tiktok\|reels\|shorts` | Overlay in-feed safe zones (right rail / bottom caption / top status) for QA — **guide only**; non-critical chrome (nav bars, docks) may sit in the shaded bands. Still-only — not on `build`. |
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
| `--format <fmt>` | `9:16\|3:4\|16:9` | Output format. |
| `--frames <n>` | number | Frames per beat (default `2`: composition + fully-revealed end-state; a 3rd/4th `·full` tile surfaces overflow/overlaps). |
| `--font <name>` | font name | Override `brand.font`. |
| `--project <name>` | project | Use `projects/<name>`. |
| `--real` | — | Use the real VO timings cached by a previous `kino build <spec> --tts`. Errors if there is none. |
| `--platform <name>` | `tiktok\|reels\|shorts` | Same safe-zone overlay as [`still`](#still) — guide only; protect hooks/CTAs, not decorative chrome. |

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
kino build specs/advert.json --tts      # produce real VO + word timings
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
| `--real` | — | Use the real VO word timings cached by a previous `kino build <spec> --tts`, instead of the estimate. Errors if there is none. |
| `--project <name>` | project | Use `projects/<name>`. |

```bash
kino inspect specs/lie-test.json          # fast, estimated timings
kino build   specs/lie-test.json --tts    # buy the voiceover once (fills the cache)
kino inspect specs/lie-test.json --real   # true ElevenLabs word timings, free from here on
```

---

## Project setup

### `init [brand]`
Scaffold the workspace (`.env`) plus a first project (with `specs/`, `assets/`, `out/`, a `project.json`, and a ready-to-build `specs/sample.json`). Builds require a project, so this produces a ready-to-build layout.

Naming a brand also scaffolds `brands/<brand>/brand.md` and assigns it in the project's `project.json`; the project is named after it. With no name, the project is `projects/default/` and **no brand is created** — the sample spec sets its own [`colors`](spec-reference.md#colour-scheme), which is all a build needs.

```
kino init [brand]
```

```bash
kino init                 # projects/default/, no brand
kino init acme            # brands/acme/brand.md + projects/acme/
```

### `projects`
List projects, or scaffold a new one.

```
kino projects [--new <name>] [--brand <brand>]
```

| Option | Value | Meaning |
|---|---|---|
| `--new <name>` | name | Scaffold a new project under `projects/`. |
| `--brand <brand>` | brand | Brand to assign to the new project (omit for a brandless project). |

```bash
kino projects                               # list
kino projects --new acme --brand acme
kino projects --new scratch                 # no brand — each spec sets its own `colors`
```

### `doctor`
Check the environment (dependencies + API keys) and whether agent skills are installed
for Cursor / Claude / Codex / `.agents`.

```
kino doctor
```

### `update`
Update kino in place, matched to how it was installed: a repo install (git clone + `npm link`)
does `git pull --ff-only` + `npm install` + `npm run build`; a global npm install runs
`npm install -g @sdkv2/kino@latest`; under `npx` there is nothing to update.

```
kino update
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

These commands print the contracts the driving agent reads before authoring a spec.

**All of them take `--as json`** — `brand`, `voices`, `avatars`, `fonts`, `backgrounds`, `elements`,
`transitions`. The JSON carries the same facts as the human listing plus the guidance notes, so an
agent gets `{ "ids": ["mesh", ...], "note": "stock presets (fine for drafts; easy AI tell)" }`
rather than having to parse the recommendation out of prose. Both renderings are built from one
constant per catalogue, so a listing can never advertise an id the spec would reject — that
property is tested, not just intended.

The default output stays human-readable; JSON is opt-in, so anything already reading these
listings as text keeps working.

```bash
kino backgrounds --as json | jq '.presets.mesh.params[].name'
kino elements --as json    | jq -r '.tweenChannels | join(", ")'
kino transitions --as json | jq -r '.builtIn[] | "\(.ids | join("/")) — \(.note)"'
```

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
List ElevenLabs voices. **Agents must run this before setting `voice` or `defaultVoice`** — search
the catalog for the most appropriate match to brand tone and avatar gender/age; never pick from
memory or reuse the same default across brands without searching.

```
kino voices [--gender <g>]
```

### `avatars`
List Avatar-IV photo-avatar looks (usable for lip-sync). See [Avatars & presenters](avatars.md).

```
kino avatars [--gender <g>]
```

### `fonts`
List the curated shortlist, search all of Google Fonts, or render a type specimen. Any Google Fonts
family works as `brand.font` — the shortlist is a recommendation, not a whitelist. See
[Fonts](spec-reference.md#fonts).

```
kino fonts
```

| Flag | Meaning |
|---|---|
| `--preview <family>` | Render a specimen still in 9:16 + 16:9 through the real caption pipeline and print the PNG paths. |
| `--brand <name>` | Preview against this brand's palette + caption size (default: kino house). |
| `--format <list>` | Preview formats (default `9:16,16:9`). |
| `--search <term>` | Search the full ~1800-family catalog by name/category. Needs `GOOGLE_FONTS_API_KEY`. |
| `--refresh` | Re-fetch the catalog instead of using the 7-day cache. |

```
kino fonts --preview "Space Mono"
```

### `backgrounds`
List animated backgrounds and their agent-controllable params + actions. See [Backgrounds & overlays](backgrounds-and-overlays.md).

```
kino backgrounds
```

### `colors`
List the stock colour schemes (`midnight`, `noir`, `paper`) with truecolor swatches, the five palette roles and what each paints, the six [UI roles](spec-reference.md#ui-roles) each preset derives for fabricating a product surface, and the ways a spec sets one. A build with no scheme (on the spec or a brand) still renders, on `midnight`, but validate warns about it. See [Spec reference → Colour scheme](spec-reference.md#colour-scheme).

```
kino colors
```

### `elements`
List overlay elements (captions, kickers, zoom, declared layers) and their layout/tween controls. See [Backgrounds & overlays](backgrounds-and-overlays.md#overlay-elements).

```
kino elements
```

### `motion`
Show how to author motion-graphic HTML files + the CSS-variable contract. See [Motion graphics](motion-graphics.md).

```
kino motion
```

### `bake <solver>`
Run a [simulation solver](spec-reference.md#simulation) once and report what it produced — row shape, how many rows are actually distinct, and the first and last. It also prints the full `sim` context an author codes against, including the bundled [solver stdlib](spec-reference.md#the-solver-stdlib) (`sim.lib.force` — d3-force), since a solver has no `require` and a stdlib nobody announces is a stdlib nobody uses. A build runs the solver itself, so this is not a pipeline step; it is how you see the bake before a render does, which matters because a solver's output is numbers rather than pixels. "The coins land in a pile" and "the coins all land at y=0 on frame 3" produce very different videos and identical builds.

```
kino bake motion/coins.sim.js --frames 60
kino bake motion/coins.sim.js --params '{"gravity":2200}' --seed 7 --out /tmp/coins.json
```

| Flag | Meaning |
|---|---|
| `--frames <n>` | Frames to solve (default: 3 seconds' worth). In a real build this defaults to the beat's own length. |
| `--fps <n>` | Rate the solver integrates on (default 30). |
| `--seed <n>` | PRNG seed for `sim.random()`. Restate it to reproduce a bake exactly. |
| `--format <id>` | Composition the solver sizes against (default `9:16`). |
| `--params <json>` | The author params the solver reads, as JSON. |
| `--out <file>` | Also write the rows to a JSON file. |
| `--as json` | Print the whole bake instead of the summary. |

---

## Assets

### `segment`
Generate object masks from an image or video for shader / `regionShader` use. Writes
`assets/masks/<name>/` (`mask.png` or `mask.mp4` + `manifest.json`). **Authoring** needs CoreML
(macOS) or CUDA (NVIDIA); **render** that consumes masks is cross-platform. Full guide:
[Segmentation](segmentation.md).

```
kino segment <input> --prompt <text> [options]
```

| Option | Value | Meaning |
|---|---|---|
| `--prompt <text>` | text | Object to segment ("the person"). Required. |
| `--objects <n>` | 1–4 | Cap objects packed into mask R/G/B/A (default `1`). |
| `--name <name>` | name | Subdir under `assets/masks/` (default: input basename). `--out` is a deprecated alias. |
| `--no-track` | — | Video: force per-frame (no temporal tracking). |
| `--backend <name>` | `coreml\|cuda\|mock` | Default: `coreml` on macOS, `cuda` elsewhere. `mock` = synthetic ellipse, any platform. |
| `--format <fmt>` | `json` | Machine-readable manifest on stdout (auto when non-TTY). |

**Capability note:** both real backends track video by default (`tracked:true`) — CoreML seeds a stateful CoreML tracker from the frame-0 text→mask, CUDA runs the full SAM3.1 multiplex predictor. `--no-track` selects CoreML's fast per-frame path (`tracked:false`), where fast motion can flicker. Pick by machine, not by capability: CoreML on Apple Silicon (~2.9s/frame), CUDA on NVIDIA (and the only path that handles long clips comfortably — see [Segmentation](segmentation.md) for VRAM budgets).

```bash
kino segment assets/clip.mp4 --prompt "the person"
kino segment photo.jpg --prompt "the car" --backend mock   # CI / non-Mac
```

### `pexels`
Search Pexels stock **videos** (portrait by default) and download one into a project's `assets/pexels/`.
Downloaded clips are referenced from `video` segments like any asset (`"source": "pexels/<id>.mp4"`).
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
| `--name <rel>` | path under `assets/` (default `pexels/<id>.mp4`); `--out` is a deprecated alias |
| `--project <name>` | project whose `assets/` receives the download (required for `--get`) |

### `photos`
Search Pexels stock **photos** (portrait by default) and download one into `assets/pexels/`.
Same key as `kino pexels`. Reference from `video` segments (`"source": "pexels/<id>.jpg"`).

```
kino photos "coffee desk morning light"                      # list: #, id, size, author, thumb
kino photos "coffee desk morning light" --get 2 --project x  # → assets/pexels/<id>.jpg
```

| Flag | Meaning |
|---|---|
| `--get <n>` | download result *n* from the search |
| `--count <n>` | results to list (default 8) |
| `--landscape` | search landscape instead of portrait |
| `--name <rel>` | path under `assets/` (default `pexels/<id>.jpg`); `--out` is a deprecated alias |
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
| `--as <fmt>` | `json\|srt\|vtt\|text` (default `json`) | Output format. `--format` is a deprecated alias. |
| `--out <file>` | path | Write to a file instead of stdout. |
| `--draft` | — | Offline canned transcript (no ffmpeg/network). `--mock` is a deprecated alias. |

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
| `--draft` | — | Offline canned transcript. `--mock` is a deprecated alias. |

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
