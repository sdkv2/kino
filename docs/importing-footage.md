# Importing footage

An `app` beat plays real footage — a screen capture, device scroll, desktop demo, or any imported clip — under the voiceover, optionally seated inside a chrome frame. This page is the field reference for turning one source recording into app beats. For the end-to-end agent workflow (inspect stills → beat map → author → retime), see the [`importing-footage`](../skills/importing-footage/SKILL.md) skill. Spec fields: [Spec reference](spec-reference.md#segments).

The core idea: **stage the recording once, cut beats from it with time windows** — never re-split the mp4 into clips. Each `app` segment points at the same `asset` and shows a different `clipFrom`/`clipTo` slice.

- [Workflow](#workflow)
- [Clipping one recording into beats](#clipping-one-recording-into-beats)
- [Chrome frames](#chrome-frames)
- [Camera moves](#camera-moves)
- [Retiming](#retiming)

## Workflow

```
1. Stage      → projects/<name>/assets/recordings/<file>.mp4
2. Pull stills → kino frames <path> --every 0.5 --montage   (read each still, not just the montage)
3. Beat map    → timestamp ranges → what each beat must show
4. Author      → app segments: shared asset + clipFrom/clipTo (+ optional frame)
5. Storyboard  → kino storyboard <spec>   (check framing/overlap)
6. Retune      → speed / pauseAt so the right UI lands under the VO
7. Build       → kino build <spec>
```

`kino frames` and `kino scan` also work on **external** reference videos for research — those are analysis-only and never touch a render. See [Reference-video analysis](cli-reference.md#reference-video-analysis-research-only).

## Clipping one recording into beats

```json
{ "kind": "app", "asset": "recordings/demo.mp4", "text": "Search finds it instantly.",
  "clipFrom": 4.0, "clipTo": 7.5 }
```

- **`asset`** — the recording under the project's `assets/` (`.mp4`/`.mov`, or a still image). Reuse the same path across many beats.
- **`clipFrom` / `clipTo`** — seconds **into the asset**. The beat shows that slice; its on-screen length is set by the VO, then retimed (below).

Omit `clipFrom`/`clipTo` to play from the start. Point several beats at one recording with different windows instead of exporting separate files.

## Chrome frames

Seat the footage inside a device or browser mockup. The frame is a full-bleed PNG/WebP drawn **on top**; the footage draws in the inset rectangle beneath it:

```json
"frame": {
  "src": "chrome/iphone.png",
  "inset": { "x": 6, "y": 4, "w": 88, "h": 92 }
}
```

`inset` is percent of the composition (`x`/`y` = top-left corner, `w`/`h` = size). Size the inset to the frame's transparent screen cutout so the footage sits exactly inside the bezel. The `src` is a project asset like any other.

## Camera moves

Push or pan across the whole footage+chrome group — the "canvas zoom" for inset device footage — with `zoomKeyframes`. Times are **beat-relative** (`at` = seconds from this segment's start), so the move rides the beat when VO timing shifts. Params: `x`, `y`, `scale`, `opacity`.

```json
"zoomKeyframes": [
  { "at": 0,   "scale": 1.0 },
  { "at": 2.5, "scale": 1.35, "y": -10 }
]
```

Same keyframe shape as `captionKeyframes` / background tweens — see [Keyframes & triggers](spec-reference.md#keyframes--triggers).

## Retiming

Get beats and framing right **first**, then tune timing so the moment lands under the words. Do this on the spec, not by re-cutting the mp4:

- **`speed`** — playback rate (default `1`). `0.5` = slow-mo, `2` = fast-forward. Tune after the beats exist.
- **`pauseAt`** — seconds from segment start to **freeze** the footage for the rest of the beat (hold on the result while the VO finishes the line).

```json
{ "kind": "app", "asset": "recordings/demo.mp4", "text": "…and it's saved.",
  "clipFrom": 12, "clipTo": 15, "speed": 0.75, "pauseAt": 2.0 }
```

Use `kino still <spec> --around <sec>` to QA a single moment as a frame sheet before rebuilding — cheaper than a full render.
