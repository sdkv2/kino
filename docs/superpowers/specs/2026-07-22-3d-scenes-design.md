# 3D Scenes in Kino — Design

**Date:** 2026-07-22
**Status:** Approved (approach chosen in brainstorm; this doc is the build contract)
**Branch:** `feat/3d-scenes`

## Goal

Real 3D beats in kino videos: product/device shots (spin a device with an app screenshot on
its screen), abstract 3D backgrounds (depth particle fields, floating geometry), and extruded
3D text/logo end cards. Agent-authored, deterministic, composited with the existing 2D layers.

## Non-goals (v1)

- Full modeled environments / camera fly-throughs of scenes (biggest-scope use case, cut).
- Skinned/animated glTF (mesh + material subset only; node transforms allowed).
- Shadow maps (fake contact shadows with gradient planes if needed; revisit v2).
- WASM or native render backend (the scene API is the seam; see Future).
- Brand-font 3D extrusion (v1 ships one default typeface; brand fonts later).
- HDR environment assets (procedural `RoomEnvironment` via PMREM instead).
- WebGPU (SwiftShader WebGL2 under `--disable-gpu` is the v1 target).

## Decision summary

three.js in the trusted page bundle, hidden behind a small curated **scene API**. Agent-authored
scenes are sandboxed JS (same trust model as Tier-2 motion), driven per-frame by JSON
`params`/`keyframes`/`triggers` from the spec. 3D renders to a transparent WebGL canvas that
sits in the existing layer stack (layered composite — no rework of DOM 2D).

Why not a WASM engine: in-browser WASM still draws through the same SwiftShader WebGL backend —
zero determinism gain, months of integration. Why not a custom renderer: IBL/PBR quality is the
money shot for device beats; three's PMREM/ACES pipeline gets there in weeks, and the seam keeps
a custom/WASM backend possible without spec changes. Bundle size is a non-issue (page served
from the local render server, booted once per worker).

## Engine facts this design builds on

- Native engine frame-steps a React page in headless Chrome: `window.kinoSeek(n)` does a
  synchronous `flushSync` commit, then the engine screenshots. Every frame is a pure function
  of frame index ([engine.ts](../../../src/render/native/engine.ts), [index.tsx](../../../src/render/native/page/index.tsx)).
- Chrome launches with `--disable-gpu --force-color-profile=srgb --force-device-scale-factor=1`
  → WebGL runs on SwiftShader (software, deterministic per machine) ([browser.ts](../../../src/render/native/browser.ts)).
- Motion graphics: Tier-1 static HTML, Tier-2 procedural JS (`render(env)` → HTML string,
  linted by a determinism denylist, executed via `new Function` behind a trust boundary),
  Tier-3 Lottie ([motiongraphic.ts](../../../src/render/motiongraphic.ts), [MotionGraphic.tsx](../../../src/render/native/page/MotionGraphic.tsx)).
- `motionFields` (`source`, `params`, `keyframes`, `triggers`) appear on motion beats and as
  `motionOverlay` on avatar/app beats ([schema.ts](../../../src/spec/schema.ts)).
- Frame cache: per-frame signature over resolved props + asset stat sigs; page-bundle hash is in
  the global sig, so bundling three invalidates caches exactly once ([frameCache.ts](../../../src/render/native/frameCache.ts)).
- Render server serves `publicDir` under `/public/` with an explicit MIME map ([server.ts](../../../src/render/native/server.ts)).

## Spec surface (no new schema)

A 3D scene is a new **motion source type**, dispatched by file extension: `*.scene.js`.

```yaml
segments:
  - kind: motion
    source: motion/phone-orbit.scene.js   # project asset; bare id resolves from assets-lib/motion/
    text: "Meet the new dashboard"
    params: { screenshot: "shots/dash.png", spin: 0.4 }
    keyframes:
      - { atWord: "dashboard", params: { zoom: 1.35 }, ease: overshoot }
    triggers:
      - { atWord: "new", action: pulse }
```

- Zero schema changes: `motionFields` already carries everything. Works as a full-screen motion
  beat **and** as `motionOverlay` on avatar/app beats, for free.
- `resolveMotionSource` learns the `.scene.js` extension (bare ids search it too; a bare id
  never matches both `<id>.js` and `<id>.scene.js` — resolution errors on ambiguity).
- JSON params/keyframes/triggers are the control surface — "JSON controls the JS scene code."
  Word-anchored keyframes (`atWord`) ride VO timing exactly like 2D motion.

## Scene module contract

A `.scene.js` file is the body of `scene(api)` and must return an `update(env)` function:

```js
// phone-orbit.scene.js — body of scene(api); returns update(env)
const phone = api.devicePhone({ screen: api.texture("shots/dash.png") });
api.env("studio");
api.dirLight({ intensity: 2.2, position: [2, 3, 2] });
const cam = api.camera({ fov: 35, position: [0, 0, 6] });

return (env) => {
  phone.rotation.y = env.progress * Math.PI * 2 * (env.params.spin ?? 1);
  cam.orbit({ radius: 6, y: 0.4, angle: env.progress * 0.8 });
  cam.zoom(env.params.zoom ?? 1);
  phone.scale.setScalar(1 + env.pulse * 0.04);
};
```

- **Build once, update per frame.** The body runs once at load (constructs the scene graph and
  requests assets); `update(env)` runs on every `kinoSeek` and must be a pure function of `env`.
- **`env` is the existing `MotionEnv`** (frame, t, progress, out/inout/overshoot/spring curves,
  pulse, resolved params, palette, width, height, words, durationFrames, duration) — one mental
  model across 2D and 3D.
- **Asset paths must be string literals** (`api.texture("shots/dash.png")`). Lint enforces this;
  node-side resolve statically extracts the literals to (a) verify files exist at build time and
  (b) stat them into the frame-cache signature.
- **Trust boundary identical to Tier-2:** local project config, linted, then `new Function`
  in the page. Scene code sees `api` only — never `THREE`, never DOM/window.

### Scene lint (mirrors Tier-2 `BANNED_JS`)

Banned: `Math.random`, `Date.*`/`new Date`/`performance.now`, RAF/timers, `fetch`/XHR,
`import`/`require`, `process`, `globalThis`/`window`/`document`, `eval`/`Function`, `atob`/`btoa`,
computed `Date[`/`Math[` access, inline `on*=` — same messages style, same string/comment blanking
(`stripJsNoise` reused). Additions:

- non-literal argument to `api.texture`/`api.gltf` → "asset paths must be string literals"
- seeded randomness comes from `api.random(seed)` (mulberry32) — the message for `Math.random`
  points there.

## Scene API (`api.*`) — the seam

Thin typed wrapper over three, in-repo (`src/render/native/page/scene/api.ts`, target ≤ ~500
lines + types). This file plus the skill doc is what agents read; it is also the backend seam —
a future WASM/native renderer reimplements this surface, specs untouched.

| Group | Surface (v1) |
|---|---|
| Roots | `api.camera(opts)` → rig with `.orbit({radius,y,angle})`, `.dolly(z)`, `.lookAt`, `.zoom(f)`; `api.group(...children)` |
| Geometry | `api.box/sphere/plane/cylinder/torus(opts)`, `api.roundedBox(opts)` |
| Device | `api.devicePhone({screen})` — procedural rounded-slab phone, front face textured with a `/public` still. No glTF asset to license/ship. |
| Models | `api.gltf("path.glb")` → node handle (meshes/materials/transform subset) |
| Text | `api.text3d(str, {size, depth, bevel})` — extruded via bundled default typeface JSON + three TextGeometry |
| Materials | `api.pbr({color, metalness, roughness, envIntensity, transparent, opacity})`, `api.basic(...)`, `api.emissive(...)` (palette colors accepted: `"mint"`, `"gold"`, …) |
| Lights/env | `api.dirLight`, `api.ambient`, `api.hemi`, `api.env("studio" \| "night" \| "none")` — PMREM from three `RoomEnvironment` (procedural, deterministic) |
| Particles | `api.particles(count, {spread, size, color, seed})` — instanced, positions from `api.random(seed)` |
| Textures | `api.texture("path")` — image/still from `/public`, sRGB, generated mips |
| Util | `api.random(seed)` → deterministic PRNG; `api.lerp`, `api.damp` (frame-driven, no wall clock) |

Handles expose a deliberately small mutable surface (`position`, `rotation`, `scale`, `visible`,
`material` params) — enough for choreography, small enough to document exhaustively in the skill.

## Rendering component & compositing

New page component `Scene3D.tsx` (sibling of `MotionGraphic.tsx`):

- Owns one `<canvas>` in an `AbsoluteFill`; `WebGLRenderer({ alpha: true, antialias: true,
  preserveDrawingBuffer: true })`, `setPixelRatio(1)`, `outputColorSpace = SRGBColorSpace`,
  `toneMapping = ACESFilmicToneMapping`, transparent clear.
- On each frame commit, a `useLayoutEffect` (same intentional no-deps pattern as `ShadowHtml`)
  runs `update(env)` then `renderer.render(scene, camera)` — synchronous inside the `flushSync`
  seek, so the screenshot always captures the finished frame. `preserveDrawingBuffer` keeps the
  buffer valid for the compositor.
- Async asset loads (textures, glTF, typeface) are collected at scene construction;
  `kinoLoad`/`kinoSeek` awaits them before `__kinoReady`/first paint (page already awaits fonts
  and images — same pattern, hook into the existing readiness path).
- **Layer position: exactly where the motion graphic renders today** — full-screen motion beat
  (layer 5) or overlay (layer 6) in [KinoVideo.tsx](../../../src/render/native/page/KinoVideo.tsx).
  Backdrop below, captions/logo/disclosure DOM above. That *is* the layered composite: one
  screenshot captures 3D + 2D together.
- `MotionGraphic` dispatches: `data.scene` set → render `Scene3D` (mutually exclusive with
  html/proc/lottie, enforced at resolve time).
- Motion→motion crossfade, `MotionFadeIn`, duration plumbing: unchanged (Scene3D lives inside the
  same slot). Canvas opacity fades via the existing wrapper — WebGL canvas in a fading
  AbsoluteFill composites correctly.
- WebGL context loss: fail loud (throw → `__kinoError`), engine retry semantics unchanged.
  Per-worker page isolation means at most a few contexts per browser — under Chrome's limit.

## Props & resolve pipeline

- `MotionGraphicProps` gains `scene?: string` (linted source) and `sceneAssets?: string[]`
  (project-relative paths extracted at resolve; already staged into `_public` by the build like
  other assets — reuse the existing staging that `params.screenshot`-style fields need. If v1
  staging misses scene assets, resolve stage adds them to the copy list).
- `motiongraphic.ts` resolve: extension dispatch on `fileName` — `.scene.js` → `lintSceneJs` +
  `extractSceneAssets` → props `{ scene, sceneAssets }`. Existing `.js` (Tier-2), `.html`,
  `.json` (Lottie) untouched.
- Asset existence verified node-side at resolve (build fails early with the asset path in the
  error, matching motion-source error style).

## Determinism

- SwiftShader software GL: same machine + same Chrome ⇒ same pixels. Cross-platform (CI matrix)
  may differ by a few low bits — treat like existing footage tolerance: **no golden-pixel
  assertions in CI**; structural/unit tests + smoke render only (consistent with current test
  posture; see kino-ci-cross-platform memory).
- Frame cache signature covers: scene source text (in props → segment sig), extracted asset stat
  sigs (append to segment sig alongside the existing `asset` stat), page bundle hash (three
  bump), params/keyframes/triggers (already in segment JSON).
- In-page determinism: lint bans wall-clock/random; `api.random` is seeded; three renders the
  same scene graph to the same pixels (no internal randomness in the used paths; PMREM/
  RoomEnvironment procedural and static).
- `three` pinned exact (no caret; latest stable at implementation time) — renderer output may
  change between minors; pageJsHash makes upgrades an explicit cache-busting event.

## Server / assets

- MIME additions: `.glb` → `model/gltf-binary`, `.gltf` → `model/gltf+json`, `.bin` →
  `application/octet-stream`.
- glTF loading via three `GLTFLoader` from `/public/...` URLs (http origin already in place; no
  CORS/taint issues).
- Default typeface JSON for `text3d` ships in the page bundle (imported, not fetched) — no
  network, no staging.

## Library presets (assets-lib/motion)

Ship three `.scene.js` starters that double as the skill's teaching examples:

1. `phone-orbit.scene.js` — procedural device slab, screenshot texture param, orbit + push-in,
   pulse trigger on the device scale.
2. `depth-particles.scene.js` — seeded instanced particle field, slow camera dolly, palette
   colors, `intensity` param.
3. `wordmark-3d.scene.js` — extruded `text` param, metallic PBR, studio env, orbit + settle
   (CTA-friendly, `seamlessLoop`-compatible: progress-driven full rotation).

## Docs & skills

- `docs/3d-scenes.md` — the contract doc (mirrors `docs/motion-graphics.md`): module shape, full
  `api.*` reference, lint rules, determinism rules, preset gallery.
- `docs/spec-reference.md` + `docs/motion-graphics.md` — short cross-linking sections
  (source-type table gains `.scene.js`).
- `skills/` (motion-design or sibling) gains a 3D authoring section pointing at the API source
  as ground truth — the agent reads `scene/api.ts` (small by design), not three.
- `kino motion` listing/linting covers `.scene.js` (lists ids, lints on demand).

## Testing

- **Unit (vitest, cross-platform):** scene lint rules (each ban + the string-blanking cases);
  asset-literal extraction; `resolveMotionSource` `.scene.js` dispatch + bare-id ambiguity error;
  frame-cache signature changes when scene source or referenced asset changes.
- **Render smoke (existing engine test style):** 1-beat scene spec, few frames,
  `KINO_NO_FRAME_CACHE=1` — assert render completes and a sampled frame differs from an
  empty-scene render (canvas actually drew). No pixel goldens.
- **Determinism check:** render same 3-frame scene twice on one machine, byte-compare captures.
- **Quality gate (manual, per render-quality-validation memory):** demo spec per preset,
  `kino storyboard` + adversarial-critique pass before calling the feature done.

## Risks

| Risk | Mitigation |
|---|---|
| SwiftShader slow on heavy scenes → long renders | Frame budget note in docs; presets kept light (≤ ~50k tris, one dir light, no shadows); storyboard iteration uses cached frames |
| Canvas capture timing (WebGL not flushed at screenshot) | Synchronous `renderer.render` in layout effect inside `flushSync` + `preserveDrawingBuffer: true`; determinism test catches regressions |
| three minor bumps change pixels | Exact version pin; upgrades deliberate |
| Async asset load breaks pure-frame contract | All loads resolved before ready; `update(env)` never awaits |
| Agent writes non-literal asset paths | Lint error with fix-it message |
| glTF models with unsupported features (skinning, KHR extensions) | Loader warns + renders static mesh subset; documented limits |

## Future (explicitly out, seam-ready)

- Custom/WASM software rasterizer behind `api.*` for bit-identical cross-platform output and
  Chrome-free rendering (kino already has the stills pipeline pattern: `videoFrames.ts`).
- Brand-font typeface conversion for `text3d`; shadow maps; HDR env assets; skinned glTF;
  background-layer scenes (`background: "custom"` 3D variant); WebGPU when headless story matures.
