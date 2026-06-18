# kino — documentation hygiene pass

**Date:** 2026-06-18 · **Status:** design approved, pending spec review → writing-plans

## Summary
A hygiene/cleanup pass over kino's documentation: make the existing docs accurate, rewrite the
README into an evergreen shape (it has calcified into stacked release notes), and do an in-code
documentation pass so the source is well-documented and easy to understand. The dominant problem
surfaced by a full-codebase audit is **drift, not absence** — the brand system migrated from
`brand.json` to `brand.md` but three docs still describe the old format, and the README header
says `v1.13` while `package.json` is `1.15.0`.

This is a documentation + clarity effort. The only code that changes behavior is removal of
confirmed-dead code and renaming of a few cryptic **non-exported** helpers — both verified against
the test suite. No features, logic, or public APIs change.

## Goals
- Every user-facing doc claim matches the actual code/CLI behavior.
- A well-made, evergreen README: what kino is, the pipeline at a glance, install, quickstart,
  condensed feature overview, docs links, a brief development note — no version markers.
- Version history lives in a `CHANGELOG.md`; the version is single-sourced from `package.json`.
- Source code is well-documented: file headers on the key files, doc-comments on public APIs with
  subtle contracts, explained magic constants, and comments on idioms that currently read as bugs.
- All code-touching changes leave `npm run build` (tsc) and `npm test` (vitest) green.

## Non-goals (out of scope — deliberately excluded)
- No separate contributor-doc set: no standalone `CONTRIBUTING.md`, `troubleshooting.md`,
  `architecture.md`, or `.env.example` files. (A *brief* architecture line and dev note go inline
  in the README instead — audience is team-internal.)
- No aggressive refactors: no extracting the duplicated slug utility, no consolidating the
  triplicate `ParamValue` type. (Cross-reference them in comments instead.)
- No feature, logic, behavior, or public-API changes.

## Audience
Team-internal. The README should be readable by a teammate picking up the project: enough pipeline
overview and dev guidance to be productive, without public open-source polish.

## Workstreams

### A — Docs accuracy (fix existing docs against the code)
- Replace every `brand.json` reference with `brand.md` in `docs/getting-started.md`,
  `docs/README.md`, and `docs/spec-reference.md`. Rewrite the stale `## brand.json` section of
  `spec-reference.md` to the real YAML-frontmatter + guidelines-body format that `init.ts`
  scaffolds and `src/config/brand.ts` loads.
- Fix the "required" markers in `spec-reference.md`: every brand frontmatter field is `.optional()`
  with `DEFAULT_BRAND` fallbacks — nothing in a brand is required.
- Add the `kino brand [name]` command (registered in `cli.ts`) to `docs/cli-reference.md`.
- Add `--kino-caption-bottom` (set every frame by `motionVars.ts`) to the motion-graphics
  CSS-variable contract in `docs/motion-graphics.md`.
- Reconcile the `--kino-gold` contradiction: `motion-graphics.md` says the gold accent is not
  auto-injected, but `motion.ts` CLI help lists it as auto-injected. Check `motionVars.ts` and fix
  whichever is wrong.

### B — README rewrite + CHANGELOG
- Rewrite `README.md` to the structure below; strip all `(v1.x)` markers and the Status blockquote.
- Add `CHANGELOG.md` with version history reconstructed from git tags/commit history.
- Single-source the version — the README states no hardcoded version number.
- Fold a short pipeline/architecture line and a brief **Development** section (build/test, branch +
  version-bump conventions) into the README itself (not separate files).

**Proposed README structure:**
```
[logo + tagline]
What it is            — 2–3 sentences, plain English
Pipeline at a glance  — spec → validate → VO → avatar → Remotion → 9:16 MP4 (one line/diagram)
Install               — setup.sh + manual; prerequisites (Node 18+, ffmpeg/ffprobe, ImageMagick)
Quickstart            — init → build --mock → build (≈4 lines)
Features              — condensed evergreen bullets (NO version markers)
Documentation         — links table into docs/
Development           — npm run build / npm test, branch + version conventions (brief)
Brand assets          — keep existing table
Changelog             — link to CHANGELOG.md
```

### C — In-code documentation pass (+ safe code changes)
**File headers** on: `build.ts`, `cli.ts`, `schema.ts`, `vo.ts`, `cache.ts`, `hash.ts`,
`KinoVideo.tsx` (with explicit z-order list: backdrop → avatar → app cut-ins → motion → overlays →
logo → captions → disclosure), plus `batch.ts`, `voices.ts`, `env.ts`, `manager.ts`.

**Comment the idioms that read as bugs:**
- stderr-only logging in `log.ts` (deliberate — keeps stdout clean for JSON piping).
- lazy dynamic `await import(...)` in `cli.ts` (fast startup + fault isolation).
- per-frame `useLayoutEffect` with intentional dep arrays in `MotionGraphic.tsx` /
  `CanvasBackground.tsx`.

**Doc-comment public APIs with subtle contracts:** `buildVO`/`VOResult` (`vo.ts`); the resolver
trio in `validate.ts` (why `resolveVoice` returns `''` as a sentinel while `resolveVoiceLook`
throws); the `Cache` class (key = content hash, `${key}.${ext}` naming, null-or-path return,
unbounded growth); the Brand frontmatter-vs-resolved split in `brand.ts`.

**Magic constants — add unit + rationale:** the `elevenlabs.ts`↔`ffmpeg.ts` audio-format coupling
(`mp3_44100_128` must match libmp3lame 128k/44100 or the cache breaks) documented prominently;
`GAP=0.32`, `KICKER_FG`, `CAPTION_BOTTOM=470`, the easing constants; centralize the
night/mint/green/white/gold palette doc in one place and reference it elsewhere.

**Eval trust-boundary note** at both `new Function(...)` sites (`components.tsx`,
`MotionGraphic.tsx`) referencing the sanitize/lint step.

**Fix the actively-wrong comment:** `replicate.ts:6` (default model is `bytedance/omni-human`, not
SadTalker).

**Safe code changes (test-verified):**
- Delete dead `tts()` / `ttsMock()` in `elevenlabs.ts` (no callers).
- Rename non-exported helpers: `hj` → `hedraFetch`, `rj` → `replicateFetch`,
  `posOf` → `origIndexToTrackPos`.

## Verification
- After every code-touching change: `npm run build` and `npm test` must pass.
- Every doc claim is re-checked against the specific code it describes before being marked done.
- The audit's claims (e.g. the `--kino-gold` contradiction, dead-code callers) are re-verified
  against the live source at edit time — the audit guides; the code decides.

## Sequencing
1. Docs accuracy (Workstream A) + the one-line `replicate.ts:6` fix — smallest change that removes
   every *actively wrong* statement in the project.
2. README rewrite + CHANGELOG (Workstream B).
3. In-code documentation pass (Workstream C), by subsystem, starting with the weakest (vo-and-media).
