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

**Spot-check the two endpoints before committing a window.** A coarse `--every N` montage tile can
straddle a phase change *inside* its N-second bin (a 3-2-1 countdown, a screen transition), so a tile
that reads "WORK 0:19" may actually sit mid-countdown. After you pick each `clipFrom`/`clipTo`, confirm
that exact second — `kino frames <mp4> --at <clipFrom>,<clipTo>` — and Read those two stills. Never
author a clip window straight off a wide montage.

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

**`clipTo` is a soft freeze-ceiling, not a trim.** The beat plays `clipFrom → min(clipTo, clipFrom +
beatLen·speed)`: VO *longer* than the window freezes on the `clipTo` frame; VO *shorter* cuts
mid-window before reaching `clipTo`. So size the window ≥ the beat — `clipTo` will **not** trim an
over-long VO line, and a window shorter than the VO just freezes early.

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
(Renderer also forces static — `frame ? "static" : shot`.) **A framed beat that shows `shot:"push-in"`
or `"scroll"` is relying on that silent force — don't copy it; use `zoomKeyframes` (below) for a camera
move on framed footage.** Prefer `cut` or `dissolve` for transitions. Reuse one frame across
beats. Measure inset from the chrome asset (screen hole), not by eye on a wrong aspect. Preview
with `kino still --segment N`.

**Measuring the hole (the naive alpha-bbox is wrong).** The PNG is transparent *both* outside the
phone body *and* in the screen hole, so a whole-image "bounding box of alpha < 16" returns the entire
image (`0,0,~100,~100` — useless). The hole is the transparent rect *inside* the opaque bezel: scan
the **centre row + centre column** for the `opaque → transparent → opaque` bands to isolate the inner
rect, then convert px→%. (Or open the PNG on a solid colour so the hole is visible.) Match the footage
aspect to the hole's `w:h`, or `objectFit:cover` crops the edges.

Copy-paste (python3 + Pillow) — prints the `inset` for a centred phone whose only *interior* transparent
region is the screen hole:

```python
from PIL import Image
im = Image.open("frames/device-chrome.png").convert("RGBA"); W, H = im.size; px = im.load()
def hole(at, n):                      # the transparent run flanked by opaque (skips the outer margin)
    tr = [i for i in range(n) if at(i)[3] < 16]; runs = []; s = tr[0]
    for a, b in zip(tr, tr[1:] + [None]):
        if b != a + 1: runs.append((s, a)); s = b
    inner = [r for r in runs if r[0] > 0 and r[1] < n - 1] or runs   # not touching the edge = the hole
    return max(inner, key=lambda r: r[1] - r[0])
x0, x1 = hole(lambda x: px[x, H // 2], W); y0, y1 = hole(lambda y: px[W // 2, y], H)
print({"x": round(x0/W*100,1), "y": round(y0/H*100,1), "w": round((x1-x0)/W*100,1), "h": round((y1-y0)/H*100,1)})
```

**Hole radius:** renderer clips framed footage at **48px** corner radius. Match (or exceed) that in
the PNG hole — a tighter radius leaves dark gradient leaks at the four corners. For portrait device
UI / portrait stock, prefer a **portrait inset** (~9:16); a wide hole cover-crops headers and slices
glyph tops. Typed prompt *inside* chrome that must also zoom → `speech-synced-ui` (one motion graphic),
not a zooming overlay on this PNG.

**Caption clearance:** a tall inset (≳75% h) pushes the device bottom past the lower-third caption
band, so the caption lands *on* the lower screen instead of below the phone. If the beat's lower
screen carries content, pick a shorter-inset frame (device reads smaller but the caption gets clear
space) or raise the caption. (`iphone.png` hole is ~78% h — captions overlap the screen; the shorter
`device-chrome.png` clears them.)

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
