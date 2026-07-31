<p align="center">
  <img src="https://pub-758bb8a866af4279b91def404a206e72.r2.dev/kino-header-hq4.webp" alt="kino — spec driven video engine" width="900">
</p>

<p align="center"><em>the video engine · spec driven video development · /ˈkiːnoʊ/</em></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Source--Available-blue.svg" alt="License: Source-Available"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg" alt="Node ≥22">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/spec%20%E2%86%92%20MP4-black.svg" alt="spec → MP4">
  <a href="https://try.elevenlabs.io/7t4pgbmyxq67" title="Referral — supports the project"><img src="https://img.shields.io/badge/voiceover-ElevenLabs-000?logo=elevenlabs&logoColor=fff" alt="Voiceover by ElevenLabs"></a>
</p>

---

**kino** is a video engine: a framework you author in and a renderer that turns what you wrote
into a finished MP4. You (or an agent) write a JSON spec; kino renders it — ElevenLabs voiceover,
a background or motion graphic, and an optional AI presenter (HeyGen / Hedra / Replicate),
composited frame-by-frame by a GL compositor in Electron (9:16, 3:4, 16:9, …). Same spec → same frames.

The spec is the source; the MP4 is the build artifact. Edits are spec edits and a rebuild, not
timeline drags — so revisions diff, review, and version like code.

## Showcase

<table>
<tr>
<td width="33%" align="center"><a href="https://pub-758bb8a866af4279b91def404a206e72.r2.dev/kino-meta.mp4" title="Watch with sound"><img src="https://pub-758bb8a866af4279b91def404a206e72.r2.dev/kino-meta-hq.webp" width="240" alt="kino writing its own advert.json spec, live"></a></td>
<td width="33%" align="center"><a href="https://pub-758bb8a866af4279b91def404a206e72.r2.dev/the-descent-clip.mp4" title="Watch with sound"><img src="https://pub-758bb8a866af4279b91def404a206e72.r2.dev/the-descent-mg3.webp" width="240" alt="The Descent — motion graphics from a long-form kino build"></a></td>
<td width="33%" align="center"><a href="https://pub-758bb8a866af4279b91def404a206e72.r2.dev/lunara.mp4" title="Watch with sound"><img src="https://pub-758bb8a866af4279b91def404a206e72.r2.dev/lunara-hq.webp" width="240" alt="Lunara — quiet mood piece"></a></td>
</tr>
<tr>
<td align="center"><b>The self-demo</b><br><sub>kino types its own <code>advert.json</code> and builds the ad you're watching</sub><br><a href="https://pub-758bb8a866af4279b91def404a206e72.r2.dev/kino-meta.mp4">▶ watch with sound</a></td>
<td align="center"><b>The Descent</b><br><sub>real footage into the motion-graphics finale of a 66s build</sub><br><a href="https://pub-758bb8a866af4279b91def404a206e72.r2.dev/the-descent.mp4">▶ watch full video with sound</a></td>
<td align="center"><b>Lunara</b><br><sub>stock b-roll and a quiet voiceover</sub><br><a href="https://pub-758bb8a866af4279b91def404a206e72.r2.dev/lunara.mp4">▶ watch with sound</a></td>
</tr>
</table>

<sub>Fictional sample brands. Each is a real, deterministic <code>kino build</code> from a JSON spec, with ElevenLabs voiceover. Previews are silent trimmed clips; click any preview (or the ▶ links) to play the full MP4 <b>with sound</b> in your browser.</sub>

## Pipeline at a glance
```
spec.json ─▶ validate ─▶ voiceover (ElevenLabs) ─▶ presenter plan + trim
          ─▶ background / motion graphics, plus an optional presenter (HeyGen/Hedra/Replicate)
          ─▶ native render (Electron + GL compositor) ─▶ ffmpeg ─▶ out/<title>/…mp4
```
No LLM inside the CLI: every step is deterministic, so the same spec renders the same video.

## Requirements

| Requirement | Why |
|---|---|
| **Node 22+** | runtime (the CLI is ESM) |
| **ffmpeg / ffprobe** | audio muxing, frame extraction — a bundled binary covers you if neither is on `PATH` |
| **ImageMagick** (`magick`) | optional — storyboard contact sheets + frame montages |
| **ElevenLabs API key** | voiceover — required for any real (non-`--mock`) build with spoken lines |
| HeyGen / Hedra / Replicate key | optional — only if a beat asks for an AI presenter |

`kino doctor` checks all of the above. The full local install (below) also npm-links the `kino`
command onto your `PATH` — including patching your shell rc if npm's global bin dir isn't on
`PATH` already (e.g. a sudo-free `~/.npm-global` prefix, common on Debian/Raspberry Pi OS).

## Quickstart
The real one-liner — npm resolves the published package and manages `PATH` itself, no build
step, no shell-rc surgery:
```bash
npm install -g @sdkv2/kino
```
Trying it on a single spec without installing anything globally? `npx @sdkv2/kino <command>`
runs the same published package on demand (re-resolves on each first run of a session, so
`-g` is worth it once you use kino regularly):
```bash
cd <your-project>
npx @sdkv2/kino init                                              # scaffold .env, dirs + a sample spec
npx @sdkv2/kino build projects/default/specs/sample.json --draft  # free structural preview, no API spend
npx @sdkv2/kino build projects/default/specs/sample.json          # real render → projects/default/out/sample/
```
(drop the `npx @sdkv2/kino` prefix for plain `kino` once installed with `-g`)

`init` writes a ready-to-build sample (no presenter, provider `none`, $0) — the first build works with
no editing. Swap in your own spec once the preview looks right. Set a colour scheme with
`"colors": "midnight" | "noir" | "paper"`, or your own roles (`kino colors`) — recommended on every
spec (unset falls back to `midnight` with a warning); name a brand (`kino init acme`) when several
specs should also share tone, fonts and disclosures.

See [Requirements](#requirements) above for what you need — `kino doctor` checks all of it.
Get an ElevenLabs key via [this referral link](https://try.elevenlabs.io/7t4pgbmyxq67) (supports
the project).

Working on kino itself, or want `kino update` (git pull + rebuild) and native module rebuilds?
Those need a full source checkout, not the published package — heavier than the one-liner above
(clones the repo, then `npm install && npm run build && npm link`), but it's the right call for
development or tracking `main`:
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/sdkv2/kino/main/install.sh)
```
Windows, a non-default install path, or the guided API-key walkthrough in detail:
[getting started](docs/getting-started.md).

## Agent skills

Playbooks that teach a coding agent to write specs (`video-production`, `ad-voice`,
`motion-design`, `shader-backgrounds`, …) live in [`skills/`](skills/).

```bash
npx skills add sdkv2/kino    # from any project — Cursor / Claude Code / Codex / …
kino skills --install        # inside a kino workspace — symlinks into .agents .cursor .claude .codex
```

Details: [`skills/README.md`](skills/README.md).

## Features
- **Presenters as a video source** — a beat asks for one with `"source": "avatar:"` (or pins
  `heygen:`/`hedra:`/`replicate:`). Trimmed to on-camera beats to cut spend, and content-hash cached.
- **Backgrounds** — `glow`, `image`, `mesh`, `aurora`, `particles`, `grid`, `custom`,
  auto-coloured from the brand. Plus WebGL shaders and `kino segment` masking.
- **Captions** — an editorial block, or word-by-word revealed against real VO timestamps.
- **Motion graphics** — HTML/CSS/JS/Lottie beats driven per-frame, sanitized and determinism-linted.
- **Animated everything** — backgrounds, logo, captions, and kickers tween on one keyframe layer.
- **Fonts & stock media** — any Google font by name (`kino fonts`); Pexels video and stills
  (`kino pexels`, `kino photos`) pulled straight into project assets.
- **Colour schemes** — three stock palettes or your own five roles, set per spec (`kino colors`).
  An unset scheme still builds, on kino's house palette, but validate warns about it.
- **Branding** — optional brand-wide palette, fonts, logo, AI `disclosure`, and a Tone/Voice style
  guide (banned phrases included) for the authoring agent to follow.
- **Inspect & iterate** — `inspect` (plan as JSON), `still`/`storyboard` (free previews),
  `frames` (extract from a render). Built for tight agent loops.
- **Brands & projects** — an optional shared `brand.md` per brand; every build runs inside its own
  `projects/<name>/` with separate specs, assets, and output.

## How kino drives motion graphics

There is no running timeline. kino seeks to frame *N*, resolves `params` /
`keyframes` / `triggers` on a **beat-relative clock**, rasterizes the markup
into a WebGL compositor layer, and captures the finished frame from the stage
canvas. The spec owns the clock; the graphic is a stateless canvas that reads
the variables and paints that one frame, so the same spec renders the same pixels.

```json
{ "kind": "motion", "source": "motion/stat.html", "text": "Eighty-six percent match.",
  "params": { "pct": 0 },
  "keyframes": [{ "at": 0.2, "params": { "pct": 86 }, "ease": "overshoot" }],
  "triggers":  [{ "at": 0.2, "action": "pulse" }] }
```

Each frame the graphic gets `--progress` (`0 → 1` across the beat) and eased curves off it, a
`--pulse` envelope fired by `triggers`, every `params` key tweened by `keyframes`, and the brand
palette, fonts, and per-word VO timings — so typed UIs land characters in sync with the speech.
Three tiers by file extension:

| Source | Model |
|---|---|
| `.html` | declarative CSS reading the variable contract |
| `.js` | pure `render(env) → HTML`, re-evaluated per frame (loops, computed geometry) |
| `.json` | Lottie, frame-seeked with `goToAndStop` |

Full contract, including the determinism lint: [docs/motion-graphics.md](docs/motion-graphics.md).

## Documentation
Longer guides are in [`docs/`](docs/):
- [Getting started](docs/getting-started.md) — install, scaffold, first render.
- [CLI reference](docs/cli-reference.md) — every command + flag.
- [Spec reference](docs/spec-reference.md) — the JSON spec, `brand.md`, `project.json`.
- [Motion graphics](docs/motion-graphics.md) — author custom animated beats/overlays in HTML/CSS.
- [Backgrounds & overlays](docs/backgrounds-and-overlays.md) — backgrounds, logo, captions, kickers.
- [Segmentation](docs/segmentation.md) — `kino segment` masks and `regionShader`.

## Development
```bash
npm run build     # tsc → dist/
npm test          # vitest (run once);  npm run test:watch to watch
                  # GPU pixel + CoreML tests are separate: npm run test:gpu / test:metal
npm run dev -- <args>   # run the CLI from source via tsx
```
Work on a feature branch (`feat/…`, `fix/…`, `chore/…`), bump `version` in `package.json` for
releases, and open a PR to `main`. Version history lives in [`CHANGELOG.md`](CHANGELOG.md).
Sign off your commits (`git commit -s`) and add yourself to the
[CLA signatures](.github/CLA.md#signatures) on your first PR.
Full guidelines: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Source-Available](LICENSE) © sdkv2 — free for individuals, non-profits, and teams ≤ 3. A company licence is required for for-profit teams of 4+ ([details](LICENSE)). The spec format schema remains open under the MIT licence.

"kino", the wordmark, and the logo are trademarks of sdkv2 and are not covered by the software licence.
Fork freely; give your fork its own name. Questions: open an issue.
