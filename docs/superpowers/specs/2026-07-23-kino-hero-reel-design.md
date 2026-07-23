# Design — `nothing-here-was-filmed` (kino shader hero reel)

**Date:** 2026-07-23 · **Branch:** `feat/shader-background`

## Goal

An ambitious faceless vertical reel that **is** a `kino build` and whose subject is the
render tech that made it — dogfooding every video-visible feature added on
`feat/shader-background`. Through-line: *one JSON spec → cinematic 3D, deterministically.*
Each beat flexes a different shader **and** advances that claim, so the piece reads as a
statement, not a feature checklist (the "AI-ad-template" generic-tell the `motion-design`
skill warns against).

Quality bar is the `glass-morph` demo, **not** the throwaway `shader-demo` test fixtures:
motion locked to speech via `atWord`, SDF-rim glass (no CSS borders that ghost), `.kino-camera`
velocity blur, `data-measure` alignment QA, dual-format.

## Fixed parameters

- **Title:** `nothing-here-was-filmed`
- **Brand:** `kino` (night `#0b1020`, mint `#80e2b4`, green `#0c8d64`, gold `#d99a20`; Inter + IBM Plex Mono)
- **Format:** `["9:16", "16:9"]` (dual-format; motion beats adapt via `--kino-aspect`)
- **Faceless:** `provider: none`, VO over shader backgrounds
- **Brand rules:** `film: 0`, `voiceModel: "eleven_multilingual_v2"` (metronome-stable — required when on-screen motion locks to VO)
- **Runtime:** ~26s, 6 beats
- **Location:** `projects/kino-hero-reel/` (`project.json → brand: kino-reel`)
- **Brand:** `kino-reel` = the `kino` brand minus the auto-placed faceless logo (the R2 logo PNG
  is a light boxed wordmark, wrong as an overlay mark; the reel renders "kino" as styled text on
  the surfaces instead) and with a smaller caption size (56) for lower-third kickers.

### Structure — stitched reel (one shader per spec)

kino resolves `background`/`backgroundComponent` **top-level only** (`schema.ts` rejects them as
segment fields), and `batch` renders many specs but does not concatenate. So five shader
*backgrounds* cannot share one `kino build`. The reel is therefore **six single-beat section
specs**, each in its native shader background, stitched by `build-reel.sh` (render ×6 →
ffmpeg xfade + acrossfade → `nothing-here-was-filmed-<fmt>.mp4`, per format). Deliverable command
is `./build-reel.sh` (with a free `--mock` dry-run), not `kino build advert.json`.

## Palette — "kino-aurora"

Night `#0b1020` base. Per-beat `colorA/B/C` drawn from indigo `#4b3bd6`, kino-mint `#80e2b4`,
kino-gold `#d99a20`, plus cyan `#29e0ff` where the glass wants a cold refraction split. Keeps
kino's mint+gold signature while adding indigo/cyan depth so `liquid-glass` dispersion actually
punches (pure mint/green reads monochrome-teal). Set per beat via `backgroundKeyframes` at `t=0`.

## Beats

| # | ~s | Surface | Feature proven | VO (draft) |
|---|----|---------|----------------|------------|
| 1 | 3 | `aurora-flow` bg (avatar) | aurora-flow shader | "Nothing here was filmed." |
| 2 | 4 | `liquid-orb` bg (avatar) | raymarched metaball, fresnel rim, orbit cam, `uPulse` | "Every frame is 3D — raymarched from one spec file." |
| 3 | 7 | `card-render` (custom .frag) bg + tex (avatar) | texture **live-scrub typewriter** — scan bar draws the empty editor, then the spec **types itself in char-by-char** | "This card is the actual spec — a real interface element, handed straight to the shader as a texture." |
| 4 | 4 | `orb-badge` bg + tex (avatar) | texture **static** + 3D cylindrical decal wrap + correct occlusion | "So your own interface can ride a live 3D surface." |
| 5 | 5 | `player.html` (motion) | **`--t` real clock** + cam easing + `.kino-camera` blur + `--kino-aspect` | "Same spec in, same frames out — every single time." |
| 6 | 5 | `liquid-glass` bg + `kino-glass` overlay (avatar) | refractive drop **+ real-refraction material stacked** | "Cinematic 3D. One build command." |

### Beat mechanics

- **1 — aurora title.** `background: custom / aurora-flow`, low intensity. `texts[]` overlay reveals
  the wordmark **kino** (center, blur-in, minimal style) as the payoff of the VO. No logo PNG
  dependency — rendered as styled text (brand assets dir is empty; the logo lives on R2).
- **2 — liquid-orb.** `background: custom / liquid-orb`, `backgroundIntensity: 0.85`. `backgroundKeyframes`
  set the palette; one `backgroundTrigger` `pulse` flashes the fresnel rim on a beat accent. Sparse
  kicker overlay ("raymarched · deterministic").
- **3 — spec card (`card-render`).** *(v2 — the `ui-hero` shard-dissolve + floor-reflection presentation
  was rejected; replaced with a purpose-built shader.)* `background: custom / backgrounds/card-render.frag`
  — a project-local shader that floats the DOM card on a gently-yawing 3D plane and **draws it in with a
  bright scan bar** (top→bottom, driven by a `scan` param), plus faint scanlines + a lit edge rim; **no
  dissolve, no floor reflection.** The card (`motion/spec-card.html`) is the `advert.json` **spec itself**
  — a mini code editor whose highlighted `"backgroundComponent": "card-render"` line names the very shader
  drawing it. `backgroundTextures: [{ source: "motion/spec-card.html", param: "fill" }]`. **`fill` drives a
  real CSS typewriter**: each code line is a monospace overflow-clip whose width `steps()` 0→Nch across its
  slice of the 1s scrub timeline, with a mint caret riding the frontier via `border-right` — so the spec
  types itself in character-by-character, per-frame, through the live-scrub. `backgroundKeyframes`: `scan`
  0 → 1 over ~0.3–1.1s (window frame scans in first), then `fill` 0 → 1 over ~1.3–6.4s (the typing). The
  strongest possible demo of live-scrub: DOM re-rasterized every frame, not a static texture.
- **4 — orb-badge.** `background: custom / orb-badge`. `backgroundTextures: ["motion/badge.html"]` (static).
  Decal spins on `iTime`; palette via `backgroundKeyframes`.
- **5 — player (determinism).** `kind: motion`, `source: "motion/player.html"`. `params: { cam: 0, enter: 0 }`;
  keyframes `enter → 1` (`overshoot`, 0.1s), `cam → 1` (`easeOutCubic`, ~0.4s). The UI is a kino playback
  scrubber: a timestamp **and** a fill bar both derived from a single `--elapsed = --start + --t`
  (real clock), ticking 1:1 with render seconds — the determinism proof. `.kino-camera` push; widens via
  `--kino-aspect` in 16:9. `data-measure` on the card + scrubber.
- **6 — liquid-glass + kino-glass CTA.** `background: custom / liquid-glass`, `backgroundIntensity: 0.9`,
  cold cyan/indigo + gold palette. `motionOverlay: { source: "motion/cta-glass.html", ... }` — a `kino-glass`
  card (SDF rim, `--glass-*` knobs) that refracts the liquid-glass shader behind it (glass refracting glass).
  CTA copy: `kino build` + repo. `cam` push, `data-measure`.

## Feature coverage

Covered by beats: `aurora-flow`, `liquid-orb`, `orb-badge`, `liquid-glass` (4 bundled shaders) + a custom
`card-render.frag` (beat 3; the bundled `ui-hero` was dropped by user request — the custom shader still
covers the shader-background + texture-channel features and additionally dogfoods authoring a `.frag`);
texture channels **live-scrub** (beat 3) + **static** (beat 4); `kino-glass` material (beat 6); `--t`
real clock + cam easing + `.kino-camera` blur (beat 5); 16:9 dual-format + `--kino-aspect`.

Covered by process: `--measure` (alignment QA), high **quality tier** / SSAA (render).

**Deliberately skipped:** the **flipbook** texture mode — it's the steppy one the docs say to avoid for
continuous motion; live-scrub (beat 3) is the good path and already proves DOM→texture. `projects-only
workspace detection` is infra, not video-visible (exercised just by running inside `projects/`).

## Assets to build (fresh, high-craft)

1. `motion/spec-card.html` — the `advert.json` spec as a mini code editor (live-scrub caret) + `backgrounds/card-render.frag` — the scan-wipe presentation shader. *(v2; replaced `render-card.html` + `ui-hero`.)*
2. `motion/badge.html` — kino wordmark chip (IBM Plex Mono + mint dot), static decal.
3. `motion/player.html` — `--t` determinism timeline UI, `.kino-camera`, aspect-aware.
4. `motion/cta-glass.html` — SDF-rim `kino-glass` CTA card over the liquid-glass shader.

Plus the six section specs (`specs/reel-{1..6}-*.json`), `project.json`, the `kino-reel` brand
(`brands/kino-reel/brand.md`), and `build-reel.sh` (render ×6 → xfade concat per format).

## QA plan (no VO, mock timing)

1. `kino storyboard` — whole-arc contact sheet.
2. `kino still --segment N` per beat — hierarchy, 3×3 grid (no dead row/col), safe-zone + caption clearance.
3. `kino still --segment 5 --measure` / `--segment 6 --measure` — exact Δ-from-center on tagged panels (no eyeballing).
4. `kino still --platform` — TikTok/Reels safe zone for the hook (beat 1) and CTA (beat 6).
5. Stills in **both** 9:16 and 16:9 — verify `--kino-aspect` layout on beats 5–6.
6. Render at the high quality tier (SSAA) at final build.

`atWord` anchors and real VO timing resolve at the real `kino build`; QA uses mock timing + `still --around`.

## Risks & how they resolved during the build

1. **kino-glass over a shader background via `motionOverlay`** (beat 6) — **RESOLVED, works.** The glass
   CTA card genuinely refracts the liquid-glass shader behind it (glass refracting glass). Fallback
   (kino-glass over Canvas2D `brand-wash`) not needed.
2. **16:9 framing** — **fine.** Motion beats (player, CTA) widen via `--kino-aspect`; shader beats render
   centered/reflected in wide and read well.
3. **`scan`/`fill` seconds-based timing** (beat 3) — estimated from VO length; retune at real build.

Beat-3 gotcha (v2): `white-space:pre` on a code-editor card renders the **source newlines/indentation
between the `<div>` rows as literal blank lines** in the raster → the card showed only 2 lines with a big
gap. Fix: no `pre` on the container; indent with `padding-left`, `white-space:nowrap` per row.

Issues found & fixed during QA (not anticipated):

- **One-shader-per-spec** (see Structure above) → switched to the stitched-reel architecture.
- **Missing brand logo asset** — the `kino` brand points at `logo/kino-logo-web.png` (an R2 asset absent
  from the checkout); faceless beats hard-crash without it. Restored the file, then dropped the logo via
  the `kino-reel` brand (it rendered as an ugly light sticker anyway).
- **Oversized center-locked captions** collided with the hero surfaces (esp. beat 3's card) → removed the
  beat captions, using small `position:"bottom"` `texts` kickers where a label helps.
- **`still --segment` is 0-indexed with no bounds guard** (`preview.ts:69`) — `--segment 1` on a
  single-segment spec crashes with `reading 'startSec' of undefined`. Use `--segment 0`. (Minor kino
  papercut, unrelated to the reel.)

## Deviation note

The `superpowers:brainstorming` terminal is normally `writing-plans`. For a kino video the spec + assets
**are** the implementation, and this doc already carries the per-beat build detail, so it doubles as the
plan — proceeding straight to asset authoring + QA rather than emitting a separate heavyweight plan doc.
