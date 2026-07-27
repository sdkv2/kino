# Geometry probe: do lenses ever refract non-GL DOM?

**Scene:** `projects/compositor-demo` · `macos-desktop-youtube.js` · spec `geom-probe.json`  
**Run:** 1094 frames @ 30fps (~36.5s), `KINO_PROFILE=1`, draft electron compositor  
**Date:** 2026-07-27

## Paint order (verified)

`collectForegroundRoots` / z-index:

| Element | z-index | vs lens stack |
|---|---|---|
| `.chrome-win` | 10 | **below** menubar(20) + dock(30) — would be refracted if overlapping |
| `.menubar.kino-lens` | 20 | lens |
| `.dock-wrap.kino-lens` | 30 | lens (top of stack) |
| `.rgb-split` | 7999 | **foreground** (`geom:fg:rgb-split`) — not sampled by glass |
| `.cursor-layer` | 10000 | **foreground** (`geom:fg:cursor`) |
| `.panic` | 100000 | above everything; only mounted once lenses are `display:none` |

Hoisted GL (excluded from DOM refraction question): `kino-underlay` wallpaper, `kino-quad` watch sprite (inside chrome, never under lenses).

## 1. Overlap table

Composition space px. Alive frames = lenses not `display:none` (821). Panic hides both lenses for 273 frames (`geom:menubar:hidden` / `geom:dock:hidden` ×273).

| Lens | Content | Overlap frames / alive | Total overlap px | Max single-frame px |
|---|---|---|---|---|
| menubar | `.chrome-win` | **0 / 821** | 0 | 0 |
| dock | `.chrome-win` | **0 / 821** | 0 | 0 |
| menubar | `.rgb-split` | 0 refracted (foreground) | — | — |
| dock | `.rgb-split` | 0 refracted (foreground) | — | — |
| menubar | `.cursor-layer` | 0 refracted (foreground) | — | — |
| dock | `.cursor-layer` | 0 refracted (foreground) | — | — |
| either | `.panic` | n/a — lenses already zero-rect | — | — |

Profiler keys (raw): `geom:menubar-x-chrome` / `geom:dock-x-chrome` = `0.00 ×821`; `*-frames` sum = 0.

Mean lens areas while measured: menubar ≈ 43226 px², dock ≈ 34566 px² (includes zero-area panic frames in the `:area` average).

## 2. Timeline notes

| Window | t (s) | frames @30fps | Finding |
|---|---|---|---|
| Chrome open sweep | ~4.6–5.2 (scale 0.68→1 from dock origin) | — | **No overlap.** Min chrome↔dock gap stays ≈87px even at scale 0.68 (chrome bottom ≈919, dock top ≈1006 @1080p). Menubar gap grows (chrome top drops to ≈391). |
| Steady chrome | ~5–18 | — | Chrome bottom @864 / watch @729; dock top ≈1006; menubar bottom=30 vs chrome top 86–103. Gaps 56px+ / 140px+. |
| Watch resize | ~18 | — | Window **shrinks** (72%→58% h) — gap to dock increases. |
| Glitch shake | ~26.8–31.2 | ~97 frames with `.rgb-split` up | ±6px desk-fx / ±4px chrome — nowhere near closing gaps. `.rgb-split` is foreground plate, not glass input. |
| Panic | ~31.2–end | 273 frames | Lenses `display:none` — confirmed `geom:*:alive` ≈0.75 → 821/1094, `*:hidden` ×273. |

No `geom:*-x-chrome:tN` bucket keys were emitted (those only fire on hit).

## 3. Verdict

**TRUE** for this scene: across all 821 lens-alive frames, menubar and dock glass never intersect any below-lens DOM content (`.chrome-win`). Behind the lenses there is only the hoisted wallpaper (plus transparent desk), so refraction does not require FO-rasterized motion DOM.

Caveats (not verdict-flippers for “non-GL DOM behind lenses”):

- Glitch temporarily paints wallpaper into `.desk` FO background for `.rgb-split` screening — still wallpaper imagery, not chrome/UI, and rgb-split itself is foreground.
- Hoisting YouTube thumbnails as quads is irrelevant here — chrome never sits under the lenses.

**Route C** (live motion DOM above GL canvas, delete FO for this authorship constraint) is geometrically viable for this beat.

## 4. Probe patch

Instrumentation on branch `spike/lens-geometry-probe`:

- `src/render/native/page/geomProbe.ts` — per-frame AABB overlaps → `addSample` / `noteMax` / `noteHold`
- `src/render/native/page/motionRaster.ts` — call from `prepareMotionFrameBundle`
- `src/render/native/page/compositor/profile.ts` — `noteMax` / `noteHold`
- Profile dump prints all `geom:*` keys (`engine.ts` / `electron/slots.ts`)
