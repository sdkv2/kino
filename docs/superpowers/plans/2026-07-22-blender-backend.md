# Blender Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three.js/WebGL 3D layer with Blender: Eevee drafts + Cycles finals rendered node-side to transparent PNG stills, composited via the existing stills path — same `.scene.js`/`api.*` spec surface.

**Architecture:** Node runs a scene against a *recording* api (`runScene`) → per-beat JSON timeline + hash → one fixed `scripts/kino_render.py` builds/renders it in Blender (`--engine eevee|cycles`) → PNGs land in a hash-named cache dir served at `/scene3d/` → a dumb `SceneFrames` `<img>` layer replaces `Scene3D`. Spec: `docs/superpowers/specs/2026-07-22-cycles-backend-design.md`.

**Tech Stack:** TypeScript (recorder/engine), Python inside Blender ≥ 4.2 (translator), execa (spawn), vitest.

## Global Constraints

- Spec surface unchanged: same `.scene.js` (body of `scene(api)` → `update(env)`), same `api.*` member names, same lint (`lintSceneJs`) + asset extraction. Existing preset files must run WITHOUT edits (choreography-preserving).
- Python is never generated at runtime — `kino_render.py` is fixed and versioned; all variability is timeline JSON data.
- Determinism: recorder is a pure function of (source, params, words, dims, fps, quality) — timeline hash stable across runs; no `Math.random`/`Date` anywhere new (mulberry32 for `api.random`). Blender: fixed seed 0, fixed samples, OIDN denoise; per-machine stability policy.
- Quality tiers: spec-level `quality: "draft" | "final" | "max"` → Eevee / Cycles 128 / Cycles 512 samples. Unauthored beats default `final`. `kino build --draft` forces Eevee; `kino storyboard`/`kino still` default draft, `--final` opts out.
- Blender resolution: `KINO_BLENDER` env > `blender` on PATH > `/Applications/Blender.app/Contents/MacOS/Blender` (darwin). Minimum version 4.2. Missing → error naming the beat + `brew install --cask blender` hint (darwin). Only specs with 3D beats require Blender.
- The CLI runs compiled `dist/` — `npm run build` before manual `kino` invocations. `files` in package.json must ship `scripts/kino_render.py` (add to the array).
- Comments state constraints, not narration.
- Blender integration tests skip VISIBLY (vitest skip, log line) when no Blender binary resolves.

---

### Task 11: Remove the three.js layer

**Files:**
- Delete: `src/render/native/page/scene/` (api.ts, Scene3D.tsx, vendored typeface JSON)
- Delete: `tests/sceneApi.test.ts`, `tests/render-scene.test.ts`, `tests/browser-args.test.ts` GPU cases (keep the launchArgs default-mode test)
- Modify: `src/render/native/page/MotionGraphic.tsx` (drop Scene3D import + `data.scene` dispatch; KEEP `buildMotionEnv` export — Task 12 moves it)
- Modify: `src/render/native/page/index.tsx` (drop `settleScene` import + second flushSync pass; restore plain kinoSeek)
- Modify: `src/render/native/browser.ts` (`launchArgs`: remove the `KINO_GPU` branch AND `--enable-unsafe-swiftshader`; keep the extracted-function structure and every other flag)
- Modify: `src/render/native/frameCache.ts` (remove the `mode` global-sig field and its env default)
- Modify: `tests/cache.test.ts` (remove mode-split tests)
- Modify: `package.json` (`npm uninstall three @types/three @types/react-dom`? — NO: keep `@types/react-dom`, the page typecheck still needs it; uninstall only `three` and `@types/three`)

**Interfaces:**
- Produces: `MotionGraphicProps.scene`/`sceneAssets` REMAIN (resolve pipeline untouched); the page simply no longer renders anything for them (scene beats render empty until Task 14). `launchArgs(env)` remains exported minus GPU handling.

- [ ] **Step 1: Delete files + edits above.** In `MotionGraphic.tsx` the dispatch block `if (data.scene) { return <Scene3D … /> }` goes; nothing else in the component changes. In `index.tsx`, `kinoSeek` returns to: flushSync → `await settleImages()` (no scene pass).
- [ ] **Step 2: `npm uninstall three @types/three`**
- [ ] **Step 3: Full suite + build green.** Run: `npm test && npm run build`. Expected: all pass; page bundle shrinks (~2.6MB → ~0.6MB). Fix any dangling import the compiler names.
- [ ] **Step 4: Commit** — `git commit -m "refactor(3d)!: remove three.js/WebGL render layer (Blender backend replaces it)"`

---

### Task 12: `motionEnv` extraction + recording api + `runScene`

**Files:**
- Create: `src/render/motionEnv.ts` (moved `buildMotionEnv` — node-safe already: it only uses `bgparams`/`motionVars` math)
- Modify: `src/render/native/page/MotionGraphic.tsx` (import `buildMotionEnv` from `../../motionEnv.js`; delete the local copy)
- Create: `src/render/scene/recordApi.ts`
- Create: `src/render/scene/runScene.ts`
- Test: `tests/runScene.test.ts`

**Interfaces:**
- Consumes: `MotionEnv` type + `buildMotionEnv(args)` (exact signature from MotionGraphic.tsx today; args gain nothing).
- Produces (Task 13/14 rely on these exactly):
  - `runScene(opts: { source: string; params: Record<string, number | string>; words: WordTiming[]; theme: Theme; width: number; height: number; fps: number; durationFrames: number; quality: "draft" | "final" | "max" }): { timeline: Timeline; hash: string }`
  - `Timeline` (exported type): `{ meta: { width; height; fps; frameCount; quality; kinoVersion }, objects: TimelineObject[], world: "studio" | "night" | "none", post: { bloom?: { strength: number; radius: number; threshold: number } } | null, fontPath: string | null, frames: TimelineFrame[] }`
  - `TimelineObject`: `{ id: string; type: "box" | "sphere" | "plane" | "cylinder" | "torus" | "roundedBox" | "devicePhone" | "gltf" | "text3d" | "particles" | "group" | "dirLight" | "ambient" | "hemi" | "contactShadow"; opts: Record<string, unknown>; material?: MaterialSpec; parent?: string }`
  - `MaterialSpec`: `{ kind: "pbr" | "basic" | "emissive"; color: string; metalness?: number; roughness?: number; envMapIntensity?: number; clearcoat?: number; clearcoatRoughness?: number; transparent?: boolean; opacity?: number }` (palette names resolved to hex BY THE RECORDER using `theme`)
  - `TimelineFrame`: `{ transforms: Record<string, { p: [n,n,n]; r: [n,n,n]; s: [n,n,n]; visible: boolean; opacity?: number }>, camera: { p: [n,n,n]; lookAt: [n,n,n] | null; fov: number; zoom: number } }`
  - `hash` = sha1 of `JSON.stringify(timeline)` — the stills cache key.

- [ ] **Step 1: Move `buildMotionEnv`** to `src/render/motionEnv.ts` verbatim; update the page import. Run `npx vitest run tests/render-motion.test.ts` — green (behavior identical).

- [ ] **Step 2: Failing tests** (`tests/runScene.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { runScene } from "../src/render/scene/runScene.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9 };
const base = { params: {}, words: [], theme, width: 1080, height: 1920, fps: 30, durationFrames: 10, quality: "draft" as const };
const run = (source: string, extra = {}) => runScene({ source, ...base, ...extra });

describe("runScene", () => {
  it("records objects and per-frame transforms", () => {
    const { timeline } = run(`const b = api.box({ size: [1,1,1], material: api.pbr({ color: "mint" }) });
return (env) => { b.rotation.y = env.progress; };`);
    expect(timeline.objects).toHaveLength(1);
    expect(timeline.objects[0].type).toBe("box");
    expect(timeline.objects[0].material!.color).toBe("#80e2b4"); // palette resolved node-side
    expect(timeline.frames).toHaveLength(10);
    expect(timeline.frames[9].transforms[timeline.objects[0].id].r[1]).toBeCloseTo(9 / 10, 5);
  });
  it("hash is stable across runs and changes with source/params/quality", () => {
    const src = `api.sphere({ radius: 1 }); return () => {};`;
    expect(run(src).hash).toBe(run(src).hash);
    expect(run(src).hash).not.toBe(run(src + " ").hash);
    expect(run(src).hash).not.toBe(run(src, { quality: "final" }).hash);
    expect(run(src).hash).not.toBe(run(src, { params: { x: 1 } }).hash);
  });
  it("camera rig setters are absolute and recorded", () => {
    const { timeline } = run(`const cam = api.camera({ fov: 35 });
return (env) => { cam.dolly(5); cam.dolly(5); };`);
    expect(timeline.frames[0].camera.p[2]).toBe(5);
    expect(timeline.frames[0].camera.fov).toBe(35);
  });
  it("api.random is deterministic; api.params reads base params", () => {
    const { timeline } = run(`const r = api.random(7); const a = r();
const t = api.text3d(String(api.params.text ?? "X"), { size: 1 });
return (env) => { t.position.x = a; };`, { params: { text: "KINO" } });
    const again = run(`const r = api.random(7); const a = r();
const t = api.text3d(String(api.params.text ?? "X"), { size: 1 });
return (env) => { t.position.x = a; };`, { params: { text: "KINO" } });
    expect(timeline.frames[0].transforms[timeline.objects[0].id].p[0]).toBe(again.timeline.frames[0].transforms[again.timeline.objects[0].id].p[0]);
    expect(timeline.objects[0].opts.text).toBe("KINO");
  });
  it("env preset, post, particles seed positions are recorded", () => {
    const { timeline } = run(`api.env("studio");
api.post({ bloom: { strength: 0.4 } });
api.particles(8, { spread: 4, seed: 3, color: "gold", size: 0.05 });
return () => {};`);
    expect(timeline.world).toBe("studio");
    expect(timeline.post!.bloom!.strength).toBe(0.4);
    const parts = timeline.objects.find((o) => o.type === "particles")!;
    expect((parts.opts.positions as number[][]).length).toBe(8); // seeded node-side, python does no random
  });
  it("scene body cannot reach process/require lexically", () => {
    expect(() => run(`return () => { process.exit(1); };`).timeline.frames).toThrow(/process/);
  });
  it("throws when the body does not return a function", () => {
    expect(() => run(`api.box({ size: [1,1,1] });`)).toThrow(/update/);
  });
});
```

- [ ] **Step 3: Run — expect FAIL** (module missing)

- [ ] **Step 4: Implement `recordApi.ts` + `runScene.ts`.** recordApi mirrors the old page api surface but records plain structs (no three):

```ts
// recordApi: the api.* surface as a scene-graph RECORDER. Handles are plain mutable structs the
// runner snapshots per frame; nothing here renders. Same member names/contracts the page api had —
// the .scene.js surface is the seam, this file + kino_render.py are its Blender implementation.
```

Key implementation points (implement all fully):
  - Handle factory: `{ position: {x,y,z}, rotation: {x,y,z}, scale: {x,y,z, setScalar(v)}, visible, material }` — plus `geometry.computeBoundingBox()`/`boundingBox` shim for `text3d` (existing wordmark preset calls it: approximate glyph advance `0.62 * size * text.length` for x extent, `size` for y — document the approximation constraint in a comment; presets only use width).
  - `devicePhone({ screen, width=1, height=2.16, depth=0.08, radius=0.09 })` records type+opts with the screen texture path; `texture(pathOrParam)`/`gltf(pathOrParam)` resolve ParamRef via baseParams and record the RELATIVE path (staging already puts assets in `_public`; python resolves against publicDir).
  - `particles(count, {spread, size, color, seed})` — positions computed HERE with mulberry32(seed), recorded as `opts.positions: [x,y,z][]`.
  - `camera(opts)` rig: absolute setters writing a module-local camera state (`orbit({radius,y,angle})` = sin/cos ring + lookAt origin; `dolly(z)` sets p[2]; `zoom(f)`; `lookAt(x,y,z)`); fov from opts (default 40).
  - `contactShadow({radius=1, opacity=0.4, y=-1})` records an object; its handle's `material.opacity`/`scale` mutations snapshot like any other (presets animate it).
  - Palette resolution: material colors through `theme` (names mint/green/night/white/gold → hex, else pass through).
  - `runScene`: lint FIRST (`lintSceneJs` — throw on violations, same message join style as resolve), then execute the body inside a shadowing closure: `new Function("api", "process", "require", "globalThis", "window", "document", src)` called with `(api, undefined, undefined, undefined, undefined, undefined)` — banned globals are lexically shadowed to undefined (belt on the lint's suspenders). Reject non-function return with `"scene(api) must return update(env)"`. Per frame `f` in `0..durationFrames-1`: `update(buildMotionEnv({ frame: f, fps, width, height, durationFrames, data: { params, keyframes, triggers, words }, t: theme }))` — wait: keyframes/triggers come through `params` resolution; ACCEPT `keyframes`/`triggers` in runScene opts too (add to the signature: `keyframes?: BgKeyframe[]; triggers?: BgTrigger[]`, default `[]`; they feed buildMotionEnv exactly as the page did). Snapshot after each update: transforms quantized to 6 decimals (`Math.round(v * 1e6) / 1e6`), plus camera state. `hash` = sha1 over the serialized timeline (import `createHash` from node:crypto).
  - `meta.kinoVersion` from `src/version.ts`.

- [ ] **Step 5: Run — expect PASS**, then full `npm test && npm run build`.
- [ ] **Step 6: Commit** — `feat(3d): recording api + runScene — scene → timeline JSON node-side`

---

### Task 13: Blender probe, `kino_render.py`, integration test

**Files:**
- Create: `src/media/blender.ts`
- Create: `scripts/kino_render.py`
- Modify: `package.json` (`files` array gains `"scripts/kino_render.py"`; verify `scripts/` isn't already excluded — currently only `dist,bin,skills,assets-lib` ship, so ADD the file path)
- Modify: `src/commands/doctor.ts` (Blender row: resolved path + version, or "not found — brew install --cask blender (only needed for 3D beats)")
- Test: `tests/blenderRender.test.ts`

**Interfaces:**
- Consumes: `Timeline` type (Task 12).
- Produces:
  - `resolveBlender(): { bin: string; version: string } | null` (probe order per Global Constraints; version from `blender --version` first line; null when unresolvable or < 4.2 — a too-old Blender reports as missing WITH its found version in the error path)
  - `renderTimeline(opts: { timeline: Timeline; outDir: string; publicDir: string; blenderBin: string }): Promise<void>` — writes `timeline.json` into `outDir`, spawns `execa(blenderBin, ["-b", "--factory-startup", "-noaudio", "-P", KINO_RENDER_PY, "--", join(outDir, "timeline.json"), outDir, publicDir])`, engine/samples derived INSIDE the script from `timeline.meta.quality` (draft→eevee, final→cycles 128, max→cycles 512; seed 0). Throws with Blender's stderr tail on nonzero exit. PNGs: `f00001.png … f%05d.png`, RGBA transparent film.
  - `KINO_RENDER_PY` exported const: resolved relative to the module (works from src via tsx AND from dist — the file is NOT compiled; resolve `../../scripts/kino_render.py` from the package root via `fileURLToPath`, mirroring `MOTION_LIB_DIR`'s pattern in motionLib.ts).

- [ ] **Step 1: Install Blender** — `brew install --cask blender` (this machine has none; required to verify the deliverable). Confirm `resolveBlender()` path works after install; report the installed version.

- [ ] **Step 2: Failing tests** (`tests/blenderRender.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { resolveBlender, renderTimeline } from "../src/media/blender.js";
import { runScene } from "../src/render/scene/runScene.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9 };
const blender = resolveBlender();
if (!blender) console.warn("blenderRender tests SKIPPED — no Blender >= 4.2 found");
const maybe = blender ? describe : describe.skip;

maybe("blender render", () => {
  const scene = `const b = api.box({ size: [2,2,2], material: api.pbr({ color: "mint" }) });
api.env("studio");
const cam = api.camera({ fov: 40 });
return (env) => { b.rotation.y = env.progress; cam.dolly(6); };`;
  const tl = () => runScene({ source: scene, params: {}, words: [], theme, width: 270, height: 480, fps: 30, durationFrames: 3, quality: "draft" }).timeline;

  it("renders eevee draft frames with transparency, byte-stable across runs", async () => {
    const a = mkdtempSync(join(tmpdir(), "kino-bla-"));
    const b2 = mkdtempSync(join(tmpdir(), "kino-blb-"));
    await renderTimeline({ timeline: tl(), outDir: a, publicDir: a, blenderBin: blender!.bin });
    await renderTimeline({ timeline: tl(), outDir: b2, publicDir: b2, blenderBin: blender!.bin });
    for (const f of ["f00001.png", "f00002.png", "f00003.png"]) {
      expect(existsSync(join(a, f))).toBe(true);
      const sha = (p: string) => createHash("sha1").update(readFileSync(p)).digest("hex");
      expect(sha(join(a, f))).toBe(sha(join(b2, f)));
    }
  }, 300000);

  it("renders a 1-frame cycles smoke", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-blc-"));
    const t = runScene({ source: scene, params: {}, words: [], theme, width: 270, height: 480, fps: 30, durationFrames: 1, quality: "final" }).timeline;
    (t.meta as { quality: string }).quality = "final";
    await renderTimeline({ timeline: t, outDir: dir, publicDir: dir, blenderBin: blender!.bin });
    expect(existsSync(join(dir, "f00001.png"))).toBe(true);
  }, 300000);
});

describe("resolveBlender", () => {
  it("returns null or a versioned binary", () => {
    const r = resolveBlender();
    if (r) expect(r.version).toMatch(/^\d+\.\d+/);
  });
});
```

(Cycles smoke: cap cost — inside kino_render.py, `final` uses 128 samples but the test renders 270×480×1 frame ≈ seconds on Metal.)

- [ ] **Step 3: Run — expect FAIL** (modules missing)

- [ ] **Step 4: Implement `src/media/blender.ts`** per the Produces block (probe mirrors `resolveExecutable` in browser.ts + `onPath` in binPaths.ts; version parse `Blender 4.5.1` → `"4.5"` compare `>= 4.2` numerically major.minor).

- [ ] **Step 5: Implement `scripts/kino_render.py`.** Fixed translator, argv: `timeline.json outDir publicDir`. Implement every section fully (these are member specifications, not omissions):
  - **Setup:** parse args after `--`; load JSON; `bpy.ops.wm.read_factory_settings(use_empty=True)`; scene fps/resolution from meta; film_transparent = True; color management `Filmic` view transform, `sRGB` display; engine from quality (`BLENDER_EEVEE_NEXT` for draft — Blender ≥ 4.2 name — else `CYCLES` with `scene.cycles.samples` 128/512, `scene.cycles.seed = 0`, adaptive sampling OFF for determinism, OIDN denoise ON, Metal GPU if available else CPU).
  - **Materials:** MaterialSpec → Principled BSDF (`Base Color` from hex, `Metallic`, `Roughness`, `Coat Weight`/`Coat Roughness` for clearcoat — Blender 4.x names, `Emission` for `emissive` kind, alpha for transparent/opacity); `basic` = Emission shader at color (unlit).
  - **Objects:** box/sphere/plane/cylinder/torus via `bpy.ops.mesh.primitive_*`; roundedBox = cube + Bevel modifier (width from opts.radius, segments 4); devicePhone = rounded slab body (bevel+subsurf, dark Principled with `Coat Weight 0.6`) + inset screen plane at `z = depth/2 + 0.002` sized `w*0.94 × h*0.94` with an EMISSION-mixed image texture (`bpy.data.images.load(join(publicDir, screenPath))`, non-color OFF/sRGB, emission strength ~1.4 so UI reads bright); text3d = `bpy.data.curves.new(type="FONT")` with `font = bpy.data.fonts.load(fontPath)` when timeline.fontPath else default, `extrude = depth`, `bevel_depth = depth*0.06`, size from opts, origin centered (`bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")`); gltf = `bpy.ops.import_scene.gltf(filepath=join(publicDir, path))` wrapped in a parent Empty carrying the handle id; particles = one small icosphere mesh instanced at each recorded position under a parent Empty (transforms animate the parent); contactShadow = circle mesh with a radial-gradient transparent shader (Cycles: `is_shadow_catcher = True` on a plane instead) at opts.y.
  - **World/lights:** `studio` = gradient world (dark `#0b1020`-ish zenith→horizon) + 3 rectangular AREA lights (key 2 top-left, fill right, rim back — sizes/energies fixed constants in the script, commented); `night` = same rig at 0.35 energy; `none` = black transparent world only. dirLight → SUN (energy/rotation from opts.position normalized), ambient → world strength bump, hemi → sky-ish weak area from above.
  - **Post:** bloom — Eevee: native bloom settings from opts; Cycles: compositor Glare node (Fog Glow, threshold/size mapped, fixed quality) — build the compositor graph in the script.
  - **Camera:** one camera; per frame set location `p`, `track lookAt` (compute rotation via `Vector` math, no constraints — deterministic), lens from fov (`camera.data.angle = radians(fov)`), `camera.data.sensor_fit = 'VERTICAL'` (portrait framing parity with the three PerspectiveCamera vertical-fov convention).
  - **Render loop:** for i, frame in enumerate(frames): apply transforms (objects by id: location/rotation_euler/scale/hide_render + material opacity when present), camera state; `scene.render.filepath = join(outDir, f"f{i+1:05d}.png")`; `bpy.ops.render.render(write_still=True)`.
  - **Exit nonzero on any exception** with traceback to stderr (execa surfaces it).
- [ ] **Step 6: Run — expect PASS** (real renders; eyeball one PNG with the image Read tool — mint cube, soft studio light, transparent background).
- [ ] **Step 7: doctor row + package.json files entry.** Run `node dist/cli.js doctor` after `npm run build` — row shows version.
- [ ] **Step 8: Full suite. Commit** — `feat(3d): blender probe + kino_render.py translator (eevee/cycles)`

---

### Task 14: Engine integration — stills pipeline, page layer, quality knob, CLI flags

**Files:**
- Modify: `src/spec/schema.ts` (`motionFields` gains `quality: z.enum(["draft", "final", "max"]).optional()`; SEGMENT_KIND_HINTS gains `quality: "quality is motion-only (3D scene beats)"`)
- Modify: `src/render/props.ts` (`MotionGraphicProps` gains `sceneFrames?: { dir: string; count: number }`)
- Modify: `src/commands/build.ts` (after segments resolve: for every `seg.motion?.scene` / `seg.motionOverlay?.scene`, run `runScene` → ensure stills in `join(project.outDir(spec.title), "_scene3d", hash)` → spawn `renderTimeline` when the dir lacks `f%05d.png` count — then set `sceneFrames = { dir: hash, count }` on the resolved props; `--draft` CLI flag forces quality "draft" for ALL scene beats; missing Blender → error naming the beat + install hint)
- Modify: `src/commands/storyboard.ts`, `src/commands/still.ts` (pass draft-force unless a new `--final` flag set)
- Modify: `src/render/native/server.ts` (third root: `["/scene3d/", s.scene3dDir]`; `ServerState` gains `scene3dDir: string`)
- Modify: `src/render/native/engine.ts` (plumb `scene3dDir` — the `_scene3d` dir — through both render paths' `pointServerAt`)
- Modify: `src/render/render.ts` (whatever options shape carries publicDir must carry scene3dDir; follow the existing prop plumbing)
- Create: `src/render/native/page/SceneFrames.tsx`
- Modify: `src/render/native/page/MotionGraphic.tsx` (dispatch `if (data.sceneFrames) return <SceneFrames frames={data.sceneFrames} />` before html/proc/lottie)
- Test: `tests/spec.test.ts` (quality field), `tests/render-scene.test.ts` (recreate — fake stills, no Blender), `tests/build-scene.test.ts` (stills-ensure logic with a stubbed renderTimeline)

**Interfaces:**
- Consumes: `runScene` (T12), `resolveBlender`/`renderTimeline` (T13).
- Produces: `SceneFrames` page component: `({ frames: { dir, count } })` → `<AbsoluteFill><img src={`/scene3d/${dir}/f${String(Math.min(frame, count - 1) + 1).padStart(5, "0")}.png`} style={{ width: "100%", height: "100%" }} /></AbsoluteFill>` (frame from `useCurrentFrame()`; images settle via the existing `settleImages` await — no new machinery).

- [ ] **Step 1: Failing tests.** Schema: quality accepted on motion segments, rejected on app segments (hint text). Page: rebuild `tests/render-scene.test.ts` — write 3 solid-mint 1080×1920 PNGs (`magick -size 1080x1920 xc:'#80e2b4'`) into `<outDir>/_scene3d/testhash/f0000{1,2,3}.png`, props motion segment with `motion: { html: "", sceneFrames: { dir: "testhash", count: 3 }, params: {}, keyframes: [], triggers: [] }`, renderStills a frame, assert center pixel mint (reuse the old expectMint helpers from git history of the deleted file — rewrite them locally). Build logic: `tests/build-scene.test.ts` unit-tests the ensure function (extract it as `ensureSceneStills(deps)` with injectable `renderTimeline` so the test asserts: cache-hit skips spawn; cache-miss spawns once; missing Blender throws the hint).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** per Files list. Notes: the stills-ensure check counts existing `f*.png` == `durationFrames` (partial dir = re-render — Blender crash mid-beat must not poison the cache); overlays use the SAME quality field from their `MotionGraphicRef`; `_scene3d` lives beside `_public` (it is NOT re-created per build — it IS the cross-build cache; never `rmSync` it in build prep); server route follows the existing roots-array pattern (traversal guard included).
- [ ] **Step 4: Run — expect PASS**, full `npm test && npm run build`.
- [ ] **Step 5: E2E hand-check:** `cd projects/3d-demo && node ../../dist/cli.js storyboard specs/gate.json` (drafts via Eevee — requires Blender from T13). Confirm the sheet renders all 3 preset beats with actual 3D imagery.
- [ ] **Step 6: Commit** — `feat(3d): blender stills pipeline — quality knob, SceneFrames layer, --draft/--final`

---

### Task 15: Draft re-gate (controller-run)

Storyboard the demo project on Eevee drafts; open the sheet + per-beat `--around` sheets; run the adversarial-critique skill; tune ONLY preset numbers / translator light-rig constants for findings (no architecture churn). Success bar: presets read grounded and lit — soft shadows visible, device screen legible, wordmark metal has tonal modeling. Commit tunings.

### Task 16: Cycles final gate (controller-run)

`node ../../dist/cli.js still specs/gate.json --segment N --final` per preset beat (or a full `build --format 9:16` without `--draft`); Read the finals; adversarial-critique pass; record honest before/after vs the archived three.js storyboard; capture per-beat wall-clock (the budget claim: 5–15 min/beat) in the ledger. Fix findings by preset/translator tuning; re-render only affected beats (hash cache proves itself here — note observed cache hits). Commit.

### Task 17: Docs + changelog + skill pointer

**Files:** `docs/3d-scenes.md` (rewrite backend sections: Blender requirement + install, quality tiers, draft/final flags, timeline/debugging, api reference table updated — geometry.boundingBox shim note, particles positions recorded, contactShadow now a real shadow catcher in finals; DELETE WebGL/SwiftShader/KINO_GPU mentions), `docs/cli-reference.md` (--draft/--final), `CHANGELOG.md` (plain-bullet Unreleased entries: Blender backend + three.js removal, breaking note), `skills/motion-design/SKILL.md` (3D section: Blender install requirement, draft-iterate/final-ship workflow), `docs/getting-started.md` or `docs/README.md` only if they list optional binaries (check; add Blender beside magick/whisper if so).

Steps: grep-verify every claim against code (api member cross-check vs `recordApi.ts`); `npm test`; commit `docs(3d): blender backend docs — install, quality tiers, draft/final workflow`.

---

## Self-Review Notes

- Spec coverage: removal (T11) ✓ recorder/timeline (T12) ✓ translator+probe+doctor (T13) ✓ engine/page/quality/CLI/cache (T14) ✓ draft gate (T15) ✓ final gate + budget evidence (T16) ✓ docs (T17) ✓. Presets need no edits (T12's boundingBox shim covers wordmark's only three-ism) — verified against all three preset sources.
- Type consistency: `Timeline`/`TimelineObject`/`MaterialSpec`/`TimelineFrame` defined once (T12 Produces), consumed by T13/T14 by those exact names; `sceneFrames: { dir, count }` consistent between props (T14) and SceneFrames.
- Known judgment calls left to implementers: exact Blender 4.x Python attribute names (verify in the installed Blender's console, e.g. Coat Weight socket naming), Eevee-Next bloom API surface, light-rig constants (tuned at gates).
- Deliberate holds from spec: skinned glTF, volumetrics, DOF authoring, HDRI assets, farm rendering, Windows Blender CI.
