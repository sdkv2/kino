# Blender Backend for Kino 3D Scenes — Design

**Date:** 2026-07-22
**Status:** Approved (supersedes the render-backend portion of `2026-07-22-3d-scenes-design.md`; the spec surface, lint, and pipeline sections of that doc remain in force)
**Branch:** `feat/3d-scenes` (continues)

## Goal

Studio-quality 3D beats. The in-browser three.js/WebGL renderer (built earlier on this branch)
tops out at "good realtime" — user verdict on its output: cheap. Replace it with Blender as the
single 3D backend: **Eevee** for fast drafts (storyboard/iteration), **Cycles** path tracing for
finals. 3D renders node-side to transparent PNG stills, composited through kino's existing
stills pipeline; the browser page never runs WebGL again.

## Decisions (from brainstorm)

- **One backend.** three.js layer REMOVED (dep, page scene api, Scene3D, settle plumbing,
  KINO_GPU Chrome flags). Git history keeps it. No dormant fallback — no parity drift.
- **Spec surface unchanged.** Same `.scene.js` files: body of `scene(api)` → `update(env)`,
  same `api.*` member names, same JSON params/keyframes/triggers, same lint + static asset
  extraction. Scenes that ran on three run on Blender.
- **Architecture A: static translator + timeline-as-data.** Node executes the scene against a
  *recording* api and emits a JSON timeline; one fixed, kino-owned `kino_render.py` builds and
  renders it. Python is never generated at runtime — specs cannot inject code.
- **Quality tiers:** spec-level `quality: "draft" | "final" | "max"` per beat
  (Eevee / Cycles 128 samples / Cycles 512 samples, all denoised). CLI `--draft` forces Eevee
  everywhere; `kino storyboard` and `kino still` default to draft.
- **Budget accepted:** finals ≈ 5–15 min per 2–3 s beat on Apple Silicon (Metal Cycles);
  frame cache means unchanged beats never re-render.
- **Device story:** `api.devicePhone` becomes a procedural Blender device (bevels, subsurf,
  inset glass screen, screenshot texture); user models via `api.gltf` (Blender-native import).
  No third-party assets shipped.

## Architecture

```
spec (.scene.js + params) ──lint/extract (unchanged)──► resolve (unchanged)
        │
        ▼  build-time, node
  scene runner: new Function("api", src)(recordingApi) → update(env)
  per frame: env = buildMotionEnv(...) ; update(env) ; snapshot handles
        │
        ▼
  timeline.json  { meta, objects[], world, post, quality, frames[] }
        │
        ▼  spawn per beat (one Blender process renders all its frames)
  $BLENDER -b --factory-startup -noaudio -P kino_render.py --
      timeline.json <outDir> --engine eevee|cycles --samples N --seed 0
        │
        ▼
  transparent PNGs → publicDir/scene3d/<timelineHash>/f00001.png …
        │
        ▼  render page (unchanged engine, no WebGL)
  SceneFrames layer: <img> per frame in the MotionGraphic slot
  (same mechanism as pre-extracted video frames; captions/DOM composite above)
```

## Components

### 1. Recording api (`src/render/scene/recordApi.ts`, node-side)

Implements the existing `api.*` surface with plain recorded objects — no three, no DOM.

- Constructors (`box`, `sphere`, `plane`, `cylinder`, `torus`, `roundedBox`, `devicePhone`,
  `gltf`, `text3d`, `particles`, `group`, lights, `camera`, `contactShadow`) append typed
  entries to `objects[]` and return **handles**: `{ position, rotation, scale, visible,
  material }` plain mutable structs (camera rig keeps `orbit/dolly/lookAt/zoom` absolute
  setters writing camera state).
- `env("studio"|"night"|"none")`, `post({bloom})`, `params`, `param`, `random` (mulberry32),
  `lerp`, `damp` — same contracts as before.
- Per frame the runner calls `update(env)` then snapshots every handle into
  `frames[i].transforms` (quantized to 6 decimals so hashes are stable).
- Trust boundary unchanged: linted local config through `new Function` — now in Node. Lint
  runs BEFORE execution (existing `lintSceneJs`); the runner additionally executes inside a
  frozen-global closure (no `require`/`process` reachable lexically — belt to the lint's
  suspenders; document, don't over-engineer a full VM).

### 2. Timeline JSON

One file per beat. `meta` (width, height, fps, frameCount, kinoVersion), `objects[]`
(type + creation opts, material specs, asset paths already staged into `_public`), `world`
(env preset), `post` (bloom opts or null), `quality`, `fontPath` (brand TTF from `_public`,
for `text3d`), `frames[]` (per-frame transform + camera + material-opacity snapshots).
Schema documented in `docs/3d-scenes.md`; the JSON is written next to the beat's stills for
debuggability.

### 3. Translator (`scripts/kino_render.py`, runs inside Blender)

Fixed, versioned, agent-readable. Sections:

- **Build:** objects from `objects[]` — primitives with bevel modifiers; `devicePhone` as
  procedural rounded slab + inset emissive-glass screen with the screenshot texture (sRGB,
  emission-mixed so UI reads bright); `text3d` via Blender text object loaded from `fontPath`,
  extrude/bevel from opts; `gltf` via `bpy.ops.import_scene.gltf`; `particles` as mesh
  instances placed from the recorded seed positions (positions come IN the timeline — Python
  does no random); materials → Principled BSDF (pbr fields map 1:1, clearcoat included);
  `contactShadow` → real shadow-catcher plane (Cycles) / blurred-shadow plane (Eevee).
- **World/lights:** `env("studio")` → gradient world + softbox area lights; `"night"` → same
  rig dimmed. `dirLight/ambient/hemi` → sun/ambient-world/hemi approximations.
- **Post:** bloom → Eevee native bloom / Cycles compositor Glare node, mapped from
  `{strength, radius, threshold}`.
- **Render loop:** for each frame: apply `frames[i]`, render to
  `f%05d.png` (RGBA, transparent film). Engine/samples/seed/threads from argv. OIDN denoise on.
- **Determinism:** fixed seed, fixed sample counts, no wall clock, no random — same machine +
  same Blender version ⇒ stable output (Eevee byte-stable; Cycles stable-in-practice, not
  guaranteed — policy identical to the removed GPU mode).

### 4. Engine integration

- **Prepare stage** (`build.ts`): after VO timing exists (frame counts known), for each scene
  beat/overlay: run recorder → timeline → hash. If `publicDir/scene3d/<hash>/` incomplete →
  spawn Blender (beats render sequentially; one process per beat). Progress line per beat
  (`· 3d beat 2 (cycles final, 74 frames)`).
- **Page:** `MotionGraphicProps.scene` is replaced by `sceneFrames: { dir, count }` — the page
  gets a dumb `<img>`-sequence layer (`SceneFrames`) in the same slot Scene3D occupied.
  `buildMotionEnv` moves node-side (module shared with 2D motion env building — the page
  keeps using it for Tier-2; export location `src/render/motionEnv.ts`).
- **Stills cache:** `scene3d/<timelineHash>` IS the cache (timeline hash covers scene source,
  params, resolved word timings, quality, dimensions, fps + blender version + engine +
  samples). kino's frame cache keeps working above it via the existing segment sig (scene
  source + params already hashed there; ADD quality + blender version).
- **`kino storyboard` / `kino still`:** force draft (Eevee) unless `--final`.
- **`kino build`:** honors spec `quality` (unauthored beats default `final`); the `--draft`
  CLI flag overrides every beat to Eevee for fast passes. `--mock` does NOT downgrade 3D —
  quality is authored content, not API spend; use `--draft` when iterating.

### 5. Binary resolution + doctor

`KINO_BLENDER` env > `blender` on PATH > `/Applications/Blender.app/Contents/MacOS/Blender`
(darwin). Version probe `blender --version`, minimum 4.2 (Eevee Next). Missing → build error
naming the beat, with `brew install --cask blender` hint (darwin) / distro hint (linux).
`kino doctor` gains a Blender row. Only builds whose specs contain 3D beats require Blender.

### 6. Removal (same branch, before backend lands)

Deleted: `three` + `@types/three` deps, `src/render/native/page/scene/` (api.ts, Scene3D,
vendored typeface), settle plumbing in `index.tsx`, `KINO_GPU` launch flags + cache mode +
GPU tests (`launchArgs` extraction stays — it's better structure), `--enable-unsafe-swiftshader`
(no WebGL user remains), `tsconfig.page.json` stays (page typecheck still valuable).
Kept: schema/motionFields, motionLib `.scene.js` resolution, `scene.ts` lint/extraction,
props staging + cache signatures, presets (retargeted), `docs/3d-scenes.md` (rewritten
render-backend sections), demo project.

## Presets (retargeted, same files)

`phone-orbit` / `depth-particles` / `wordmark-3d` keep their choreography (sweep, edge-drift,
double-smoothstep full turn) — they only ever talked to `api.*`. Expected uplift from the
backend alone: real GI + soft shadows + shadow catcher + Blender text with brand font.
Re-gate visually via storyboard (draft) and one Cycles final per preset.

## Testing

- **Unit (no Blender):** recorder — scene runs, objects recorded, handle mutations snapshot
  per frame, timeline hash stable across runs / changes when source/params/quality change;
  frozen-global closure blocks `process`/`require` access; existing lint/preset/pipeline
  tests unchanged.
- **Integration (Blender required, skipped with a visible log when absent):** Eevee 3-frame
  render of a box scene → PNGs exist, non-empty alpha, byte-identical across two runs;
  Cycles 1-frame smoke at 16 samples. CI installs Blender on one platform only (macOS or
  ubuntu runner); other platforms rely on unit tests.
- **Render-page test:** SceneFrames layer composites (existing render-test harness with a
  fake stills dir — no Blender needed).
- **Quality gate (manual):** demo project — draft storyboard + one Cycles final per preset,
  adversarial-critique pass, honest before/after vs the three.js output.

## Risks

| Risk | Mitigation |
|---|---|
| Blender install friction | Only 3D specs need it; doctor probe + install hint; version-pinned minimum, not exact |
| Cycles frame cost blows build times | quality tiers + `--draft` + timeline-hash stills cache; progress lines per beat |
| Translator fidelity drift (draft vs final look) | Same timeline, same lights/materials — engines differ only in raster vs traced; gate compares both |
| linux-arm64 (Pi) Blender availability | 3D beats degrade to a build error naming Blender as missing; non-3D builds unaffected |
| Handle-surface gaps vs three behavior | Recorder implements the documented surface only; anything undocumented was never contract |
| Blender version output drift | Version in timeline hash + cache sig; upgrades re-render knowingly |

## Out of scope (v1)

Skinned/animated glTF, physics, volumetrics, motion blur, DOF authoring (fixed tasteful
defaults may ship in presets), HDRI assets, network render farm, Windows CI coverage for the
Blender integration tests.
