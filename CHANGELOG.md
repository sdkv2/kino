# Changelog

All notable changes to kino are documented here. This project uses semantic-ish
versioning; the authoritative version is the `version` field in `package.json`.

## [1.17.0] — Pexels stock b-roll + guided setup
- **`kino pexels <query>`** — search Pexels stock videos (portrait-first) and download one into a
  project's `assets/pexels/` with `--get <n>`; picks the smallest mp4 covering the 1080 render width.
  Needs a free `PEXELS_API_KEY`. Referenced from `app` segments like any asset (`.mp4` cut-ins
  already play with the same shots/transitions as stills).
- **setup.sh rewritten as a guided installer** — ASCII wordmark, prerequisite checks (Node 18+,
  ffmpeg, ImageMagick) with offered Homebrew/apt install, then a per-key walkthrough (purpose +
  where to get each key, required/optional, skip with Enter) and an end summary.
- `kino doctor` now checks `PEXELS_API_KEY`; the video-production skill documents when to reach for
  stock b-roll.
- New `kino-dark` brand (night variant of the kino spec-sheet look) and a `projects/showcase/`
  demo project with concept specs (`spec-in-video-out`, `feature-tour`, `broll-cutaways`).

## [1.16.0] — Require a project (BREAKING)
- **BREAKING:** removed the flat layout. Every build must run inside a `projects/<name>/` (with a
  `project.json`); building a spec outside a project now fails with guidance instead of silently
  using the workspace root.
- `kino init <brand>` now scaffolds the workspace **and** a first project (`projects/<brand>/`),
  rather than a flat layout.
- Internals: split `resolveWorkspace` (shared brands/cache) from `resolveProject` (project-required).

## [1.15.0] — Markdown brands
- Brands are now `brands/<name>/brand.md` (YAML frontmatter + guidelines body),
  replacing the old `brand.json`. Frontmatter is an optional subset merged over `DEFAULT_BRAND`.

## [1.14.0] — Procedural motion graphics (Tier 2)
- Motion graphics gain a procedural tier driven per-frame by kino.

## [1.13.0] — Motion graphics (Tier 1)
- Agent-authored HTML/CSS beats & overlays driven by kino-set CSS variables, deterministic in
  Remotion; scrubbed `@keyframes` (`class="kino-anim"`) and a `.kino-cliptext` helper.

## [1.12.0] — Video inspection
- External reference-video analysis: `transcribe` / `scan`; `frames` extraction flags.

## [1.11.1] — App cut-in backdrop
- Brand backdrop rendered behind app cut-ins in avatar mode.

## [1.11.0] — Word-caption polish
- Highlight the active word and render the brand name in brand green in word captions.

## [1.10.0] — Replicate default model
- Default Replicate avatar model is now `bytedance/omni-human`.

## [1.9.2] — Replicate provider fix
- Make the Replicate provider actually run end-to-end.

## [1.9.1] — Inter-beat gap hold
- Hold visuals through the inter-beat VO gap (no bare-background flash).

## [1.9.0] — Easing
- Spring + overshoot keyframe easing.

## [1.8.1] — Relative caption keyframes
- Per-segment caption/kicker keyframes are segment-relative.

## [1.8.0] — Tweenable captions & kickers
- Captions and kickers join the shared keyframe system (every overlay tweenable).

## [1.7.0] — Configurable logo
- Configurable + tweenable logo (`AnimatedElement`).

## [1.6.0] — Animatable backgrounds
- Agent-animatable backgrounds; word timestamps surfaced in `inspect`.

## [1.5.0] — Projects
- `projects/<name>/` brand-assignable file scoping.

## [1.4.1] — Font override
- `--font` override for `build`/`still`/`storyboard`.

## [1.4.0] — Font library
- On-demand font library; `-font` labels.

## [1.3.0] — Agent inspection
- `inspect` / `still` / `storyboard` / `frames` commands.

## [1.2.0] — Word-synced captions
- Real per-word timestamps + caption effect kit.

## [1.1.0] — Output tagging
- Variant output tagging so renders don't overwrite each other.

## [1.0.0] — Initial release
- spec → VO (ElevenLabs) → avatar (HeyGen) → Remotion composite → MP4.
