<p align="center">
  <img src="https://pub-758bb8a866af4279b91def404a206e72.r2.dev/kino-logo-web.png" alt="kino — /ˈkiːnoʊ/ n. German: cinema, from Greek kīnēma: motion" width="560">
</p>

<p align="center"><em>Agent-driven short-form video production</em></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg" alt="Node ≥18">
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
<td width="33%" align="center"><a href="https://pub-758bb8a866af4279b91def404a206e72.r2.dev/kino-meta.mp4" title="Watch with sound"><img src="https://raw.githubusercontent.com/sdkv2/kino/04b9c59/demos/kino-meta.gif" width="240" alt="kino writing its own advert.json spec, live"></a></td>
<td width="33%" align="center"><a href="https://pub-758bb8a866af4279b91def404a206e72.r2.dev/the-descent-clip.mp4" title="Watch with sound"><img src="https://raw.githubusercontent.com/sdkv2/kino/04b9c59/demos/the-descent.gif" width="240" alt="The Descent — long-form kino build"></a></td>
<td width="33%" align="center"><a href="https://pub-758bb8a866af4279b91def404a206e72.r2.dev/lunara.mp4" title="Watch with sound"><img src="https://raw.githubusercontent.com/sdkv2/kino/04b9c59/demos/lunara.gif" width="240" alt="Lunara — quiet mood piece"></a></td>
</tr>
<tr>
<td align="center"><b>The self-demo</b><br><sub>kino types its own <code>advert.json</code> and builds the ad you're watching</sub><br><a href="https://pub-758bb8a866af4279b91def404a206e72.r2.dev/kino-meta.mp4">▶ watch with sound</a></td>
<td align="center"><b>The Descent</b><br><sub>a long-form build, well past the usual 30s spot</sub><br><a href="https://pub-758bb8a866af4279b91def404a206e72.r2.dev/the-descent.mp4">▶ watch full video with sound</a></td>
<td align="center"><b>Lunara</b><br><sub>stock b-roll and a quiet voiceover</sub><br><a href="https://pub-758bb8a866af4279b91def404a206e72.r2.dev/lunara.mp4">▶ watch with sound</a></td>
</tr>
</table>

<sub>Fictional sample brands. Each is a real, deterministic <code>kino build</code> — faceless, 9:16, ElevenLabs voiceover. Previews are silent trimmed GIFs; click any preview (or the ▶ links) to play the full MP4 <b>with sound</b> in your browser.</sub>

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
`setup.sh` is a guided installer: prerequisite checks (Node 18+, ffmpeg, ImageMagick — offers to
install what's missing), `npm install` / `build` / `link`, then an API-key walkthrough (written to a
`chmod 600`, git-ignored `.env`). Manual install:
```bash
cd ~/kino && npm install && npm run build && npm link
```
Requires Node 18+, ffmpeg/ffprobe (+ ImageMagick for storyboards). Real VO needs an
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
