# 3D scenes

3D scenes let an agent author a **`.scene.js`** file — a small scene graph behind kino's curated
**scene API** — for beats that need real geometry: a device product shot (spin a phone with an app
screenshot on its screen), an abstract depth background, or an extruded 3D wordmark end card. It's a
new **motion source type**, dispatched by the `.scene.js` extension. The JSON spec still owns the
clock; your scene reads the same `env` a Tier-2 motion graphic gets.

**Backend:** Node runs the scene against a **recording** `api` (`runScene`) → per-beat JSON timeline
→ one fixed `scripts/kino_render.py` inside **Blender** (Eevee drafts / Cycles finals) → transparent
PNG stills composited via `SceneFrames` in the existing 2D layer stack. The `.scene.js` / `api.*`
surface is unchanged; only the renderer moved off WebGL.

**Requires Blender ≥ 4.2** for any beat that uses a `.scene.js` source:

```bash
brew install --cask blender   # or set KINO_BLENDER=/path/to/blender
kino doctor                   # should show Blender X.Y (…)
```

Run `kino motion` to list bundled ids (the three presets show up alongside the HTML/JS graphics).

- [Why it's shaped this way](#why-its-shaped-this-way)
- [Quality tiers (draft / final / max)](#quality-tiers-draft--final--max)
- [The module contract](#the-module-contract)
- [Driving it from the spec](#driving-it-from-the-spec)
- [Build-time vs per-frame params](#build-time-vs-per-frame-params)
- [The `api.*` reference](#the-api-reference)
- [Determinism & safety (the lint)](#determinism--safety-the-lint)
- [Preset gallery](#preset-gallery)
- [Debugging timelines](#debugging-timelines)
- [Perf budget & limits](#perf-budget--limits)

## Why it's shaped this way

Same trust and determinism model as [motion graphics](motion-graphics.md): kino renders by seeking to
frame *N* and screenshotting — there is no wall clock running. A scene must therefore be a **pure
function of frame state**. Blender is an implementation detail hidden behind the `api` object; scene
code never imports three/bpy, never touches the DOM, and gets `api` only. The source is linted for
determinism/safety and executed via `new Function` in Node (recording api) — local project config,
linted, trusted translator.

The recording surface (`src/render/scene/recordApi.ts`) is deliberately small and fully documented,
and it is the **backend seam**: Blender's `kino_render.py` reimplements this surface without any
spec changes. **That file is ground truth — read it.** This doc mirrors it; where they ever differ,
the code wins.

## Quality tiers (draft / final / max)

| Tier | Engine | Samples | When |
|---|---|---|---|
| `draft` | Eevee | fixed TAA | storyboard / still (default); `kino build --draft` |
| `final` | Cycles | 128 | unauthored beats on a real build; `kino still … --final` |
| `max` | Cycles | 512 | hero shots that need more samples |

Set per beat/overlay via `quality: "draft" | "final" | "max"` on the motion fields. Unauthored beats
default **`final`** on `kino build` (no `--draft`). Preview commands force draft unless `--final`.

Stills cache under `out/<title>/_scene3d/<timeline-hash>/`. Changing source, params, words, dims,
fps, or quality invalidates the hash — unchanged beats skip Blender. HTML screen and SVG layer
raster outputs are content-addressed under `_public/_screens/<digest>/` and
`_public/_layers/<digest>.png`; Chrome raster runs only on a Blender cache miss.

## The module contract

A `.scene.js` file is the **body of `scene(api)`** and must **return an `update(env)` function**:

```js
// phone-orbit.scene.js — body of scene(api); returns update(env)
const phone = api.devicePhone({ screen: api.screen(api.param("screenshot")) });
api.env("studio");
api.dirLight({ intensity: 2.4, position: [2.5, 3, 2] });
const cam = api.camera({ fov: 32 });

return (env) => {
  const spin = Number(env.params.spin ?? 0.35);
  phone.rotation.y = -0.5 + env.inout * spin * Math.PI * 2;
  cam.orbit({ radius: 5.2, y: 0.35, angle: 0.25 - env.progress * 0.4 });
  phone.scale.setScalar(1 + env.pulse * 0.05);
};
```

- **Build once, update per frame.** The body runs **once** — it constructs the recorded scene graph.
  The returned `update(env)` runs on **every frame** and must be a pure function of `env` (no
  accumulation across frames — see [setters are absolute](#the-api-reference)).
- **`env` is the same `MotionEnv` as Tier-2** (`docs/motion-graphics.md` §Procedural graphics).
- Handles expose `.position`, `.rotation`, `.scale`, `.visible`, `.material`, plus camera rig methods.

## Driving it from the spec

A `.scene.js` source is referenced **exactly like any other motion source** — no new schema beyond
optional `quality`. It works as a full-screen `kind:"motion"` beat and as a `motionOverlay` on an
`avatar`/`app` beat, and it carries the same `params` / `keyframes` / `triggers` timing controls
(`atWord` anchoring included). See [Spec reference](spec-reference.md#motion-segment).

```yaml
segments:
  - kind: motion
    source: phone-orbit
    text: "Meet the new dashboard"
    quality: draft          # optional; omit → final on build
    params: { screenshot: "shots/dash.png", spin: 0.4, zoom: 1 }
    keyframes:
      - { atWord: "dashboard", params: { zoom: 1.35 }, ease: overshoot }
```

## Build-time vs per-frame params

A beat's `params` are readable **two ways**, and the difference is load-bearing:

| Read | When | Keyframeable? | Use for |
|---|---|---|---|
| `api.params.X` (in the scene **body**) | **build time**, once | **No** | geometry, colors, counts, sizes |
| `api.param("X")` → `texture`/`gltf` | **build time** (asset resolved before render) | **No** | asset paths |
| `env.params.X` (inside **`update(env)`**) | **per frame** | **Yes** | choreography |

## The `api.*` reference

Every member below is exported from **`src/render/scene/recordApi.ts`** — that file is the authority.
Palette color names (`"mint"`, `"green"`, `"night"`, `"white"`, `"gold"`) resolve to the brand
palette; anything else is a raw CSS color.

### Roots

| Member | What it does |
|---|---|
| `api.camera({ fov?, position? })` | Configure the single scene camera; returns a **rig**. Default fov 40, position `[0,0,6]`. |
| `rig.orbit({ radius, y?, angle? })` | Place the camera on a horizontal ring, looking at the origin. |
| `rig.dolly(z)` | Set camera world-Z (**absolute**). |
| `rig.lookAt(x, y, z)` | Aim at a world point. |
| `rig.zoom(f)` | Zoom factor (`>1` magnifies). |
| `api.group(...children)` | Re-parent objects under one group (the group is the transform handle). |

> **Camera setters are ABSOLUTE.** Every rig method writes final state from its args.

### Geometry / device / text / models

| Member | Notes |
|---|---|
| `api.box` / `sphere` / `plane` / `cylinder` / `torus` / `roundedBox` | Primitives; materials optional. |
| `api.devicePhone({ screen, width?, height?, depth?, radius? })` | Procedural rounded-slab phone + screen texture (Blender: bevel/subsurf body + emissive screen). |
| `api.screen(pathOrParam)` | Screen texture. `.html` → VO-synced animated sequence (Tier-1 contract: `--kino-*` vars, `--progress`, `--kino-words-shown`; rasterized 720×1556 before Blender). Image paths pass through like `api.texture`. |
| `api.layer(pathOrParam, {x,y,z,width,material,emission})` | One SVG element as its own plane (alpha PNG, 2048px long edge). `width` in world units, height from the SVG aspect. `material: "unlit"` (default) or `"emissive"` + `emission`. Animate via handle transforms + `.material.opacity`. Layer z values must differ by ≥ 0.02. |
| `api.gltf(pathOrParam)` | glTF/glb under `_public` (Blender native import). |
| `api.text3d(str, { size?, depth?, bevel?, material? })` | Extruded text. `geometry.computeBoundingBox()` / `boundingBox` is a **shim** (glyph advance ≈ `0.62·size·length`) for fit-to-frame — Blender uses its own font metrics for the mesh. |

### Materials / lights / env / post

| Member | Notes |
|---|---|
| `api.pbr` / `basic` / `emissive` | PBR maps to Principled BSDF (incl. clearcoat → Coat Weight). |
| `api.dirLight` / `ambient` / `hemi` | Sun / world bump / soft overhead area. |
| `api.env("studio"\|"night"\|"none")` | Studio softbox rig + gradient world (night = 0.35 energy). |
| `api.contactShadow({ radius?, opacity?, y? })` | Draft: soft disc. **Cycles finals: real shadow catcher.** Animate `.material.opacity` / `.scale`. |
| `api.post({ bloom })` | Eevee/Cycles compositor glare from `{strength,radius,threshold}`. |

### Particles / helpers

| Member | Notes |
|---|---|
| `api.particles(count, { spread?, size?, color?, seed? })` | Positions seeded **node-side** (`mulberry32`) into `opts.positions` — Python does no random. |
| `api.random(seed)` / `api.param` / `api.lerp` / `api.damp` / `api.params` | Same contracts as before. |

## Determinism & safety (the lint)

`lintSceneJs` bans `Math.random`, `Date`, timers, network, `require`/`import`, `process`, DOM, `eval`,
etc. — same list as before. The runner also shadows banned globals to `undefined` when executing.
Particle positions and `api.random` use seeded mulberry32 only.

## Preset gallery

| Id | Job | Key params |
|---|---|---|
| `phone-orbit` | Device product shot | `screenshot` (required — `.png`/`.jpg` still or `.html` animated screen), `spin`, `zoom` |
| `depth-particles` | Abstract depth field | `intensity`, `color` |
| `wordmark-3d` | CTA extruded mark | `text`, `depth` |

## Debugging timelines

Each rendered beat writes `out/<title>/_scene3d/<hash>/timeline.json` next to `f00001.png…`. Open it
to inspect objects, materials, camera, and per-frame transforms when a still looks wrong.

## Perf budget & limits

- **Draft (Eevee):** seconds/frame at 1080×1920 — storyboard-friendly.
- **Final (Cycles 128):** roughly **5–15 min/beat** on Apple Silicon Metal (budget claim); cache hits
  make re-builds cheap.
- v1 holds: no skinned glTF, no authored DOF/volumetrics, no HDRI assets, no farm rendering.
