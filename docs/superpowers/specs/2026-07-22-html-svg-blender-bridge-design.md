# HTML/SVG → Blender bridge (kino 3D scenes)

**Date:** 2026-07-22
**Status:** Approved design, pre-implementation

## Problem

The agent's strongest visual authoring surface is HTML/CSS/JS (Tier-1/2 already
use it via the native Chrome engine). The Blender backend (Tier-3) can only
consume static PNG textures (`api.texture`), so 3D beats are stuck with
pre-baked screenshots: no live UI on phone screens, no vector-crisp brand
elements, no per-element choreography.

## Solution overview

Pre-rasterize agent-authored HTML/SVG into the beat's `_scene3d/<hash>/` cache
**before** Blender runs, then mount the results as textured objects. Chrome and
Blender never communicate at render time. Two primitives:

| Primitive | Input | Raster cadence | 3D form |
|---|---|---|---|
| `api.screen(path)` | `.html` (Tier-1 contract, `--kino-*` vars, word-timing props) | per-frame PNG sequence | screen texture (phone or any mesh) |
| `api.layer(path, props)` | one `.svg` per element | once, high-res, alpha | own plane, independently animated in 3D |

Key decision: **many SVGs, not one composition.** Each visual element (logo,
chart, card, text block) is its own SVG file declared separately in scene.js,
so each gets its own depth, material, and keyframes. Parallax and staggered
entrances come from 3D transforms, not re-rasterization.

## Architecture / data flow

```
scene.js body                 recorder (recordApi.ts)        rasterize pass                blender (kino_render.py)
api.screen("s/dash.html") ──▶ screen decl {path, res} ─────▶ native engine, beat-local ──▶ image-sequence texture,
                                                             frames + word props           unlit/emissive screen mat
api.layer("svg/logo.svg",──▶ layer decl {path, props} ────▶ rasterize once w/ alpha ────▶ plane per layer, transform
  {z:0.2, material:"unlit"})                                 (Chrome, existing dep)        keyframes from timeline
```

- Rasterize pass runs in `runScene.ts` territory, before the Blender
  invocation, writing into the beat cache dir.
- Cache hash extends with: html/svg file content, injected props, target
  resolution. Unchanged inputs → free re-render, same as today.
- Eevee draft and Cycles final consume identical raster assets.

## Authoring surface (scene.js)

```js
export default function scene(api) {
  const screen = api.screen(api.param("screen"));       // .html → animated
  const phone  = api.devicePhone({ screen });
  const logo   = api.layer("svg/logo.svg",  { z: 0.30, material: "unlit" });
  const chart  = api.layer("svg/chart.svg", { z: 0.10, material: "emissive", emission: 2.0 });
  return (env) => {
    logo.set({ y: 0.4 + env.params.logoLift, opacity: env.params.logoIn });
    // camera setters absolute, as today
  };
}
```

- `api.screen` accepted anywhere a `TextureHandle` is today; `phone-orbit`'s
  `screenshot` param accepts `.html` paths.
- Per-layer properties, all keyframeable through `env.params` / `atWord`:
  position xyz (z = depth), rotation, scale, opacity, `emission`.
- Material presets: `unlit` (default — crisp UI), `emissive` (lights scene),
  `glass-card`.
- Module contract unchanged: body runs once (declarations), `update(env)` pure.
- Lint additions: declared paths must exist under `assets/`; minimum z-gap
  between layers to prevent z-fighting.

## Per-frame sync (screens)

`api.screen` sequences are rendered by the existing native engine with the same
word-timing props Tier-1 receives, at beat-local times. `atWord` keyframes can
therefore drive camera and screen state off the same words. No new sync
machinery — determinism inherited from the frame-locked engine.

## Error handling

- Missing/unparseable html or svg → build fails on the named beat with path in
  the message (same posture as missing Blender).
- Raster pass failure → beat fails; never silently falls back to blank texture.
- Layer z-collisions → lint warning at record time, not a render surprise.

## Phases

1. **P1** — `api.screen` (VO-synced sequence) + `api.layer` (multi-SVG planes).
   Upgrade `phone-orbit` to accept `.html` screens. Canvas/JS procedural
   textures come free (an html screen can host a `<canvas>`).
2. **P2** — `api.svg3d(path)`: same SVG files imported as Blender curves,
   extruded, brand material. For layers needing true geometry (metal logo).
3. **P3** — composite-after crispness flag for extreme close-ups, **only** if
   draft stills show screen text too soft.

Skipped deliberately: CSS-as-material DSL, flexbox-style 3D layout DSL —
speculative; scene.js setters carry the load. Revisit on a real beat's demand.

## Testing

- Unit: recorder captures screen/layer declarations; hash changes when
  html/svg content, props, or resolution change; lint rejects missing paths
  and z-collisions.
- Integration: one fixture beat with an html screen + two SVG layers; assert
  raster files appear in cache and timeline.json carries the objects.
- Visual: existing loop — `kino storyboard` draft stills must show legible
  screen UI, clean alpha edges on layers, no z-fighting; then
  `adversarial-critique` gate before final.

## Craft bar addition

| Beat type | Must read on a draft still |
|---|---|
| Layered SVG | Each element crisp at rest; visible depth separation on camera move; no halo/fringe on alpha edges |
| HTML screen | Typed/animated UI legible mid-orbit; state lands on spoken words |
