# kino-lens / liquid-glass under the GL compositor

**Status:** **Done** (shape masks, MotionPostEffect registry, loadable materials, multi-panel GPU).

## What shipped

1. **Shape** — `border-radius`, child `svg.kino-lens-shape`, or `--glass-path*` / `clip-path` (`glassShape.ts`).
2. **Registry** — `motionPostEffects/` (`kino-lens` / `kino-lens`); glass is one entry.
3. **Loadable material** — `assets-lib/effects/liquid-glass.frag` via `data-lens` (default `liquid-glass`); resolved by `effectsLib.ts`, baked into `MotionGraphicProps.lensShaders`.
4. **Compositor-native** — renderer snaps accum FBO → `registerBackdropTexture`; `glassGpu.ts` renders all stacked lenses on the **compositor** GL context (no cross-context bind, no GPU→CPU readback). Canvas / per-element WebGL remains only when the GPU backdrop bus is absent.

## Author contract

```html
<div class="card kino-lens"><!-- or class="kino-lens" -->
  <!-- optional: data-lens="liquid-glass" | project path | other effects id -->
  <svg class="kino-lens-shape" viewBox="0 0 100 100" aria-hidden="true">…</svg>
  <span style="position:relative;z-index:2">Label</span>
</div>
```

CSS knobs: `--glass-strength`, `--glass-band`, `--glass-chroma`, `--glass-profile`,
`--glass-film`, `--glass-saturate`, `--glass-brightness`, `--glass-frost`, `--glass-edge-blur`,
`--glass-path` / `--glass-path-from` / `--glass-path-to`, `--glass-viewbox`, `--glass-morph`.

## Verification

```bash
npx vitest run tests/effectsLib.test.ts tests/render-glass.test.ts \
  tests/liquid-glass-showcase.test.ts tests/compositor-glass-composite.test.ts \
  tests/glass-shape.test.ts
```
