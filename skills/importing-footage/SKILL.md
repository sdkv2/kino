---
name: importing-footage
description: >
  Use when turning a long source recording (screen capture, device scroll, desktop
  demo, imported clip) into kino app beats — inspecting stills, mapping clip windows,
  seating footage in a custom chrome frame, or retiming with speed/pause after beats exist.
---

# Importing source footage

Companion to `video-production`. That skill owns the full trailer. **This skill owns
ingest → beat map → clip/frame/retiming** for one or more source recordings.

Naming is generic: **source footage** + optional **frame** (chrome). Device scroll is
a common case, not the only one.

## When

- User drops a long recording and wants beats cut from it
- Same asset reused across multiple `app` segments with different time windows
- Footage should sit inside custom chrome (device, browser, card matte, …)
- After beats exist: slow-mo or freeze so the right UI lands under the VO

**Not this skill:** stock Pexels b-roll (`video-production` stock section); competitor
research (`kino scan` / `transcribe` — research only, not production).

## Workflow

```
1. Stage     → projects/<name>/assets/recordings/<file>
2. Pull stills → kino frames <path> --every 0.5 --montage
3. Read EACH still (image tool) — not only the montage
4. Beat map  → timestamp ranges → claim each beat must show
5. Author    → app segments: shared asset + clipFrom/clipTo (+ optional frame)
6. Retune    → speed / pauseAt after first storyboard (do not re-split the mp4)
7. Hand off  → ad-voice → video-production inspect/storyboard → adversarial-critique → build
```

### 1. Stage the file

Copy into `projects/<name>/assets/recordings/` (or the path the user gives). Prefer
`.mp4` / `.mov`. Stills work too (`screens/…`) but clip/speed/pause only apply to video.

### 2–3. Inspect in detail

```bash
kino frames projects/<name>/assets/recordings/foo.mp4 --every 0.5 --montage
# denser (--every 0.25) if the scroll/UI moves fast; --at 1.2,4.0 for known moments
```

**REQUIRED:** open every extracted still with the image Read tool. Per still note:

| Note | Example |
|---|---|
| Timestamp | `4.2s` |
| UI state | onboarding step 2, list scrolled mid-way |
| Motion | finger scrolling, tap, idle |
| Thumb-stop? | yes / no — opener candidates |

Do not invent beats from filenames or duration alone.

### 4. Beat map (before JSON)

Short list only — ranges into the **source**, not the trailer timeline:

```
0.0–2.4  cold open — home feed mid-scroll (thumb-stop)
4.2–8.0  feature — filter chip selected
9.1–12.0 payoff — result card
```

Then write VO/captions (`ad-voice`) against those claims.

### 5. Author `app` segments

Same `asset`, different windows:

```jsonc
{
  "kind": "app",
  "asset": "recordings/onboarding-scroll.mp4",
  "clipFrom": 4.2,
  "clipTo": 8.0,
  "speed": 1,
  "shot": "static",
  "transition": "cut",
  "text": "…",
  "caption": "…"
}
```

| Field | Meaning |
|---|---|
| `clipFrom` / `clipTo` | Source seconds (window into the file) |
| `speed` | Playback rate (default `1`). `<1` = slow-mo |
| `pauseAt` | Seconds **from segment start** — freeze that frame for the rest of the beat |
| `frame` | Optional chrome — see below |
| `zoomKeyframes` | Camera push/pan on the **whole phone unit** (footage + chrome). See §6 |

VO still drives beat duration. If the clip (at `speed`) ends early, the last frame holds
(via freeze — do not rely on Remotion `trimAfter`; it unmounts early under slow-mo).

### 6. Custom frame (optional)

Drop a PNG/WebP with a transparent “screen” hole into `assets/frames/`. Footage draws in
`inset` (% of composition); chrome is full-bleed on top.

```jsonc
"frame": {
  "src": "frames/device-chrome.png",
  "inset": { "x": 8, "y": 10, "w": 84, "h": 78 }
},
"shot": "static",
"transition": "cut"
```

**Hard rule when `frame` is set:** `shot: "static"` only — no `push-in` / `pull-out` / pan / tilt.
(Renderer also forces static.) Prefer `cut` or `dissolve` for transitions. Reuse one frame across
beats. Measure inset from the chrome asset (screen hole), not by eye on a wrong aspect. Preview
with `kino still --segment N`.

**Camera move on framed footage → `zoomKeyframes`.** The inner `shot` is disabled inside a frame (it
fights the inset), so a push-in comes from a `zoomKeyframes` track that scales/pans the footage **and**
chrome together — the phone grows in frame while captions, kicker, logo and the ground stay anchored
(they're separate layers). `at` is **seconds from the beat's start** (`0` = beat start), like
`captionKeyframes` — so the move **rides the beat**: re-timing or re-ordering the video never desyncs it,
no `kino inspect` lookup needed. `params` are `scale` (zoom), `x`/`y` (focal offset, % of composition),
`opacity`. One keyframe = static hold; two = an animated push. Works on non-framed app footage too.

```jsonc
"zoomKeyframes": [
  { "at": 0,   "params": { "scale": 1.0 } },
  { "at": 4.5, "params": { "scale": 1.18 } }   // slow push across the beat (a too-large `at` just holds at the end)
]
```

**Quick zoom, then pan across.** `ease` + independent per-param tracks give a snap-zoom that holds while
it pans: put `ease: "overshoot"` (or `easeInOut`) on a *close* second keyframe for the fast punch, hold
`scale`, then move `x`/`y` over the later keyframes. **Each param animates on its own track — a value
only moves if it appears in ≥2 keyframes**, so a single `x` keyframe is a constant hold, not a pan (carry
`x: 0` from the start to make it move).

```jsonc
"zoomKeyframes": [
  { "at": 0,   "params": { "scale": 1.0, "x": 0 } },
  { "at": 0.6, "params": { "scale": 1.5, "x": 0 },   "ease": "overshoot" },  // fast punch-in, 0.6s into the beat
  { "at": 4.5, "params": { "scale": 1.5, "x": -14 }, "ease": "easeInOut" }   // hold zoom, pan across
]
```

Eases: `linear` (default) · `easeInOut` (smooth S-curve) · `overshoot` (snappy, overshoots + settles) ·
`spring` (elastic). Keep the pan inside the zoom headroom — at `scale s` the group overflows ~`(s−1)/2`
of the frame each side (e.g. `1.5` → ~25%), so an `x`/`y` beyond that reveals the ground behind the phone.

### 7. Retune after beats exist

After first `kino storyboard` / `still`:

- Important UI flashes past → lower `speed` (e.g. `0.55`)
- Need a hold under a VO word → set `pauseAt` (seconds from **segment** start)
- Wrong moment → nudge `clipFrom` / `clipTo`, don’t re-encode the file

Then continue the normal `video-production` path.

## Hard rules

- Read stills before writing clip windows
- Beat map before spec JSON
- Mute is automatic on app video (source audio never fights VO)
- Do not use `kino scan`/`transcribe` as a production step for our own recordings
- Frame chrome must not invent fake product UI inside the screen hole

## Hand-off

1. `ad-voice` — segment `text` / `caption`
2. `video-production` — inspect → storyboard
3. `adversarial-critique` — layout QA
4. `kino build`
