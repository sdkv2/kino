# 3D scenes

3D scenes let an agent author a **`.scene.js`** file — a small three.js scene behind kino's curated
**scene API** — for beats that need real geometry: a device product shot (spin a phone with an app
screenshot on its screen), an abstract depth background, or an extruded 3D wordmark end card. It's a
new **motion source type**, dispatched by the `.scene.js` extension. The JSON spec still owns the
clock; your scene reads the same `env` a Tier-2 motion graphic gets, and kino renders it
deterministically to a transparent WebGL canvas composited into the existing 2D layer stack.

Run `kino motion` to list bundled ids (the three presets show up alongside the HTML/JS graphics).

- [Why it's shaped this way](#why-its-shaped-this-way)
- [The module contract](#the-module-contract)
- [Driving it from the spec](#driving-it-from-the-spec)
- [Build-time vs per-frame params](#build-time-vs-per-frame-params)
- [The `api.*` reference](#the-api-reference)
- [Determinism & safety (the lint)](#determinism--safety-the-lint)
- [Preset gallery](#preset-gallery)
- [Perf budget & limits](#perf-budget--limits)

## Why it's shaped this way

Same trust and determinism model as [motion graphics](motion-graphics.md): kino renders by seeking to
frame *N* and screenshotting — there is no wall clock running. A scene must therefore be a **pure
function of frame state**. three.js is an implementation detail hidden behind the `api` object; scene
code never imports three, never touches the DOM, and gets `api` only. The source is linted for
determinism/safety and executed via `new Function` behind the same trust boundary as Tier-2
procedural JS — local project config, linted, run in the page.

The `api` file (`src/render/native/page/scene/api.ts`) is deliberately small and fully documented,
and it is the **backend seam**: a future WASM/native renderer reimplements this surface without any
spec changes. **That file is ground truth — read it.** This doc mirrors it; where they ever differ,
the code wins.

## The module contract

A `.scene.js` file is the **body of `scene(api)`** and must **return an `update(env)` function**:

```js
// phone-orbit.scene.js — body of scene(api); returns update(env)
const phone = api.devicePhone({ screen: api.texture(api.param("screenshot")) });
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

- **Build once, update per frame.** The body runs **once at mount** — it constructs the scene graph
  and requests async assets (textures, glTF). The returned `update(env)` runs on **every frame** and
  must be a pure function of `env` (no accumulation across frames — see [setters are absolute](#the-api-reference)).
- **`env` is the same `MotionEnv` as Tier-2** (`docs/motion-graphics.md` §Procedural graphics). It
  carries: `frame`, `t` (seconds), `progress` (0→1, never exactly 1), the eased curves `out` /
  `inout` / `overshoot` / `spring`, `edge` (`sin(progress·π)` — 0 at both beat ends, seam-safe),
  `pulse` (trigger envelope), `params` (resolved per-frame beat params), `palette`
  (`{mint,green,night,white,gold,font}`), `width`, `height`, `words` (beat-relative VO timings),
  `durationFrames`, `duration`. One mental model across 2D and 3D.
- Handles returned by the api (`box`, `devicePhone`, `text3d`, a `camera` rig, …) expose the small
  mutable surface you choreograph: `.position`, `.rotation`, `.scale`, `.visible`, `.material`, plus
  the camera rig methods. Every builder is added to the scene root for you.

## Driving it from the spec

A `.scene.js` source is referenced **exactly like any other motion source** — no new schema. It works
as a full-screen `kind:"motion"` beat and as a `motionOverlay` on an `avatar`/`app` beat, and it
carries the same `params` / `keyframes` / `triggers` timing controls (`atWord` anchoring included).
See [Spec reference](spec-reference.md#motion-segment).

```yaml
segments:
  - kind: motion
    source: motion/phone-orbit.scene.js   # project asset; a bare id (no / or .) resolves from assets-lib/motion/
    text: "Meet the new dashboard"
    params: { screenshot: "shots/dash.png", spin: 0.4, zoom: 1 }
    keyframes:
      - { atWord: "dashboard", params: { zoom: 1.35 }, ease: overshoot }
    triggers:
      - { atWord: "new", action: pulse }
```

As an overlay on an app beat:

```json
"motionOverlay": { "source": "motion/depth-particles.scene.js", "params": { "intensity": 0.7 } }
```

## Build-time vs per-frame params

A beat's `params` are readable **two ways**, and the difference is load-bearing:

| Read | When | Keyframeable? | Use for |
|---|---|---|---|
| `api.params.X` (in the scene **body**) | **build time**, once at mount | **No** | choosing geometry, colors, counts, sizes — anything baked into the graph |
| `api.param("X")` passed to `api.texture` / `api.gltf` | **build time** (asset resolved before render) | **No** | asset paths |
| `env.params.X` (inside **`update(env)`**) | **per frame** | **Yes** — tweened by `keyframes` | choreography: rotation, position, camera moves |

Keyframes tween the **per-frame** value, so they only reach a param read through `env.params`. A param
read at build time via `api.params` / `api.param` is fixed for the whole beat — keyframing it does
nothing. The presets show both: `phone-orbit` reads `spin`/`zoom` through `env.params` (keyframeable
choreography) but `screenshot` through `api.param` (a build-time asset); `wordmark-3d` reads
`text`/`depth` through `api.params` (build-time geometry — you can't tween the glyph mesh);
`depth-particles` reads `color` through `api.params` (build-time material).

## The `api.*` reference

Every member below is exported from **`src/render/native/page/scene/api.ts`** — that file is the
authority (exact defaults, option shapes, and doc comments live there; read it before authoring). One
line + signature each. Palette color names (`"mint"`, `"green"`, `"night"`, `"white"`, `"gold"`)
resolve to the brand palette; anything else is a raw CSS color.

### Roots

| Member | What it does |
|---|---|
| `api.camera({ fov?, near?, far?, position? })` | Configure the single scene camera; returns a **rig** (below). Default fov 40, position `[0,0,6]`. |
| `rig.orbit({ radius, y?, angle? })` | Place the camera on a horizontal ring of `radius` at height `y`, `angle` in radians, looking at the origin. |
| `rig.dolly(z)` | Set the camera's world-Z (**absolute** — larger `z` pulls back from origin). |
| `rig.lookAt(x, y, z)` | Aim the camera at a world point. |
| `rig.zoom(f)` | Zoom factor (`>1` magnifies); updates the projection. |
| `rig.three` | The raw `THREE.PerspectiveCamera` for anything the rig doesn't cover. |
| `api.group(...children)` | Re-parent objects under one `Group` (the group is the transform handle). |

> **Camera setters are ABSOLUTE.** Every rig method writes the camera's final state from its args and
> never reads the prior camera state. `update(env)` reruns every frame, so a *relative* op (e.g.
> `translateZ`) would accumulate and make the camera depend on frame history. Keep `update(env)` a
> pure function of `env`: same `env` in ⇒ same camera out.

### Geometry

| Member | What it does |
|---|---|
| `api.box({ size?, material? })` | Box mesh; `size` is `[x,y,z]` (default unit cube). |
| `api.sphere({ radius?, material? })` | Sphere mesh (default radius 0.5). |
| `api.plane({ size?, material? })` | Flat plane; `size` is `[width,height]`. |
| `api.cylinder({ radius?, height?, material? })` | Cylinder (uniform radius). |
| `api.torus({ radius?, tube?, material? })` | Torus (ring) mesh; `radius` is the ring, `tube` its thickness. |
| `api.roundedBox({ size?, radius?, material? })` | Rounded-corner box; `radius` is the corner rounding. |

### Device

| Member | What it does |
|---|---|
| `api.devicePhone({ screen, width?, height?, depth?, radius? })` | Procedural rounded-slab phone: dark **clearcoat** body (physical material, glossy device-shell sheen) + an **unlit** screen plane showing the `screen` texture (not tone-mapped). No glTF asset to license or ship. |

### Models

| Member | What it does |
|---|---|
| `api.gltf(pathOrParam)` | Load a glTF/glb model (cached per URL) → a `Group` added to root now, filled in when the load settles. Path is a string literal or `api.param("name")`. Mesh + material + node-transform subset only. |

### Text

| Member | What it does |
|---|---|
| `api.text3d(str, { size?, depth?, bevel?, material? })` | Centered extruded 3D text using the **bundled Helvetiker typeface** (default depth 0.3, bevel on). |

### Materials

| Member | What it does |
|---|---|
| `api.pbr({ color?, metalness?, roughness?, envMapIntensity?, transparent?, opacity?, map?, clearcoat?, clearcoatRoughness? })` | Physically-based material (defaults metalness 0.1, roughness 0.6, `envMapIntensity` 1). Setting **`clearcoat`** or **`clearcoatRoughness`** upgrades it to a MeshPhysicalMaterial — a glossy lacquer coat over the base (the premium "wet" sheen of a phone shell); all other options carry over. Without them it's a MeshStandardMaterial as before. |
| `api.basic({ color?, map?, transparent?, opacity? })` | Unlit material (ignores lighting) — screenshots / emissive-flat surfaces. |
| `api.emissive({ color?, intensity? })` | Self-lit material that glows without a light; `color` is the emission. |

> The physically-based env-reflection knob is **`envMapIntensity`** (not `envIntensity`).

### Lights / env

| Member | What it does |
|---|---|
| `api.dirLight({ color?, intensity?, position? })` | Directional (sun) light. |
| `api.ambient({ color?, intensity? })` | Ambient fill (uniform, no direction; default intensity 0.4). |
| `api.hemi({ sky?, ground?, intensity? })` | Hemisphere light: sky color above, ground color below. |
| `api.env("studio" \| "night" \| "none")` | Select the image-based environment. `"studio"` is a **procedural softbox studio** — a dim gradient dome plus bright **strip** softboxes (key + rims), PMREM'd into an env map for real, shaped speculars on metal/clearcoat. Deterministic, no HDR asset. `"night"` reuses the same env at 0.35 intensity (dimmer reflections, same shapes). Strips (not broad cards) are deliberate: a flat metal face mirrors a wide card as a full-face white wash that bloom blows to a blob, whereas a narrow strip only ever reflects a thin highlight streak. |

### Grounding

| Member | What it does |
|---|---|
| `api.contactShadow({ radius?, opacity?, y? })` | **Fake** blurred ground shadow: a flat disc with a radial-alpha texture laid in the XZ plane under the subject (defaults radius 1.4, opacity 0.35, y −1). Grounds a product shot cheaply. **Not light-coupled** — it doesn't move with any light, respect occluders, or cast anything. Returns the mesh; animate `.material.opacity` / `.scale` / `.position` from `update(env)`. |

### Post-processing

| Member | What it does |
|---|---|
| `api.post({ bloom: { strength?, radius?, threshold? } })` | Opt-in post FX (call in the scene **body**). When `bloom` is set, Scene3D swaps the direct render for an **EffectComposer** chain (RenderPass → UnrealBloomPass → OutputPass) — bright speculars glow. `threshold` is a **linear-HDR** cutoff (bloom runs pre-tone-map): raise it so only true hotspots bloom, not broad mid-grey areas. Alpha is preserved (the composer clears transparent), so the 2D layers beneath the canvas still show through. Bloom works on SwiftShader too (a little slower). |

### Particles

| Member | What it does |
|---|---|
| `api.particles(count, { spread?, size?, color?, seed? })` | InstancedMesh of `count` small spheres, positions seeded by `api.random(seed)` inside a `±spread` cube (default spread 10, size 0.06, color `"white"`, seed 1). |

### Textures

| Member | What it does |
|---|---|
| `api.texture(pathOrParam)` | Load an image as an sRGB texture (cached per URL), usable as a material `map` immediately. Path is a string literal or `api.param("name")`. |

### Util

| Member | What it does |
|---|---|
| `api.random(seed)` | Seeded PRNG factory (`mulberry32`): `api.random(seed)()` → next float in `[0,1)`. The **only** randomness allowed. |
| `api.param(name)` | Deferred param reference; pass to `api.texture`/`api.gltf` to resolve `params[name]` as an asset path at load time. |
| `api.params` | Read-only resolved beat params (e.g. `api.params.text`) for **build-time** reads (see [above](#build-time-vs-per-frame-params)). |
| `api.lerp(a, b, t)` | Linear interpolate `a`→`b` by `t` (0..1). |
| `api.damp(x, y, lambda, dt)` | Frame-rate-independent smoothing toward a target. |

## Determinism & safety (the lint)

The build **rejects** a scene that breaks determinism or the sandbox, from
[`src/render/scene.ts`](../src/render/scene.ts). Each message tells you what to do instead:

| Rejected | Why / instead |
|---|---|
| `Math.random` | Breaks determinism — use `api.random(seed)`. |
| `Date.now` / `performance.now` / `new Date` | Break determinism — drive motion from `env.t` / `env.frame`. |
| `requestAnimationFrame` / `setTimeout` / `setInterval` | Timers/RAF aren't allowed — kino calls `update(env)` once per frame. |
| `fetch` / `XMLHttpRequest` | No network — assets load through `api.texture` / `api.gltf`. |
| `import` / `require(` | The scene body must be self-contained (three is reachable only through `api.*`). |
| `process` | The scene runs in the browser, not Node. |
| `globalThis` / `window` / `document` | Build the scene through `api.*`. |
| `eval` / `Function(` | The scene must be a pure function of `api` and `env`. |
| `atob` / `btoa`, computed `Date[` / `Math[`, inline `on*=` | Banned (same set as Tier-2). |

**Asset paths** passed to `api.texture` / `api.gltf` must be a **string literal** or **`api.param("name")`**
— nothing computed. kino statically extracts these at build time to (a) verify the files exist (build
fails early, naming the missing asset) and (b) stat them into the frame-cache signature. A call whose
argument is neither form fails the lint:

> `api.texture/api.gltf arguments must be string literals or api.param("name") — kino resolves and caches assets before render`

Paths must be relative project-asset paths (no leading `/`, no `..`, no `scheme:` URLs). Calls that
appear **inside comments or string literals are ignored** (comment/string spans are blanked before
the scan) — so an example in a comment won't conjure a phantom asset the build then demands.

**Engine note.** 3D needs a WebGL context. By default kino launches Chrome with `--disable-gpu`, so the
context comes from **SwiftShader** (pure software rasterizer) — recent Chrome gates that deprecated
fallback behind **`--enable-unsafe-swiftshader`**, which the engine sets ([`src/render/native/browser.ts`](../src/render/native/browser.ts)).
Software GL is deterministic on a given machine (same machine + same Chrome ⇒ same pixels), so there
are **no golden-pixel assertions across the CI matrix** — a few low bits may differ per platform,
same tolerance as footage. Set **`KINO_GPU=1`** to opt into a real GPU context instead (ANGLE/Metal on
darwin) for quality and speed — it trades that bit-determinism guarantee, and Scene3D supersamples 2×
in this mode (see [GPU mode & supersampling](#perf-budget--limits)).

## Preset gallery

Three starters live in [`assets-lib/motion/`](../assets-lib/motion/) — copy into a project's
`assets/motion/`, or reference by bare id (`"source": "phone-orbit"`). They double as teaching
examples; read the files.

| Preset | What it is | Params |
|---|---|---|
| `phone-orbit.scene.js` | Device product shot: **clearcoat**-body phone with a screenshot on its screen, orbit + progress push-in, pulse pop, grounded by a fake **contact shadow**. | `screenshot` (required asset path, build-time) · `spin` (turns, default 0.35, per-frame) · `zoom` (default 1, per-frame) |
| `depth-particles.scene.js` | Abstract depth field: seeded particle cloud, slow dolly, palette fog, low-strength **bloom** so the points glow. **Seam-safe** — all motion is `env.edge`-driven so first/last frames match (loops clean). | `intensity` (0..1, default 0.6, per-frame) · `color` (field color, palette name, **build-time**, default `"mint"`) |
| `wordmark-3d.scene.js` | CTA end card: extruded brushed-metal wordmark, softbox reflections, **bloom** glints on the speculars, fake **contact shadow**. Full rotation with a double-smoothstep easing (long readable holds at the facing ends) → `seamlessLoop`-compatible. | `text` (**build-time**, default `"KINO"`) · `depth` (**build-time**, default 0.3) |

## Perf budget & limits

The default engine mode is software (SwiftShader) — keep scenes light so renders stay fast:

- **≤ ~50k triangles**, **one directional light**, **no shadow maps** (use `api.contactShadow` for a
  fake ground shadow instead). The presets stay inside this. **Bloom** (`api.post`) works in software
  but adds a post pass per frame; it's fine for the presets but noticeably heavier than a plain scene.

**GPU mode & supersampling.** With `KINO_GPU=1` (real ANGLE/Metal context — see the [engine note](#determinism--safety-the-lint))
Scene3D renders the WebGL buffer at **2×** and lets the canvas downscale it (cheap SSAA — cleaner
edges and speculars). Software mode stays 1×. The render mode is in the frame-cache signature, so GPU
and software frames never cross-serve. Nothing in a `.scene.js` changes between modes — the page reads
the flag from the render config.

v1 limits (seam-ready — see the design doc's Future section):

- **No skinned / animated glTF** — mesh + material + node-transform subset only (node transforms you
  set are fine; skinning/morph animation isn't).
- **No shadow maps** — `api.contactShadow` is a fake (no light coupling).
- **Default typeface only** — `text3d` uses the bundled Helvetiker face; brand-font 3D extrusion
  isn't supported in v1.
- **No HDR environment assets** — `api.env` is a procedural softbox studio (`studio`/`night`/`none`).

See also: [Motion graphics](motion-graphics.md) · [Spec reference](spec-reference.md) · [Build & preview](build-and-preview.md).
