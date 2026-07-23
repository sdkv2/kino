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
- **Location:** `projects/kino-hero-reel/` (`project.json → brand: kino`)

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
| 3 | 5 | `ui-hero` bg + tex (avatar) | texture **live-scrub** + `reveal` shard-dissolve + floor reflection | "That card? A real UI element, handed to the shader as a texture." |
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
- **3 — ui-hero.** `background: custom / ui-hero`. `backgroundTextures: [{ source: "motion/render-card.html", param: "fill" }]`
  (live-scrub). `backgroundKeyframes`: `reveal` 0 (hold to ~0.6s) → 1 by ~3s (`easeOutCubic`, the shard
  materialize); `fill` 0 → 1 across the beat (the card's own CSS progress). The card is the content — no
  extra caption. *Note:* `backgroundKeyframes` are absolute-seconds only (no `atWord`), so `reveal` timing
  is estimated from VO length and may need a small retune at the real build.
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

Covered by beats: `aurora-flow`, `liquid-orb`, `ui-hero`, `orb-badge`, `liquid-glass` (all 5 shaders);
texture channels **live-scrub** (beat 3) + **static** (beat 4); `kino-glass` material (beat 6); `--t`
real clock + cam easing + `.kino-camera` blur (beat 5); 16:9 dual-format + `--kino-aspect`.

Covered by process: `--measure` (alignment QA), high **quality tier** / SSAA (render).

**Deliberately skipped:** the **flipbook** texture mode — it's the steppy one the docs say to avoid for
continuous motion; live-scrub (beat 3) is the good path and already proves DOM→texture. `projects-only
workspace detection` is infra, not video-visible (exercised just by running inside `projects/`).

## Assets to build (fresh, high-craft)

1. `motion/render-card.html` — kino render-status card, live-scrub `fill`, real brand copy.
2. `motion/badge.html` — kino wordmark chip (IBM Plex Mono + mint dot), static decal.
3. `motion/player.html` — `--t` determinism timeline UI, `.kino-camera`, aspect-aware.
4. `motion/cta-glass.html` — SDF-rim `kino-glass` CTA card over the liquid-glass shader.

Plus `specs/nothing-here-was-filmed.json` and `project.json`.

## QA plan (no VO, mock timing)

1. `kino storyboard` — whole-arc contact sheet.
2. `kino still --segment N` per beat — hierarchy, 3×3 grid (no dead row/col), safe-zone + caption clearance.
3. `kino still --segment 5 --measure` / `--segment 6 --measure` — exact Δ-from-center on tagged panels (no eyeballing).
4. `kino still --platform` — TikTok/Reels safe zone for the hook (beat 1) and CTA (beat 6).
5. Stills in **both** 9:16 and 16:9 — verify `--kino-aspect` layout on beats 5–6.
6. Render at the high quality tier (SSAA) at final build.

`atWord` anchors and real VO timing resolve at the real `kino build`; QA uses mock timing + `still --around`.

## Risks

1. **kino-glass over a shader background via `motionOverlay`** (beat 6) — the least-tested combo. The
   `motion-design` skill says `kino-glass` "works over shader (.frag) backgrounds," so it should sample the
   shader canvas. **QA beat 6 first.** Fallback if the mirror doesn't sample: split beat 6 into a
   liquid-glass hero (no overlay) + a `kino-glass` CTA over a Canvas2D `brand-wash` bg.
2. **16:9 framing** — the shaders lift the form toward the upper-third for 9:16 lower-third captions; in
   wide the negative space differs and captions re-center. Accept looser wide framing; motion beats adapt
   via `--kino-aspect`.
3. **`reveal`/`fill` seconds-based timing** (beat 3) — no `atWord` on `backgroundKeyframes`; estimated
   from VO length, retune at real build.

## Deviation note

The `superpowers:brainstorming` terminal is normally `writing-plans`. For a kino video the spec + assets
**are** the implementation, and this doc already carries the per-beat build detail, so it doubles as the
plan — proceeding straight to asset authoring + QA rather than emitting a separate heavyweight plan doc.
