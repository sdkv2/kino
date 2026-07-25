# Camera Blur — Design

**Date:** 2026-07-23  
**Status:** Implemented  
**Scope:** Deterministic motion-blur on motion-graphic camera moves. Rides the existing `motionOverlay` / `kind:"motion"` param + keyframe seam. No schema change for rung 1.

## Motivation

Authors choreograph camera with a `.cam` wrapper + tweened `params` (e.g. `cam: 0→1` over 2s). Today the only polish available is CSS `filter: blur(Npx)` hand-keyed in HTML — it does not track camera **velocity**, so moves either look sharp (cheap) or uniformly soft (muddy). Real UI promos smear during fast zooms and sharpen on settle.

kino already steps frames deterministically (`src/render/native/engine.ts`) and tweens params per frame (`paramsAt` in `src/render/bgparams.ts`). Velocity is knowable: `Δparam × fps`. Injecting that as a CSS var gives agents a one-class solution without hand-tuning blur per beat.

## Non-goals (rung 1)

- True multi-sample motion blur (N sub-frame renders + blend) — rung 2 if velocity-blur isn't enough.
- Per-element depth-of-field / rack focus.
- Blur on captions, avatar, or background layers (motion overlay only).
- Wall-clock or RAF-driven blur.

## Architecture

### 1. Spec seam — reuse motion `params` + `keyframes` (no schema change)

Authors already keyframe camera openness:

```jsonc
"motionOverlay": {
  "source": "motion/spotify-ui.html",
  "params": { "cam": 0 },
  "keyframes": [
    { "at": 0, "params": { "cam": 0 } },
    { "at": 2, "params": { "cam": 1 }, "ease": "easeInOut" }
  ]
}
```

**Convention:** param name `cam` (0→1) drives scale on `.cam` or `.cam.kino-camera`. Optional numeric param `camBlur` (default 12) scales strength.

Rung 1 adds engine-computed velocity vars — authors do not hand-author blur keyframes.

### 2. Velocity contract — new CSS vars on motion host

Each frame, `buildMotionVars` (`src/render/motionVars.ts`) already receives tweened `params`. Extend with:

| Variable | Value | Notes |
|---|---|---|
| `--cam` | resolved `cam` param | already exists as `--cam` via params loop |
| `--cam-vel` | `max(|cam[t]−cam[t−1]|, |cam[t+1]−cam[t]|) × fps` | unitless speed; forward lookahead on frame 0 |
| `--cam-blur` | `rest + motion`, both × `(1−cam)`; rest ≈ `camBlur×0.4` at cam=0 | px-ready; clamped 0..24 |

`camBlur` defaults to **12** when `cam` param is present and `camBlur` omitted (sensible for 9:16 @ 30fps). Authors override with `"params": { "cam": 0, "camBlur": 18 }`.

**Determinism:** velocity from consecutive resolved keyframe samples at `t` and `t − 1/fps` — same inputs as today, no wall clock.

### 3. Author surface — opt-in class `kino-camera`

Injected in `KINO_SCRUB_STYLE` (`MotionGraphic.tsx`), alongside `kino-rise` / `kino-pulse`:

```css
.kino-camera {
  filter: blur(calc(var(--cam-blur, 0) * 1px));
  will-change: transform, filter;
}
```

Usage:

```html
<div class="cam kino-camera" style="transform: scale(calc(1.38 - 0.38 * var(--cam)))">
  …UI…
</div>
```

**Rules for agents (→ `motion-design` skill):**

- **One camera move per beat** — single `cam` 0→1 arc. No chained pan-then-counter-pan acts (reads as double-dolly).
- Keyframe duration **1.5–2.5s** for cold opens; independent of VO length.
- `easeInOut` default; `overshoot` only for playful brands.
- Blur peaks mid-move, clears on settle — automatic via velocity.
- After `cam` reaches 1, micro-life uses `--t` / `--kino-edge` only — no more scale changes.

### 4. Wiring

| File | Change |
|---|---|
| `src/render/motionVars.ts` | Track previous-frame param snapshot; emit `--cam-vel`, `--cam-blur` |
| `src/render/native/page/MotionGraphic.tsx` | Add `.kino-camera` to `KINO_SCRUB_STYLE` |
| `src/commands/motion.ts` | Document vars + `kino-camera` class |
| `docs/motion-graphics.md` | Camera blur section |
| `skills/motion-design/SKILL.md` | One-move camera rule + `kino-camera` |

**Rejected:** blur on every motion overlay by default (too muddy on static UIs). Opt-in class keeps diff small.

### 5. Edge cases

| Case | Behavior |
|---|---|
| No `cam` param | `--cam-vel` / `--cam-blur` = 0; class is no-op |
| Frame 0 | velocity 0 (no previous frame) |
| Loop seam | velocity spikes if `cam` jumps — authors should hold `cam: 1` at beat end |
| `filter` + `transform` on same node | supported; transform on `.cam`, blur via class |
| Tier-2 `render(env)` JS | gets `env.camVel` / `env.camBlur` mirrors |

### 6. Verification

```bash
kino still specs/spotify-ui.json --around 1 --count 7 --span 2 --montage
```

Mid-move frames should show visible blur; frames at `t=0` and `t≥2` should be sharp. Compare with `camBlur: 0` in params to A/B.

### 7. Rung 2 (out of scope)

- Multi-tap blur: 3–5 substeps per frame weighted by velocity (ffmpeg-quality smear).
- Separate `camX` / `camY` params with directional blur vector.
- `kino inspect` warning when `cam` keyframes imply reverse pan (act2+act3 smell).

## Example (spotify-ui)

```jsonc
"motionOverlay": {
  "source": "motion/spotify-ui.html",
  "params": { "cam": 0, "camBlur": 14 },
  "keyframes": [
    { "at": 0, "params": { "cam": 0 } },
    { "at": 2, "params": { "cam": 1 }, "ease": "easeInOut" }
  ]
}
```

```css
.cam {
  transform: scale(calc(1.38 - 0.38 * var(--cam)));
  transform-origin: 50% 38%;
}
```

```html
<div class="cam kino-camera">…</div>
```

Until engine lands, authors can approximate with `filter: blur(calc(8px * var(--cam-vel, 0)))` once `--cam-vel` ships, or omit blur on rung 0.
