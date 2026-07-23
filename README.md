<p align="center">
  <img src="https://pub-758bb8a866af4279b91def404a206e72.r2.dev/kino-logo-web.png" alt="kino — /ˈkiːnoʊ/ n. German: cinema, from Greek kīnēma: motion" width="560">
</p>

<p align="center"><em>Agent-driven short-form video production</em></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://github.com/sdkv2/kino/actions/workflows/ci.yml"><img src="https://github.com/sdkv2/kino/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@sdkv2/kino"><img src="https://img.shields.io/npm/v/@sdkv2/kino.svg?logo=npm&color=cb3837" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@sdkv2/kino"><img src="https://img.shields.io/npm/dw/@sdkv2/kino.svg?color=cb3837" alt="npm downloads"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg" alt="Node ≥20">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6.svg" alt="TypeScript">
  <img src="https://img.shields.io/badge/output-9%3A16%20MP4-black.svg" alt="9:16 MP4 output">
  <a href="https://try.elevenlabs.io/7t4pgbmyxq67" title="Referral — supports the project"><img src="https://img.shields.io/badge/voiceover-ElevenLabs-000?logo=elevenlabs&logoColor=fff" alt="Voiceover by ElevenLabs"></a>
</p>

---

**kino** turns an agent-authored JSON spec into a finished vertical video. The agent writes the
spec, kino renders it: ElevenLabs voiceover, an optional AI avatar (HeyGen / Hedra / Replicate)
or a **faceless** background, composited to a 9:16 / 3:4 MP4 by an in-house headless-Chrome
render engine.

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

<sub>Fictional sample brands. Each is a real, deterministic <code>kino build</code> — faceless, 9:16, ElevenLabs voiceover. Previews are silent trimmed clips; click any preview (or the ▶ links) to play the full MP4 <b>with sound</b> in your browser.</sub>

## Pipeline at a glance
```
spec.json ─▶ validate ─▶ voiceover (ElevenLabs) ─▶ avatar plan + trim
          ─▶ avatar (HeyGen/Hedra/Replicate) or faceless background / motion graphics
          ─▶ native render (headless Chrome) ─▶ ffmpeg ─▶ out/<title>/…mp4
```
No LLM inside the CLI: every step is deterministic, so the same spec renders the same video.

## Install
```bash
git clone https://github.com/sdkv2/kino.git ~/kino     # clone the toolchain once
cd <your-project> && bash ~/kino/setup.sh              # install `kino` + write a project .env
```
On Windows (or anywhere without bash): `node ~/kino/setup.mjs` — same installer, pure Node.
`setup.sh`/`setup.mjs` is a guided installer: prerequisite checks (Node 20+, ffmpeg, ImageMagick —
offers to install what's missing via brew/apt/winget), `npm install` / `build` / `link`, then an
API-key walkthrough (written to a `chmod 600`, git-ignored `.env`; re-runs keep existing keys).
Manual install:
```bash
cd ~/kino && npm install && npm run build && npm link
```
Requires Node 20+, ffmpeg/ffprobe (+ ImageMagick for storyboards). Real VO needs an
[ElevenLabs](https://try.elevenlabs.io/7t4pgbmyxq67) key (referral link — supports the project).
Faceless builds need only that. Avatar builds also need the avatar provider's key, plus
ElevenLabs whenever kino drives the voice (most setups).

## Quickstart
```bash
cd <project> && npx @sdkv2/kino init acme            # scaffold .env, brand.md, dirs + a sample spec
npx @sdkv2/kino doctor                               # preflight: API keys, ffmpeg/ffprobe, heygen CLI
npx @sdkv2/kino build projects/acme/specs/sample.json --mock  # free structural preview (no API spend)
npx @sdkv2/kino build projects/acme/specs/sample.json         # real render → projects/acme/out/sample/
```
`kino init` writes a ready-to-build faceless sample (provider `none`, $0), so the first
`kino build` works with no editing. Swap in your own spec once the preview looks right.

`npx` pulls Node deps fresh each first run — Puppeteer's Chromium is bundled. ffmpeg/ffprobe use
your system install if on PATH, otherwise fall back to a bundled binary automatically. For
frequent use, `npm i -g @sdkv2/kino` avoids the npx resolve overhead.

## Agent skills

Agent playbooks (`video-production`, `ad-voice`, `adversarial-critique`, …) are in
[`skills/`](skills/) — the only copy in the repo.

**From any project** (Cursor / Claude Code / Codex / …):

```bash
npx skills add sdkv2/kino
# or one skill:  npx skills add sdkv2/kino@ad-voice
```

**Inside a kino workspace** (after clone / `npm link`):

```bash
kino skills --install                 # local symlinks → .agents .cursor .claude .codex (gitignored; also run by kino init)
kino skills --install --agents cursor,claude
```

Agent fan-out dirs stay off git so they do not clutter the tree. Details: [`skills/README.md`](skills/README.md).

## Features
- **Avatar engines** — `none` (faceless, $0), `heygen` (Avatar-IV), `hedra` (Character-3),
  `replicate` (open-source lip-sync). Avatars are trimmed to on-camera segments to cut spend;
  VO + avatar are content-hash cached.
- **Faceless backgrounds** — `glow`, `image`, `mesh`, `aurora`, `particles`, `grid`, `custom` —
  frame-deterministic Canvas2D, auto-coloured from the brand.
- **Captions** — `phrase` (editorial block) or `words` (revealed word-by-word, synced to real VO
  timestamps, with active-word highlight + per-segment emphasis).
- **Fonts** — pick a name from `kino fonts` (fetched on demand from Google Fonts into
  `~/.kino/fonts/`), or use any raw CSS family.
- **Stock media** — `kino pexels` (video) and `kino photos` (stills) search Pexels (portrait-first)
  into project assets; same `PEXELS_API_KEY`. `.mp4` / `.jpg` work in app cut-ins.
- **Animated backgrounds & overlays** — backgrounds, logo, captions, and kickers are all tweenable
  on one keyframe layer (`backgroundKeyframes`/`logoKeyframes`/…), with timed `backgroundTriggers`.
- **Motion graphics** — author a self-contained HTML/CSS file in `assets/motion/`; kino drives it
  per-frame via CSS variables, with scrubbed `@keyframes` and a `.kino-cliptext` helper, sanitized
  and determinism-linted. See [docs/motion-graphics.md](docs/motion-graphics.md).
- **Branding & compliance** — logo mark + a per-mode AI `disclosure`; brand `bannedPhrases` fail
  the build (no guaranteed-outcome copy).
- **Inspect & iterate** — `inspect` (plan as JSON), `still`/`storyboard` (fast mock previews),
  `frames` (extract from a render). Built for tight agent loops.
- **Brands & projects** — `brands/<name>/brand.md` (markdown frontmatter + guidelines) is shared;
  every build runs inside a `projects/<name>/` (its own specs/assets/out + a `project.json` that
  assigns a brand). `kino init <brand>` scaffolds the first one; `kino projects --new` adds more.

## How kino drives motion graphics

There is no running timeline: kino seeks headless Chrome to frame *N*, sets CSS custom properties
on the graphic, and screenshots — every frame. The JSON spec owns the clock; the graphic is a
stateless canvas that reads the variables and paints that one frame, so the same spec always
renders the same pixels.

Each frame the graphic receives:

- `--progress` (`0 → 1` across the beat) plus eased curves — `--kino-out`, `--kino-inout`,
  `--kino-overshoot`, `--kino-spring`, and seam-safe `--kino-edge`
- `--pulse` — a fast-attack, decaying envelope fired by spec `triggers` (punches timed to VO words)
- `--<param>` — every key in the spec's `params`, tweened by `keyframes`
- brand palette + fonts (`--kino-mint`, `--kino-font`, …) and per-word voiceover timings
  (`--kino-words-shown` / `env.words`), so typed UIs land characters in sync with the speech

```json
{ "kind": "motion", "source": "motion/stat.html", "text": "Eighty-six percent match.",
  "params": { "pct": 0 },
  "keyframes": [{ "at": 0.2, "params": { "pct": 86 }, "ease": "overshoot" }],
  "triggers":  [{ "at": 0.2, "action": "pulse" }] }
```

Real CSS `@keyframes` work too: kino force-pauses all animations and scrubs `.kino-anim` elements
across the beat via a `--progress`-driven negative `animation-delay`. Three tiers by file extension:

| Source | Model |
|---|---|
| `.html` | declarative CSS reading the variable contract |
| `.js` | pure `render(env) → HTML`, re-evaluated per frame (loops, computed geometry) |
| `.json` | Lottie, frame-seeked with `goToAndStop` — stretched, looped, or word-fired by `triggers` |

Every graphic is lint-checked for determinism (no `transition`, timers, `Date.now`,
`Math.random`, network) and sanitized into a Shadow DOM before render. Full contract:
[docs/motion-graphics.md](docs/motion-graphics.md).

## Documentation
Longer guides are in [`docs/`](docs/):
- [Getting started](docs/getting-started.md) — install, scaffold, first render.
- [CLI reference](docs/cli-reference.md) — every command + flag.
- [Spec reference](docs/spec-reference.md) — the JSON spec, `brand.md`, `project.json`.
- [Motion graphics](docs/motion-graphics.md) — author custom animated beats/overlays in HTML/CSS.
- [Backgrounds & overlays](docs/backgrounds-and-overlays.md) — faceless backgrounds, logo, captions, kickers.

## Development
```bash
npm run build     # tsc → dist/
npm test          # vitest (run once);  npm run test:watch to watch
npm run dev -- <args>   # run the CLI from source via tsx
```
Work on a feature branch (`feat/…`, `fix/…`, `chore/…`), bump `version` in `package.json` for
releases, and open a PR to `main`. Version history lives in [`CHANGELOG.md`](CHANGELOG.md).
Full guidelines: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © sdkv2
