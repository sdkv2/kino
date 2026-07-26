# kino-glass refraction under the GL compositor

**Status:** **Fixed.** Compositor path uses GPU→CPU readback (`publishCompositorBackdrop` in
`compositor/backdropReadback.ts`) into the shared `backdrop` bus (`backdrop.ts`), then the glass
post-effect (`motionPostEffects/glass.ts`) samples via the canvas path in `liquidGlass.ts`.

## What was broken

WebGL textures are not shareable across contexts. The compositor tried to pass `dest.tex` directly
into per-element glass WebGL contexts → black samples → flat film-only cards.

## Fix shipped (option 2: canvas readback)

Before a motion layer with `needsCompositorBackdrop()` draws, the renderer readbacks the accumulated
composite into a 2D canvas and calls `registerBackdrop()`. Stacked panels merge compositor-under +
base raster via `registerMergedBackdrop()`.

## Verification

```bash
npx vitest run tests/liquid-glass-showcase.test.ts tests/compositor-glass-composite.test.ts
```

Visual: `projects/compositor-demo/specs/glass-refraction-demos.json` beats 1–5.

## Deferred

Render mirrors in the compositor's own GL context (option 1) — avoids readback cost but needs glass
to stop travelling through the motion 2D raster or to blit mirrors back as compositor layers.
