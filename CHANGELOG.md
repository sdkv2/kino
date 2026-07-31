# Changelog

All notable changes to kino are documented here. This project uses semantic-ish
versioning; the authoritative version is the `version` field in `package.json`.

## [Unreleased]
- **Colour schemes in the spec — and brands are no longer the only way to set a palette.** A spec now
  carries `colors`: a preset name (`"midnight"`, `"noir"`, `"paper"`), a block of roles
  (`{ bg, fg, accent, accent2, deep }`, legacy names still accepted), or a preset with per-role
  overrides. A named preset replaces all five roles; role keys layer on top. `kino colors` lists them
  with swatches. A brand is now for what several specs should *share* — tone/voice, fonts,
  disclosures, voice aliases — not the price of admission for five hex values.
- **BREAKING: a build must declare a colour scheme.** Validation fails when a spec sets no `colors`
  **and** no brand declares any (including a `brand.md` with no `colors` block — inheriting the house
  palette by omission is not a choice). Previously a brandless spec silently rendered in kino's own
  navy-and-mint and looked deliberate. The check runs first, before any asset walk or API spend; the
  message names both fixes. Add `"colors": "midnight"` to keep the old look exactly.
- **`kino init` no longer scaffolds a brand unless you name one.** Bare `kino init` creates `.env` +
  `projects/default/` with a sample spec that sets its own `colors`, and no `brands/` directory.
  `kino init acme` behaves as before.
- **Kicker ink and caption stroke are derived from the palette** instead of hardcoded around a dark
  base: a pill's text colour now comes from the chip's contrast, and the `stroke` caption halo from
  the ink's. Both were near-black constants that turned a light scheme into black-on-black. Every
  palette with a light `fg` — i.e. every one predating this change — resolves to exactly the old
  values, so existing renders are unaffected.
- **Any Google Fonts family:** `brand.font`, `brand.labelFont`, `project.json`'s `font`, `--font` and
  `kino glyphs --font` now accept **any** family on Google Fonts, not just the 14 curated names. The
  curated list was never a technical limit — the downloader could always fetch any family — so it is
  now what it always claimed to be: a shortlist with hand-tuned caption weights. An unknown family
  downloads at weight 700, falling back to its regular face if it ships nothing that heavy. A value
  with a comma in it is treated as a raw CSS stack and passes through untouched, as before.
- **Fixed: the brand font never reached any caption.** Every text surface in the compositor
  (`captionMarkup`, `kickerMarkup`, `textMarkup`, `disclosureMarkup`) wrapped the whole font *stack*
  in single quotes, so `font-family` asked for one family literally named `"KinoBrandFont", "Anton",
  …` — which matches nothing, silently dropping every caption, kicker, overlay and disclosure to
  `sans-serif`. Brand fonts now actually render. **Expect captions to look different** (correctly so)
  in any build whose brand sets a `font`.
- **`kino fonts --preview <family>`:** renders a type specimen still in 9:16 and 16:9 through the real
  caption pipeline — the brand's own colours, caption size and stroke — and prints the PNG paths, so a
  font can be judged before committing it to a build. `--brand` picks the palette, `--format` the
  aspect ratios.
- **`GOOGLE_FONTS_API_KEY` (optional):** with a key, `kino fonts --search <term>` searches the full
  ~1800-family catalog by name and category, family names are casing-corrected, an unresolvable name
  gets a "did you mean", and a family's real available weights pick the caption cut instead of the
  flat 700 default. Everything else works without a key. `kino fonts --refresh` re-fetches the
  7-day-cached catalog; `kino doctor` reports the key as optional.
- Font cache files are now named per cut (`~/.kino/fonts/<family>-<weight>.ttf`). Pre-existing
  unsuffixed files are still read, so no font re-downloads on upgrade.
- **Role-keyed brand palette:** `brand.md` colors are now named by role — `bg`, `fg`, `accent`,
  `accent2`, `deep` — instead of the old literal hues (`night/white/mint/gold/green`), which
  lied the moment a brand's accent wasn't mint. The literal names remain accepted in brand.md,
  stay injected as `--kino-mint`-style CSS-var aliases, and stay present in `env.palette`, so
  every existing brand and motion page renders identically. Kicker `color` accepts both
  vocabularies (`accent|deep|accent2` canonical). Internal `Brand.colors`/`Theme` are role-keyed.
- **`kino sync` — beat-synced cuts:** retimes visual beats so every cut (and the video end)
  lands on the music bed's beat grid. Detection is local to the playback window (kick-band
  onset envelope → autocorrelation + comb fit, `src/media/beats.ts`); `--grain beat|bar`,
  `--min-dur`, `--dry-run`. VO beats keep their spoken length and the next visual beat
  re-anchors.
- **`music.startSec`:** play the bed from a sample-accurate offset into the source file.
  `kino sync --offset auto` sets it to the loudest on-grid window so the piece opens on a hit.
- **`audio-markers` beat grid:** markers JSON gains `grid: { bpm, periodSec, phaseSec,
  strength } | null` — a 10 ms-precision fit (onsets stay 0.1s-quantized).

## [3.1.0] — Custom beat transitions and motion authoring feedback
- **Custom beat transitions:** a shader transition library (`kino transitions`) — CRT collapse, film
  scorch, geo facade, iris, optic prism, organic inkbleed, paper tear, print halftone — plus
  camera-carry across beat boundaries and richer authoring feedback (motion lint, motion QA,
  velocity probing/dumping) surfaced through `kino motion` and `kino still`.
- **Glyph outlines as SVG path data:** `kino glyphs` extracts font glyph outlines for use as motion
  paths.
- **Declarative path morphing:** multi-stop path morphing, central-difference velocity, `<use>`
  support, and opt-in font cuts for Tier-1 motion.
- **`kino-smear` helper class** and velocity annotation scoped to tags; injected `kino` filter defs
  for SVG attribute references.
- **Tier-2 proc stdlib (`env.lib`):** d3-shape (`env.lib.shape`), culori (`env.lib.color`), and
  deterministically seeded simplex noise (`env.lib.noise2D/3D/4D`, `env.lib.seedNoise`) are bundled
  into the render page and handed to every `render(env)`. All three are pure and add no new engine
  surface — same eval site, same per-frame sanitizer; noise is seeded from a fixed PRNG so renders
  stay reproducible.
- Segment `text` is now optional so a purely visual beat can set its own length; default-on camera
  motion blur and a directional smear / RGB-split filter library.

## [3.0.0] — Electron renderer and GL compositor
- **BREAKING: Puppeteer renderer removed.** Electron offscreen capture is the only render path on
  all platforms. `KINO_RENDERER=puppeteer` is gone; `kino doctor` reports the resolved Electron
  capture backend.
- **GL compositor is production-default:** linear-light blending, per-beat masks/effects, shader
  transitions, full-frame post FX (`postFx`: grade → bloom → lens → film), and GPU liquid-glass
  compositing over the compositor backdrop.
- **Layer-as-mask compositing:** `mask.source.kind: "layer"` plus inverted masks enable
  text-behind-subject (title under a segmented presenter). `kino segment --cutout` writes transparent
  RGBA cutouts to `assets/cutouts/`.
- **Linux offscreen capture:** one Electron host with N offscreen windows; `auto` resolves to
  `direct` (not `readback` — benchmarked 2× slower on NVENC due to GPU readback). Opt-in hardware
  capture via `KINO_ELECTRON_CAPTURE=readback`. Worker ceiling 4 (override with `KINO_CONCURRENCY`).
- **Supersampling:** `--quality very-high` enables motion-graphic supersample; `KINO_SHADER_FXAA`
  honoured again. Stills wipe `out/<spec>/stills/` before each render so QA never reads stale PNGs.
- SAM scripts moved to `scripts/sam/` (CoreML setup for Apple Silicon segmentation).

## [2.0.0] — node 22 minimum
- **Node ≥22 required**: `engines` bumped to `>=22`; `doctor`, `setup.sh`, `setup.mjs`, docs, and badge updated.
- Workspace detection accepts `projects/` or `brands/` (brands optional since 1.21) — projects-only
  workspaces no longer fail with "No brands/ found".
- `atWord` anchors on motion `keyframes`/`triggers` (word text or index) — resolved against each
  build's VO timings, so word-synced moments never need a mock→real retune.
- `kino still --segment N --word <w>` centers a sheet on a spoken word; `--grid` overlays a
  rule-of-thirds grid for composition QA.
- `--kino-words-shown` is now continuous (fraction into the current word's span) — word-gated CSS
  reveals ease instead of stepping.
- Motion `params` act as an implicit t=0 keyframe: a lone keyframe tweens from the base value
  (background/zoom/caption tracks keep the one-keyframe-holds idiom).
- Build warns when a full-screen motion beat barely animates (3-point probe-frame diff) and when a
  segment `caption` is authored under a resolved words-mode (it would never paint).
- `kino update` — self-update matched to the install: repo clone pulls + rebuilds, global npm
  reinstalls `@latest`, npx explains there's nothing to update.
- Segment `voFile` — import a recorded voiceover per beat instead of TTS. Word timings via
  ElevenLabs Scribe or **local whisper.cpp** (`KINO_STT` selects; model auto-downloads once);
  all-`voFile` specs build real with no ElevenLabs key. Mock builds pace spec text over the
  file's true duration, free and offline.

## [1.21.1] — node 20 floor
- **Node ≥20 required**: `engines` bumped from 18 (EOL) to 20; setup.sh, docs, and badge now agree.

## [1.21.0] — optional brand
- **Brandless projects**: `kino projects --new <name>` no longer requires `--brand`. `project.json`
  `brand` is now optional; without one, builds run on kino house defaults (`DEFAULT_BRAND`).

## [1.20.0] — project-local music beds
- **Project-local audio**: the shared music library ships empty (matching SFX). Source beds
  per-project — asset paths (`music/bed.mp3`), drop-in CC0 beds in `assets-lib/music/` for bare
  ids, or `kino music "<query>"` Freesound search.

## [1.19.0] — retune, seamless loops, platform safe-zones, and batch variants
- **Motion bare ids**: `"source": "prompt-type"` resolves from `assets-lib/motion/` (like SFX).
- **`kino retune`**: rewrite motion/`backgroundTriggers` `at` times from real VO word timings.
- **`seamlessLoop`**: spec flag + validate guidance + post-build first/last-frame seam warn.
- **`still`/`storyboard --platform`**: TikTok / Reels / Shorts safe-zone overlay for in-feed QA.
- **`kino batch` variants**: `{ "base", "variants": [{ "tag", "set" }] }` patches + tagged builds.

## [1.18.1] — SFX/music bed, audio markers, and skill fan-out
- **`sfx`/`music` spec fields**: free-placed sound-effect events and an auto-ducked music bed
  (volume, duck level, tail fade) mixed into the Remotion render, resolved from a shared
  `assets-lib/sfx/`/`assets-lib/music/` library (bare id) or a project asset (path).
- **`kino audio-markers`**: analyzes any audio/video file into `{ rms, onsets, peaks, silences }`
  JSON plus waveform/spectrogram PNGs, so SFX and music can be placed against real audio structure
  instead of guessed timestamps.
- **`kino music`**: lists bundled CC0 beds or searches Freesound (15–90s, short-form) for a track.
- **`kino photos`** + a Pexels thumbnail preview for `kino pexels`, and a `--kino-label-font`
  motion CSS var.
- **`captionReveal: "word"|"all"`**: words-mode captions can now lay out the whole line at once
  (highlight tracks VO) instead of only revealing word-by-word; storyboard gained a full-reveal
  frame per beat.
- **`ad-voice` and `adversarial-critique` skills** shipped alongside `video-production`, plus
  `kino skills --install` fan-out into Cursor/Claude/Codex/`.agents` skill dirs.
- ElevenLabs TTS now defaults to `eleven_v3` (inline audio tags); opt into `eleven_multilingual_v2`
  for metronome-critical reads.

## [1.18.0] — Cinematic finish + full-frame caption cards
- **Film-finish pass**: every render gets a luminance-adaptive vignette + deterministic grain that
  grades footage, backgrounds and the avatar into one cohesive image — paper texture on light brands,
  film grain on dark, never a glow. Frame-deterministic (fixed-seed `feTurbulence` + per-frame
  translate, painted at half res) so it's cache-safe and fast, and it sits *below* the motion-graphic
  and caption layers so designed graphics and type stay crisp (motion beats keep managing their own
  finish via the opt-in `.kino-grain` / `.kino-vignette` utilities).
- **Faceless talking beats now center their captions** at optical centre (hero scale) instead of the
  lower-third band — the text fills the frame instead of floating over an empty top two-thirds.
- **Richer backgrounds**: `particles` gains drifting brand-colour nebula clouds + more density; the
  default `glow` is a brighter three-glow on a graded base; the centre scrim is now luminance-adaptive
  (fixes both the dark-brand black-holes and the light-brand washout).
- Tighter caption/hero kerning; slightly deeper avatar push-in.
- Showcase trailer fix: dropped an un-recolored grey placeholder Lottie overlay (off-brand and
  non-transparent — violated the overlay transparency rule).

## [1.17.1] — Typeface + caption legibility
- Font registry: **Space Grotesk** (technical geometric sans) and **IBM Plex Mono** (editorial
  monospace) — the kino/kino-dark brands now use them (captions/labels) instead of Inter.
- kino/kino-dark brands enable the lower-third caption backplate (`captionStyle.background`) so
  captions stay legible over dark/photographic footage; skill documents the legibility check.
- Showcase `broll-cutaways` demo now cuts to real Pexels footage (downloads git-ignored).

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
