# SFX import + audio markers — design

**Date:** 2026-07-19
**Status:** Approved

## Problem

Kino's audio today is a single stitched VO track (`vo.mp3` → one `<Audio>` in
`KinoVideo.tsx`). There is no way to add sound effects or a music bed, and the
authoring agent is blind to the audio it is placing visuals against — it only
sees per-word VO timings. Agents need a *general understanding* of an audio
track (energy, onsets, silences) so they can place SFX on meaningful markers,
not guessed timestamps.

## Decisions (from brainstorm)

- **Placement:** free-placed spec-level events (`sfx: [{src, at, volume}]`),
  mirroring how `backgroundKeyframes`/`texts` work. Not segment-attached, not
  auto-on-transition.
- **Analysis input:** a generic tool that works on *any* audio file (VO track,
  imported music, anything). The agent decides what to feed it.
- **Analysis output:** both a visual chart (waveform + spectrogram PNGs the
  agent eyeballs for feel) and machine-readable JSON markers (exact
  timestamps the agent authors against).
- **SFX file source:** both — bare ids resolve from a shared library
  (`assets-lib/sfx/`), path-like refs resolve from the project's assets dir.
- **Scope:** SFX events **and** a music-bed layer with simple auto-ducking,
  in the same change (markers on music are useless if music can't be in the
  mix).

## Approach

Analysis engine: **decode PCM via ffmpeg, compute markers in TS** (~80 lines).
ffmpeg dumps raw mono PCM (same pattern as `extractAudio`); TS computes the RMS
envelope, onsets (energy-delta jumps), peaks (local maxima), and silences.
Deterministic, unit-testable against synthetic PCM, zero new deps. Charts are
ffmpeg `showwavespic` / `showspectrumpic` one-liners.

Rejected: parsing `silencedetect`/`astats` stderr (brittle, weak onsets); a
real DSP dep like meyda/essentia (true BPM tracking — overkill; upgrade path
if music-video beat grids are ever needed).

Mixing: **Remotion `<Audio>` layers**, no ffmpeg mixing code. Remotion mixes
all audio layers at encode time.

## Components

### 1. `kino audio-markers <file> [--out <dir>]`

New command (`src/commands/audiomarkers.ts` + analysis in
`src/media/markers.ts`). Accepts any audio/video file. Writes three artifacts
next to the input (or into `--out`):

- `<name>.markers.json`
  ```json
  {
    "durationSec": 42.1,
    "rms": [{ "t": 0.0, "v": 0.02 }, ...],   // 10 Hz coarse envelope
    "onsets": [1.24, 3.90, ...],              // energy-delta jumps
    "peaks": [1.30, 4.02, ...],               // local RMS maxima
    "silences": [{ "from": 12.1, "to": 12.9 }, ...]
  }
  ```
- `<name>.wave.png` — waveform (ffmpeg `showwavespic`)
- `<name>.spectrum.png` — spectrogram (ffmpeg `showspectrumpic`)

Agent workflow: run the tool on a track, look at the PNGs for overall shape,
author `sfx.at` / cut timings against the JSON timestamps.

### 2. Spec schema (`src/spec/schema.ts`)

```ts
sfx: z.array(z.object({
  src: z.string().min(1),        // "whoosh" (library id) | "sfx/hit.mp3" (project asset)
  at: z.number().min(0),         // seconds on the main timeline
  volume: z.number().min(0).max(1).default(1),
})).optional(),
music: z.object({
  src: z.string().min(1),        // same resolution as sfx.src
  volume: z.number().min(0).max(1).default(0.18),  // bed level
  duck: z.number().min(0).max(1).default(0.06),    // level while VO words active
  fadeOutSec: z.number().min(0).default(2),
}).optional(),
```

### 3. Audio source resolution (`src/media/sfx.ts`)

- Bare id (`whoosh`, no slash/extension) → `assets-lib/sfx/whoosh.mp3`,
  resolved relative to the package root (`import.meta.url`), so it works from
  a global npm install.
- Path-like → `project.assetPath()` with the existing `containedPath`
  traversal guard.
- Missing file → build error at prepare time (same as brand assets).

### 4. Build pipeline (`src/commands/build.ts`)

`prepare()` resolves each `sfx[].src` and `music.src`, copies them into
`_public/` (`sfx-<i>.<ext>`, `music.<ext>`), and extends `KinoProps` with:

```ts
sfx: Array<{ src: string; at: number; volume: number }>;   // staticFile-relative
music: { src: string; volume: number; duck: number; fadeOutSec: number } | null;
```

### 5. Render (`src/render/remotion/KinoVideo.tsx`)

- Per SFX event: `<Sequence from={f(at)}><Audio src volume /></Sequence>`.
- Music: one `<Audio>` spanning the video with a frame-volume callback —
  `duck` while any VO word span is active (word timings are already in
  props), `volume` otherwise, 0.3 s linear ramps between the two, and a
  linear fade to 0 over the final `fadeOutSec`.
- Both slot into the existing layer stack next to the VO `<Audio>` (paint
  nothing).

### 6. Shared library (`assets-lib/sfx/`)

Directory + README in the same spirit as `assets-lib/lottie/`: naming
convention (`whoosh.mp3`, `pop.mp3`, …), sourcing guidance (CC0 sources —
freesound CC0 filter, kenney.nl, pixabay), licensing note. Audio binaries are
populated by user/agent, not fabricated.

## Error handling

- Unknown bare id → error listing available library ids.
- Path escape → existing `containedPath` throw.
- `music.duck > music.volume` → warn (ducking up is almost certainly a typo).
- `sfx.at` beyond the VO duration → warn at prepare (event silently never
  plays otherwise).
- `audio-markers` on a file ffmpeg can't decode → surface ffmpeg's error.

## Testing

- `src/media/markers.ts` unit tests on synthetic PCM buffers: known sine
  bursts → expected onsets/peaks; inserted gaps → expected silences; envelope
  length matches duration × 10 Hz.
- Schema tests: defaults applied, volume bounds enforced.
- Resolution tests: bare id → library path; relative path → project asset;
  traversal rejected.
- Render-layer changes verified via the existing preview/blind-rubric flow
  (see memory: render-quality validation) — audio itself doesn't affect
  frame-hash determinism.

## Docs

- `docs/spec-reference.md`: `sfx` + `music` fields.
- `docs/cli-reference.md`: `audio-markers` command.
- `skills/video-production/`: marker-driven SFX placement workflow (note:
  working tree already has uncommitted edits to these files — keep changes
  separate).

## Out of scope

- BPM/beat-grid tracking (DSP dep) — upgrade path if music-video cuts needed.
- Auto-SFX on transitions.
- Per-segment sound attachment.
- Sidechain-style real ducking (envelope follower) — word-span gate is enough.
