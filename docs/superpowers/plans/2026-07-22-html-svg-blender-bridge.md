# HTML/SVG → Blender Bridge (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scene beats can show agent-authored HTML as animated, VO-synced screen textures (`api.screen`) and per-element SVG planes (`api.layer`) inside Blender renders.

**Architecture:** A pre-rasterize pass (headless Chrome, existing puppeteer pool) turns `.html` refs into per-frame PNG sequences and `.svg` refs into single alpha PNGs, content-addressed under `_public/_screens/<digest>/` and `_public/_layers/<digest>.png`. `runScene` records those digest paths into the timeline (so the scene hash busts automatically on content change), and `kino_render.py` mounts them as an image-sequence screen material and textured "layer" planes. Chrome and Blender never talk at render time; Chrome work is deferred until a Blender cache miss.

**Tech Stack:** TypeScript (Node ≥ 18, ESM, `.js` import suffixes), vitest, puppeteer (existing), Blender ≥ 4.2 Python (`scripts/kino_render.py`).

**Spec:** `docs/superpowers/specs/2026-07-22-html-svg-blender-bridge-design.md`

## Global Constraints

- Blender ≥ 4.2 required for scene beats; tests touching Blender must skip when `resolveBlender()` is null (pattern: `tests/blenderRender.test.ts`).
- Chrome-touching tests must skip when `resolveExecutable()` returns undefined (`src/render/native/browser.ts`).
- Determinism: no `Date.now`/`Math.random` in scene/raster paths; rasterized output must be a pure function of (content, words, theme, params, dims, fps, frameCount).
- Screen HTML passes the existing Tier-1 gates: `lintMotionHtml` + `sanitizeMotionHtml` (no `<script>`, no transitions, motion from CSS vars).
- All imports in `src/` use the `.js` suffix (ESM output).
- The CLI runs compiled `dist/` — final task must run `npm run build`.
- Palette/branding: theme colors only (`mint`/`green`/`night`/`white`/`gold`) via `--kino-*` vars.
- Commit messages: conventional commits, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure

- `src/render/motionCss.ts` — NEW: `KINO_SCRUB_STYLE` + `KINO_DEFS` moved out of the page bundle so Node code can inject the same bytes.
- `src/render/scene.ts` — extend asset regex to `screen|layer`; NEW `extractSceneRefs` (categorized), NEW `svgAspect`.
- `src/render/scene/recordApi.ts` — NEW `api.screen` / `api.layer`, `screens`/`layers` opts, `"layer"` object type, z-gap check.
- `src/render/scene/runScene.ts` — thread `screens`/`layers` opts.
- `src/render/scene/rasterize.ts` — NEW: digests (pure) + Chrome rasterizers.
- `src/render/scene/ensureStills.ts` — optional `prepareAssets` callback (raster runs only on Blender cache miss).
- `src/commands/build.ts` — build the raster maps in `ensureOne`, pass `prepareAssets`.
- `scripts/kino_render.py` — image-sequence screen material, `build_layer`, `scene.frame_set`.
- `assets-lib/motion/phone-orbit.scene.js` — `api.screen` for the screenshot param.
- Tests: `tests/sceneRefs.test.ts`, `tests/sceneScreenLayer.test.ts`, `tests/rasterize.test.ts`, `tests/ensureStillsPrepare.test.ts`, additions to `tests/blenderRender.test.ts`.

---

### Task 1: Shared motion CSS module

**Files:**
- Create: `src/render/motionCss.ts`
- Modify: `src/render/native/page/MotionGraphic.tsx:19-57`
- Test: existing suite (pure move, no behavior change)

**Interfaces:**
- Consumes: nothing.
- Produces: `export const KINO_SCRUB_STYLE: string`, `export const KINO_DEFS: string` from `src/render/motionCss.ts` — Task 5's rasterizer injects these into its wrapper page; `MotionGraphic.tsx` keeps injecting the same bytes.

- [ ] **Step 1: Create `src/render/motionCss.ts`**

Move the two consts verbatim from `MotionGraphic.tsx` (lines 19–57, the `KINO_SCRUB_STYLE` and `KINO_DEFS` declarations **including their comment blocks**) into the new file, with `export` added:

```ts
// Trusted stylesheet + SVG defs injected into every motion-graphic shadow root — page bundle
// (MotionGraphic.tsx) and the scene screen rasterizer (scene/rasterize.ts) must inject identical
// bytes, so this lives outside the page. All of it is determinism-safe: animations are
// force-paused and scrubbed by --progress (no wall clock); no transitions / external url()s.
export const KINO_SCRUB_STYLE =
  // ... exact string copied from MotionGraphic.tsx ...
export const KINO_DEFS =
  // ... exact string copied from MotionGraphic.tsx ...
```

- [ ] **Step 2: Update `MotionGraphic.tsx`**

Delete the two const declarations; add:

```ts
import { KINO_SCRUB_STYLE, KINO_DEFS } from "../../motionCss.js";
```

(Path: `page/` → `../../` lands on `src/render/`. Match the style of the sibling import `../../motionVars.js`.)

- [ ] **Step 3: Verify no behavior change**

Run: `npx vitest run`
Expected: same pass/fail set as before the change (baseline: run once before editing).

- [ ] **Step 4: Commit**

```bash
git add src/render/motionCss.ts src/render/native/page/MotionGraphic.tsx
git commit -m "refactor(render): extract KINO_SCRUB_STYLE/KINO_DEFS to shared motionCss module"
```

---

### Task 2: `extractSceneRefs` + extended asset regex

**Files:**
- Modify: `src/render/scene.ts:28-30` (regexes) and the `extractSceneAssets` body
- Test: `tests/sceneRefs.test.ts` (new)

**Interfaces:**
- Consumes: existing `stripJsNoise` from `./motiongraphic.js`.
- Produces:
  - `extractSceneAssets(src, params)` — unchanged signature, now also extracts `api.screen(...)`/`api.layer(...)` paths (so they get staged + existence-checked like textures).
  - `export function extractSceneRefs(src: string, params: Record<string, number | string>): { screens: string[]; layers: string[]; violations: string[] }` — screens = paths passed to `api.screen` that end in `.html`; layers = paths passed to `api.layer` (must end in `.svg`, else a violation). Task 6 calls this to build the raster maps.
  - `export function svgAspect(svg: string): number` — height/width from `viewBox` (fallback: `width`/`height` attrs); throws if neither is present. Task 6 uses it for layer plane sizing; Task 5 uses it for raster dims.

- [ ] **Step 1: Write failing tests**

Create `tests/sceneRefs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractSceneAssets, extractSceneRefs, svgAspect } from "../src/render/scene.js";

describe("extractSceneRefs", () => {
  it("categorizes screen and layer calls, literal and param forms", () => {
    const src = `
      const p = api.devicePhone({ screen: api.screen(api.param("screenshot")) });
      const l = api.layer("svg/logo.svg", { z: 0.3 });
      const t = api.texture("tex/wood.png");
      return () => {};`;
    const refs = extractSceneRefs(src, { screenshot: "screens/dash.html" });
    expect(refs.screens).toEqual(["screens/dash.html"]);
    expect(refs.layers).toEqual(["svg/logo.svg"]);
    expect(refs.violations).toEqual([]);
  });

  it("screen with a non-html path is not a raster ref (png passthrough)", () => {
    const refs = extractSceneRefs(`api.screen("shots/dash.png"); return () => {};`, {});
    expect(refs.screens).toEqual([]);
    expect(refs.violations).toEqual([]);
  });

  it("layer must be an svg", () => {
    const refs = extractSceneRefs(`api.layer("img/logo.png"); return () => {};`, {});
    expect(refs.violations.some((v) => v.includes(".svg"))).toBe(true);
  });

  it("ignores calls inside comments", () => {
    const refs = extractSceneRefs(`// api.layer("svg/ghost.svg")\nreturn () => {};`, {});
    expect(refs.layers).toEqual([]);
  });

  it("extractSceneAssets now includes screen/layer paths for staging", () => {
    const src = `api.screen("screens/dash.html"); api.layer("svg/logo.svg"); return () => {};`;
    const { assets, violations } = extractSceneAssets(src, {});
    expect(assets).toContain("screens/dash.html");
    expect(assets).toContain("svg/logo.svg");
    expect(violations).toEqual([]);
  });
});

describe("svgAspect", () => {
  it("reads viewBox", () => {
    expect(svgAspect(`<svg viewBox="0 0 200 100"></svg>`)).toBeCloseTo(0.5);
  });
  it("falls back to width/height attrs", () => {
    expect(svgAspect(`<svg width="100" height="300"></svg>`)).toBeCloseTo(3);
  });
  it("throws without dimensions", () => {
    expect(() => svgAspect(`<svg></svg>`)).toThrow(/viewBox/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/sceneRefs.test.ts`
Expected: FAIL — `extractSceneRefs is not a function` / `svgAspect is not a function`.

- [ ] **Step 3: Implement in `src/render/scene.ts`**

Replace the two regex consts (lines 28–30) with a call-name capture group (note: group numbering in `extractSceneAssets` shifts by one — update its `m[1]…m[4]` reads to `m[2]…m[5]`):

```ts
// api.texture("lit") | api.texture(api.param("name")) — same for gltf/screen/layer. Group 1 = call name.
const CALL_RE = /\bapi\s*\.\s*(texture|gltf|screen|layer)\s*\(\s*(?:"([^"]*)"|'([^']*)'|api\s*\.\s*param\s*\(\s*(?:"(\w+)"|'(\w+)')\s*\))/g;
const CALL_SITE_RE = /\bapi\s*\.\s*(?:texture|gltf|screen|layer)\s*\(/g;
```

Append to the file:

```ts
/** Height/width ratio of an SVG source (viewBox first, width/height attrs as fallback). */
export function svgAspect(svg: string): number {
  const vb = svg.match(/viewBox\s*=\s*["']\s*[\d.eE+-]+[\s,]+[\d.eE+-]+[\s,]+([\d.eE+-]+)[\s,]+([\d.eE+-]+)/);
  if (vb) {
    const w = Number(vb[1]), h = Number(vb[2]);
    if (w > 0 && h > 0) return h / w;
  }
  const wAttr = svg.match(/<svg[^>]*\swidth\s*=\s*["']([\d.]+)/);
  const hAttr = svg.match(/<svg[^>]*\sheight\s*=\s*["']([\d.]+)/);
  if (wAttr && hAttr && Number(wAttr[1]) > 0 && Number(hAttr[1]) > 0) return Number(hAttr[1]) / Number(wAttr[1]);
  throw new Error("svg needs a viewBox (or width/height attrs) so the layer plane can be sized");
}

/** Categorized raster refs for the pre-rasterize pass: .html screens and .svg layers. */
export function extractSceneRefs(
  src: string,
  params: Record<string, number | string>,
): { screens: string[]; layers: string[]; violations: string[] } {
  const violations: string[] = [];
  const screens = new Set<string>();
  const layers = new Set<string>();
  const stripped = stripJsNoise(src);
  for (const m of src.matchAll(CALL_RE)) {
    if (stripped.slice(m.index ?? 0, (m.index ?? 0) + 3) !== "api") continue;
    const call = m[1];
    if (call !== "screen" && call !== "layer") continue;
    const paramName = m[4] ?? m[5];
    let path: string | undefined = m[2] ?? m[3];
    if (paramName !== undefined) {
      const v = params[paramName];
      if (typeof v !== "string" || !v) continue; // extractSceneAssets already reports this
      path = v;
    }
    if (!path || badPath(path)) continue; // ditto
    if (call === "screen") {
      if (path.toLowerCase().endsWith(".html")) screens.add(path);
      // non-html screen = static texture passthrough, no raster needed
    } else {
      if (path.toLowerCase().endsWith(".svg")) layers.add(path);
      else violations.push(`api.layer("${path}") must reference an .svg asset`);
    }
  }
  return { screens: [...screens], layers: [...layers], violations };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/sceneRefs.test.ts`
Expected: PASS. Then `npx vitest run` — existing `extractSceneAssets` tests must still pass (group-shift check).

- [ ] **Step 5: Commit**

```bash
git add src/render/scene.ts tests/sceneRefs.test.ts
git commit -m "feat(3d): extractSceneRefs — categorize api.screen/api.layer raster refs"
```

---

### Task 3: `api.screen` + `api.layer` in the recorder

**Files:**
- Modify: `src/render/scene/recordApi.ts`
- Test: `tests/sceneScreenLayer.test.ts` (new)

**Interfaces:**
- Consumes: existing `createRecordApi`, `ParamRef`, `TextureHandle`, `record`, `makeHandle`, `basic`.
- Produces:
  - `createRecordApi(opts)` gains optional `screens?: Record<string, { dir: string; frames: number }>` and `layers?: Record<string, { path: string; aspect: number }>` — keys are project-relative source paths (`screens/dash.html`), values are rasterized outputs (paths relative to publicDir).
  - `api.screen(pathOrParam)` → `TextureHandle` (`{ path: string; frames?: number }`). `.html` path found in `screens` map → `{ path: map.dir, frames: map.frames }`; `.html` path missing from map → throw; any other path → plain `{ path }` passthrough.
  - `api.layer(pathOrParam, o?: { x?: number; y?: number; z?: number; width?: number; material?: "unlit" | "emissive"; emission?: number })` → `Handle`. Records object type `"layer"` with opts `{ path, aspect, width, material, emission }` (path/aspect from the `layers` map — missing → throw). Handle starts at `[x??0, y??0, z??0]` with a `basic({ transparent: true, opacity: 1 })` material so per-frame opacity snapshots.
  - Two layers whose initial `z` differ by less than `0.02` → throw (z-fighting lint).
  - `devicePhone` stores `screenFrames` in its opts when the screen handle carries `frames`.

- [ ] **Step 1: Write failing tests**

Create `tests/sceneScreenLayer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createRecordApi } from "../src/render/scene/recordApi.js";

const palette = { mint: "#80e2b4", green: "#0c8d64", night: "#0b1020", white: "#ffffff", gold: "#d99a20" };
const mk = (extra: object = {}) =>
  createRecordApi({ baseParams: {}, palette, ...extra });

describe("api.screen", () => {
  it("resolves an html path through the screens map", () => {
    const r = mk({ screens: { "screens/dash.html": { dir: "_screens/abc123", frames: 90 } } });
    const api = r.api as Record<string, any>;
    const h = api.screen("screens/dash.html");
    expect(h).toEqual({ path: "_screens/abc123", frames: 90 });
  });

  it("passes non-html paths through as a plain texture", () => {
    const api = mk().api as Record<string, any>;
    expect(api.screen("shots/dash.png")).toEqual({ path: "shots/dash.png" });
  });

  it("throws for an html path missing from the map", () => {
    const api = mk().api as Record<string, any>;
    expect(() => api.screen("screens/dash.html")).toThrow(/raster/);
  });

  it("devicePhone records screenFrames for an animated screen", () => {
    const r = mk({ screens: { "screens/dash.html": { dir: "_screens/abc123", frames: 90 } } });
    const api = r.api as Record<string, any>;
    api.devicePhone({ screen: api.screen("screens/dash.html") });
    const phone = r.objects.find((o) => o.type === "devicePhone")!;
    expect(phone.opts.screen).toBe("_screens/abc123");
    expect(phone.opts.screenFrames).toBe(90);
  });
});

describe("api.layer", () => {
  const layers = { "svg/logo.svg": { path: "_layers/def456.png", aspect: 0.5 } };

  it("records a layer object with raster path, aspect and defaults", () => {
    const r = mk({ layers });
    const api = r.api as Record<string, any>;
    const h = api.layer("svg/logo.svg", { z: 0.3, material: "emissive", emission: 2 });
    const obj = r.objects.find((o) => o.type === "layer")!;
    expect(obj.opts).toEqual({ path: "_layers/def456.png", aspect: 0.5, width: 1, material: "emissive", emission: 2 });
    expect(h.position.z).toBe(0.3);
    // opacity animates via the handle material
    h.material!.opacity = 0.5;
    expect(r.snapshot().transforms[obj.id].opacity).toBe(0.5);
  });

  it("throws for an svg missing from the map", () => {
    const api = mk().api as Record<string, any>;
    expect(() => api.layer("svg/logo.svg")).toThrow(/raster/);
  });

  it("throws when two layers share an initial z (z-fighting)", () => {
    const api = mk({ layers }).api as Record<string, any>;
    api.layer("svg/logo.svg", { z: 0.3 });
    expect(() => api.layer("svg/logo.svg", { z: 0.31 })).toThrow(/z/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/sceneScreenLayer.test.ts`
Expected: FAIL — `api.screen is not a function`.

- [ ] **Step 3: Implement in `recordApi.ts`**

Add `"layer"` to the `ObjectType` union. Extend `TextureHandle`:

```ts
interface TextureHandle {
  path: string;
  frames?: number; // animated screen: PNG-sequence dir with this many f%05d.png frames
}
```

Extend `createRecordApi` opts and destructure:

```ts
export function createRecordApi(opts: {
  baseParams: Record<string, number | string>;
  palette: Record<string, string>;
  screens?: Record<string, { dir: string; frames: number }>;
  layers?: Record<string, { path: string; aspect: number }>;
}): Recorder {
  const { baseParams, palette, screens = {}, layers = {} } = opts;
```

After the `texture` const (line ~239), add:

```ts
  /** Animated html screen (rasterized sequence) or static texture passthrough for non-html paths. */
  const screen = (pathOrParam: string | ParamRef): TextureHandle => {
    const rel = resolvePathRel(pathOrParam);
    if (!rel.toLowerCase().endsWith(".html")) return { path: rel };
    const r = screens[rel];
    if (!r) throw new Error(`api.screen("${rel}") has no rasterized sequence — the pre-raster pass must run before runScene`);
    return { path: r.dir, frames: r.frames };
  };

  /** One rasterized SVG element as its own plane; per-layer depth/material/keyframes. */
  const layerZs: number[] = [];
  const layer = (pathOrParam: string | ParamRef, o: {
    x?: number; y?: number; z?: number; width?: number;
    material?: "unlit" | "emissive"; emission?: number;
  } = {}) => {
    const rel = resolvePathRel(pathOrParam);
    const r = layers[rel];
    if (!r) throw new Error(`api.layer("${rel}") has no rasterized png — the pre-raster pass must run before runScene`);
    const z = o.z ?? 0;
    for (const prev of layerZs) {
      if (Math.abs(prev - z) < 0.02) {
        throw new Error(`api.layer z ${z} is within 0.02 of another layer (z-fighting) — separate layer depths by >= 0.02`);
      }
    }
    layerZs.push(z);
    const h = makeHandle(basic({ transparent: true, opacity: 1 }), [o.x ?? 0, o.y ?? 0, z]);
    return record("layer", {
      path: r.path,
      aspect: r.aspect,
      width: o.width ?? 1,
      material: o.material ?? "unlit",
      emission: o.emission ?? 1,
    }, h);
  };
```

In `devicePhone`, record `screenFrames`:

```ts
  const devicePhone = (o: { screen: TextureHandle | string; width?: number; height?: number; depth?: number; radius?: number }) => {
    const screenTex = typeof o.screen === "string" ? { path: o.screen } : o.screen ?? { path: "" };
    return record("devicePhone", {
      screen: screenTex.path,
      ...(screenTex.frames ? { screenFrames: screenTex.frames } : {}),
      width: o.width ?? 1,
      height: o.height ?? 2.16,
      depth: o.depth ?? 0.08,
      radius: o.radius ?? 0.09,
    }, makeHandle());
  };
```

Add `screen, layer` to the exported `api` object (line ~289, beside `texture, gltf`).

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/sceneScreenLayer.test.ts`
Expected: PASS. Then `npx vitest run` — no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/render/scene/recordApi.ts tests/sceneScreenLayer.test.ts
git commit -m "feat(3d): api.screen + api.layer recording surface"
```

---

### Task 4: Thread raster maps through `runScene`

**Files:**
- Modify: `src/render/scene/runScene.ts:44-56` (opts), `:75` (createRecordApi call)
- Test: extend `tests/sceneScreenLayer.test.ts`

**Interfaces:**
- Consumes: Task 3's `createRecordApi` opts.
- Produces: `RunSceneOpts` gains `screens?: Record<string, { dir: string; frames: number }>` and `layers?: Record<string, { path: string; aspect: number }>`. Timeline hash changes when a raster digest path changes (it's inside object opts — automatic). Task 6 passes the maps.

- [ ] **Step 1: Write failing test** (append to `tests/sceneScreenLayer.test.ts`)

```ts
import { runScene } from "../src/render/scene/runScene.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9 };

describe("runScene raster threading", () => {
  const source = `const p = api.devicePhone({ screen: api.screen("screens/dash.html") });
return (env) => { p.rotation.y = env.progress; };`;
  const run = (dir: string) =>
    runScene({
      source, params: {}, words: [], theme, width: 270, height: 480, fps: 30, durationFrames: 2,
      quality: "draft", screens: { "screens/dash.html": { dir, frames: 2 } },
    });

  it("hash busts when the screen raster digest changes", () => {
    expect(run("_screens/aaa").hash).not.toBe(run("_screens/bbb").hash);
    expect(run("_screens/aaa").hash).toBe(run("_screens/aaa").hash);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sceneScreenLayer.test.ts`
Expected: FAIL — screens opt not accepted / api.screen throws (map never reaches the recorder).

- [ ] **Step 3: Implement**

In `RunSceneOpts` add:

```ts
  screens?: Record<string, { dir: string; frames: number }>;
  layers?: Record<string, { path: string; aspect: number }>;
```

Destructure them in `runScene` (default `{}`), and pass through:

```ts
  const recorder = createRecordApi({ baseParams: params, palette, screens, layers });
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/sceneScreenLayer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/scene/runScene.ts tests/sceneScreenLayer.test.ts
git commit -m "feat(3d): thread screen/layer raster maps through runScene"
```

---

### Task 5: Rasterizer (`rasterize.ts`)

**Files:**
- Create: `src/render/scene/rasterize.ts`
- Test: `tests/rasterize.test.ts` (new)

**Interfaces:**
- Consumes: `acquireBrowser`/`releaseBrowser`/`resolveExecutable` from `../native/browser.js`; `buildMotionVars`, `wordsShownAt` from `../motionVars.js`; `paramsAt`, `pulseAt` from `../bgparams.js`; `KINO_SCRUB_STYLE`, `KINO_DEFS` from `../motionCss.js` (Task 1); `svgAspect` from `../scene.js` (Task 2).
- Produces (Task 6 calls all of these):
  - `SCREEN_W = 720`, `SCREEN_H = 1556` (px; matches devicePhone screen aspect 0.94·1 : 0.94·2.16), `LAYER_MAX_DIM = 2048`.
  - `screenDigest(opts: ScreenRasterOpts): string` — sha1, pure.
  - `layerDigest(svg: string): string` — sha1, pure.
  - `rasterizeScreen(opts: ScreenRasterOpts & { outDir: string }): Promise<void>` — writes `f00001.png…f<N>.png`.
  - `rasterizeLayer(opts: { svg: string; outPath: string }): Promise<void>` — writes one alpha PNG.
  - `type ScreenRasterOpts = { html: string; words: WordTiming[]; theme: Theme; params: Record<string, BgParamValue>; keyframes: BgKeyframe[]; triggers: BgTrigger[]; fps: number; durationFrames: number }`.

- [ ] **Step 1: Write failing tests**

Create `tests/rasterize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { screenDigest, layerDigest, rasterizeScreen, rasterizeLayer, SCREEN_W, SCREEN_H } from "../src/render/scene/rasterize.js";
import { resolveExecutable } from "../src/render/native/browser.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9 };
const base = {
  html: `<div style="color:var(--kino-mint);opacity:var(--progress)">hi</div>`,
  words: [{ word: "hi", start: 0, end: 0.4 }],
  theme, params: {}, keyframes: [], triggers: [], fps: 30, durationFrames: 3,
};

describe("digests (pure)", () => {
  it("screenDigest is stable and content-sensitive", () => {
    expect(screenDigest(base)).toBe(screenDigest({ ...base }));
    expect(screenDigest(base)).not.toBe(screenDigest({ ...base, html: base.html + " " }));
    expect(screenDigest(base)).not.toBe(screenDigest({ ...base, durationFrames: 4 }));
    expect(screenDigest(base)).not.toBe(screenDigest({ ...base, words: [] }));
  });
  it("layerDigest is stable and content-sensitive", () => {
    const svg = `<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>`;
    expect(layerDigest(svg)).toBe(layerDigest(svg));
    expect(layerDigest(svg)).not.toBe(layerDigest(svg + " "));
  });
});

const chrome = await resolveExecutable();
if (!chrome) console.warn("rasterize browser tests SKIPPED — no Chrome found");
const maybe = chrome ? describe : describe.skip;

maybe("rasterize (Chrome)", () => {
  it("rasterizeScreen writes one PNG per frame at screen resolution", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-scr-"));
    await rasterizeScreen({ ...base, outDir: dir });
    const files = readdirSync(dir).filter((f) => /^f\d{5}\.png$/.test(f)).sort();
    expect(files).toEqual(["f00001.png", "f00002.png", "f00003.png"]);
  }, 60000);

  it("rasterizeLayer writes an alpha PNG", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-lay-"));
    const out = join(dir, "logo.png");
    await rasterizeLayer({ svg: `<svg viewBox="0 0 100 50"><circle cx="50" cy="25" r="20" fill="red"/></svg>`, outPath: out });
    expect(existsSync(out)).toBe(true);
  }, 60000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/rasterize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/render/scene/rasterize.ts`**

```ts
// Pre-rasterize pass for 3D scene beats: agent-authored HTML → per-frame PNG sequence (animated,
// VO-synced screen texture) and SVG → one alpha PNG (layer plane). Runs headless Chrome via the
// existing pool BEFORE Blender; output is content-addressed so the scene hash busts on content
// change and unchanged raster work is skipped. Same var/scrub injection as MotionGraphic — same
// bytes, same pixels.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "puppeteer";
import { acquireBrowser, releaseBrowser } from "../native/browser.js";
import { buildMotionVars, wordsShownAt } from "../motionVars.js";
import { paramsAt, pulseAt } from "../bgparams.js";
import { KINO_SCRUB_STYLE, KINO_DEFS } from "../motionCss.js";
import { svgAspect } from "../scene.js";
import type { Theme, WordTiming, BgKeyframe, BgTrigger, BgParamValue } from "../props.js";

// devicePhone screen inset is 0.94·(1 × 2.16) → aspect 1:2.16; 720px wide keeps raster cheap and
// legible mid-orbit. Bump RASTER_V when wrapper markup or var math changes (busts all digests).
export const SCREEN_W = 720;
export const SCREEN_H = 1556;
export const LAYER_MAX_DIM = 2048;
const RASTER_V = 1;

export interface ScreenRasterOpts {
  html: string; // sanitized Tier-1 markup (sanitizeMotionHtml already applied by the caller)
  words: WordTiming[];
  theme: Theme;
  params: Record<string, BgParamValue>;
  keyframes: BgKeyframe[];
  triggers: BgTrigger[];
  fps: number;
  durationFrames: number;
}

export function screenDigest(o: ScreenRasterOpts): string {
  return createHash("sha1")
    .update(JSON.stringify([RASTER_V, SCREEN_W, SCREEN_H, o.html, o.words, o.theme, o.params, o.keyframes, o.triggers, o.fps, o.durationFrames]))
    .digest("hex");
}

export function layerDigest(svg: string): string {
  return createHash("sha1").update(JSON.stringify([RASTER_V, LAYER_MAX_DIM, svg])).digest("hex");
}

// The shadow-DOM host page: same injection order as MotionGraphic's ShadowHtml (scrub style +
// defs + agent html), vars set on the host so they inherit across the shadow boundary.
function screenPage(html: string): string {
  return `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;width:${SCREEN_W}px;height:${SCREEN_H}px;overflow:hidden;background:#000}</style>
<div id="host" style="position:absolute;inset:0"></div>
<script>
const host = document.getElementById("host");
const shadow = host.attachShadow({ mode: "open" });
shadow.innerHTML = ${JSON.stringify(KINO_SCRUB_STYLE + KINO_DEFS + html)};
window.__kinoSetVars = (vars) => { for (const [k, v] of Object.entries(vars)) host.style.setProperty(k, v); };
</script>`;
}

async function withPage<T>(w: number, h: number, fn: (page: Page) => Promise<T>): Promise<T> {
  const browser = await acquireBrowser();
  try {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
      return await fn(page);
    } finally {
      await page.close();
    }
  } finally {
    await releaseBrowser();
  }
}

/** Rasterize an html screen to outDir/f00001.png… — one frame per beat frame, VO-synced vars. */
export async function rasterizeScreen(o: ScreenRasterOpts & { outDir: string }): Promise<void> {
  mkdirSync(o.outDir, { recursive: true });
  await withPage(SCREEN_W, SCREEN_H, async (page) => {
    await page.setContent(screenPage(o.html), { waitUntil: "networkidle0" });
    for (let f = 0; f < o.durationFrames; f++) {
      const tt = f / o.fps;
      const progress = o.durationFrames > 0 ? Math.min(1, Math.max(0, f / o.durationFrames)) : 0;
      const vars = buildMotionVars(o.theme, {
        frame: f,
        t: tt,
        progress,
        pulse: pulseAt(o.triggers, tt),
        params: paramsAt(o.params, o.keyframes, tt, { implicitBase: true }),
        captionBottom: 0, // a screen lives inside the device — no caption band to clear
        wordsShown: wordsShownAt(o.words, tt),
        wordCount: o.words.length,
      });
      await page.evaluate((v) => (window as unknown as { __kinoSetVars(v: Record<string, string>): void }).__kinoSetVars(v), vars);
      const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: SCREEN_W, height: SCREEN_H } });
      writeFileSync(join(o.outDir, `f${String(f + 1).padStart(5, "0")}.png`), png);
    }
  });
}

/** Rasterize one SVG element to a single alpha PNG at LAYER_MAX_DIM on its long edge. */
export async function rasterizeLayer(o: { svg: string; outPath: string }): Promise<void> {
  const aspect = svgAspect(o.svg);
  const w = aspect <= 1 ? LAYER_MAX_DIM : Math.max(1, Math.round(LAYER_MAX_DIM / aspect));
  const h = aspect <= 1 ? Math.max(1, Math.round(LAYER_MAX_DIM * aspect)) : LAYER_MAX_DIM;
  await withPage(w, h, async (page) => {
    const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${w}px;height:${h}px}</style>${o.svg}`;
    await page.setContent(html, { waitUntil: "networkidle0" });
    const png = await page.screenshot({ type: "png", omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
    writeFileSync(o.outPath, png);
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/rasterize.test.ts`
Expected: PASS (pure digests always; browser cases run if Chrome resolves, else skip with the warn line).

- [ ] **Step 5: Commit**

```bash
git add src/render/scene/rasterize.ts tests/rasterize.test.ts
git commit -m "feat(3d): chrome rasterizer — html screen sequences + svg layer pngs"
```

---

### Task 6: Wire the raster pass into the build

**Files:**
- Modify: `src/render/scene/ensureStills.ts` (optional `prepareAssets`), `src/commands/build.ts:405-444` (`ensureOne`)
- Test: `tests/ensureStillsPrepare.test.ts` (new)

**Interfaces:**
- Consumes: Tasks 2/4/5 exports; existing `lintMotionHtml` (`../render/motiongraphic.js`), `sanitizeMotionHtml` (`../render/sanitizeMotion.js`), `project.assetPath(rel)`, `stageAsset`.
- Produces:
  - `EnsureSceneStillsOpts` gains `prepareAssets?: () => Promise<void>` — awaited **only on a Blender cache miss**, after the wipe, before `renderTimeline`.
  - `ensureOne` (build.ts) computes digests + maps *before* `runScene` (pure file reads) and passes the actual Chrome raster work as `prepareAssets`.

- [ ] **Step 1: Write failing test**

Create `tests/ensureStillsPrepare.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSceneStills } from "../src/render/scene/ensureStills.js";
import type { Timeline } from "../src/render/scene/runScene.js";

const tl = (frames: number): Timeline =>
  ({ meta: { frameCount: frames } } as unknown as Timeline);

describe("ensureSceneStills prepareAssets", () => {
  it("runs prepareAssets on cache miss, before renderTimeline", async () => {
    const root = mkdtempSync(join(tmpdir(), "kino-ens-"));
    const calls: string[] = [];
    await ensureSceneStills({
      timeline: tl(1), hash: "h1", scene3dDir: root, publicDir: root, beatLabel: "b",
      resolveBlender: () => ({ bin: "blender", version: "4.2" }),
      prepareAssets: async () => { calls.push("prepare"); },
      renderTimeline: async ({ outDir }) => {
        calls.push("render");
        mkdirSync(outDir, { recursive: true });
        writeFileSync(join(outDir, "f00001.png"), "");
      },
    });
    expect(calls).toEqual(["prepare", "render"]);
  });

  it("skips prepareAssets on cache hit", async () => {
    const root = mkdtempSync(join(tmpdir(), "kino-ens-"));
    const dir = join(root, "h2");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "f00001.png"), "");
    const calls: string[] = [];
    await ensureSceneStills({
      timeline: tl(1), hash: "h2", scene3dDir: root, publicDir: root, beatLabel: "b",
      resolveBlender: () => ({ bin: "blender", version: "4.2" }),
      prepareAssets: async () => { calls.push("prepare"); },
      renderTimeline: async () => { calls.push("render"); },
    });
    expect(calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ensureStillsPrepare.test.ts`
Expected: FAIL — `prepareAssets` not a known option (TS error) or never called.

- [ ] **Step 3: Implement `ensureStills.ts`**

Add to `EnsureSceneStillsOpts`:

```ts
  /** Deferred raster work (Chrome screen/layer pngs) — only needed when Blender actually runs. */
  prepareAssets?: () => Promise<void>;
```

In `ensureSceneStills`, after the `rmSync`/`mkdirSync` pair and before `await renderTimeline(...)`:

```ts
  await opts.prepareAssets?.();
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/ensureStillsPrepare.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the raster maps in `build.ts`**

Add imports at the top of `build.ts`:

```ts
import { extractSceneRefs, svgAspect } from "../render/scene.js";
import { screenDigest, layerDigest, rasterizeScreen, rasterizeLayer } from "../render/scene/rasterize.js";
import { lintMotionHtml } from "../render/motiongraphic.js";
import { sanitizeMotionHtml } from "../render/sanitizeMotion.js";
```

Replace the body of `ensureOne` (build.ts:405-435) with:

```ts
  const ensureOne = async (
    mg: MotionGraphicProps | undefined,
    quality: "draft" | "final" | "max",
    durationFrames: number,
    beatLabel: string,
  ): Promise<void> => {
    if (!mg?.scene) return;
    const frames = Math.max(1, durationFrames);

    // Pre-raster maps: digests are pure content hashes (cheap file reads) so the timeline hash is
    // known up front; the actual Chrome work is deferred to prepareAssets (Blender cache miss only).
    const refs = extractSceneRefs(mg.scene, mg.params as Record<string, number | string>);
    if (refs.violations.length) throw new Error(`3D beat "${beatLabel}": ${refs.violations.join("; ")}`);
    const rasterJobs: (() => Promise<void>)[] = [];
    const screens: Record<string, { dir: string; frames: number }> = {};
    const layers: Record<string, { path: string; aspect: number }> = {};
    for (const rel of refs.screens) {
      const raw = readFileSync(project.assetPath(rel), "utf8");
      const bad = lintMotionHtml(raw);
      if (bad.length) throw new Error(`3D beat "${beatLabel}" screen ${rel}: ${bad.join("; ")}`);
      const html = sanitizeMotionHtml(raw);
      const rOpts = {
        html, words: mg.words ?? [], theme, params: mg.params, keyframes: mg.keyframes,
        triggers: mg.triggers, fps, durationFrames: frames,
      };
      const dir = join("_screens", screenDigest(rOpts));
      screens[rel] = { dir, frames };
      const abs = join(publicDir, dir);
      rasterJobs.push(async () => {
        if (existsSync(abs) && readdirSync(abs).filter((f) => /^f\d{5}\.png$/.test(f)).length === frames) return;
        rmSync(abs, { recursive: true, force: true });
        await rasterizeScreen({ ...rOpts, outDir: abs });
      });
    }
    for (const rel of refs.layers) {
      const svg = readFileSync(project.assetPath(rel), "utf8");
      const p = join("_layers", `${layerDigest(svg)}.png`);
      layers[rel] = { path: p, aspect: svgAspect(svg) };
      const abs = join(publicDir, p);
      rasterJobs.push(async () => {
        if (existsSync(abs)) return;
        mkdirSync(dirname(abs), { recursive: true });
        await rasterizeLayer({ svg, outPath: abs });
      });
    }

    const { timeline, hash } = runScene({
      source: mg.scene,
      params: mg.params as Record<string, number | string>,
      words: mg.words ?? [],
      theme,
      width: sceneW,
      height: sceneH,
      fps,
      durationFrames: frames,
      quality,
      keyframes: mg.keyframes,
      triggers: mg.triggers,
      screens,
      layers,
    });
    log.info(`  · 3d ${beatLabel} (${quality}, ${timeline.meta.frameCount} frames)`);
    mg.sceneFrames = await ensureSceneStills({
      timeline,
      hash,
      scene3dDir,
      publicDir,
      beatLabel,
      prepareAssets: async () => { for (const job of rasterJobs) await job(); },
    });
    // Page renders SceneFrames, not the raw scene source.
    mg.scene = undefined;
  };
```

Check existing imports in `build.ts` — `readFileSync`, `readdirSync`, `existsSync`, `rmSync`, `mkdirSync`, `dirname`, `join` may already be imported; add any missing to the existing `node:fs` / `node:path` import lines.

- [ ] **Step 6: Full suite + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean typecheck; all tests pass (build-scene tests stub `renderTimeline`, unaffected).

- [ ] **Step 7: Commit**

```bash
git add src/render/scene/ensureStills.ts src/commands/build.ts tests/ensureStillsPrepare.test.ts
git commit -m "feat(3d): pre-raster pass wired into build — deferred to blender cache miss"
```

---

### Task 7: Blender translator — sequence screens + layer planes

**Files:**
- Modify: `scripts/kino_render.py` — `build_screen_material` (line ~217), `build_device_phone` (~371), `build_object` (~705), main frame loop (~975)
- Test: additions to `tests/blenderRender.test.ts` (Blender-gated)

**Interfaces:**
- Consumes: timeline opts from Task 3 — devicePhone `screenFrames?: number`, layer opts `{ path, aspect, width, material: "unlit"|"emissive", emission }`.
- Produces: animated screen material (image sequence advancing with `scene.frame_set`), `build_layer` planes with alpha + animatable opacity (KinoAlpha node — `set_material_opacity` finds it).

- [ ] **Step 1: Write failing Blender-gated tests** (append inside the `maybe("blender render", ...)` block of `tests/blenderRender.test.ts`, reusing its `theme`, `rgbaSha`, imports)

```ts
  it("renders a layer plane from an alpha png", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-layer-"));
    mkdirSync(join(dir, "_layers"), { recursive: true });
    execFileSync("magick", ["-size", "64x32", "xc:rgba(255,0,0,1)", join(dir, "_layers", "l.png")]);
    const src = `api.layer("svg/logo.svg", { z: 0, width: 2 });
api.env("studio");
const cam = api.camera({ fov: 40 });
return (env) => { cam.dolly(4); };`;
    const { timeline } = runScene({
      source: src, params: {}, words: [], theme, width: 270, height: 480, fps: 30,
      durationFrames: 1, quality: "draft",
      layers: { "svg/logo.svg": { path: "_layers/l.png", aspect: 0.5 } },
    });
    const out = mkdtempSync(join(tmpdir(), "kino-layer-out-"));
    await renderTimeline({ timeline, outDir: out, publicDir: dir, blenderBin: blender!.bin });
    expect(existsSync(join(out, "f00001.png"))).toBe(true);
    // red layer must actually appear: mean red channel of the render is non-trivial
    const mean = execFileSync("magick", [join(out, "f00001.png"), "-channel", "R", "-format", "%[fx:mean]", "info:"]).toString();
    expect(Number(mean)).toBeGreaterThan(0.02);
  }, 120000);

  it("animated screen sequence advances across frames", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-seq-"));
    const seqDir = join(dir, "_screens", "d1");
    mkdirSync(seqDir, { recursive: true });
    execFileSync("magick", ["-size", "72x156", "xc:red", join(seqDir, "f00001.png")]);
    execFileSync("magick", ["-size", "72x156", "xc:blue", join(seqDir, "f00002.png")]);
    const src = `api.devicePhone({ screen: api.screen("screens/ui.html") });
api.env("studio");
const cam = api.camera({ fov: 40 });
return (env) => { cam.dolly(5); };`;
    const { timeline } = runScene({
      source: src, params: {}, words: [], theme, width: 270, height: 480, fps: 30,
      durationFrames: 2, quality: "draft",
      screens: { "screens/ui.html": { dir: "_screens/d1", frames: 2 } },
    });
    const out = mkdtempSync(join(tmpdir(), "kino-seq-out-"));
    await renderTimeline({ timeline, outDir: out, publicDir: dir, blenderBin: blender!.bin });
    expect(rgbaSha(join(out, "f00001.png"))).not.toBe(rgbaSha(join(out, "f00002.png")));
  }, 120000);
```

(Add `mkdirSync` to the test file's `node:fs` import if missing.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/blenderRender.test.ts`
Expected (with Blender installed): FAIL — `unknown timeline object type: 'layer'`; sequence test fails with identical frame hashes. Without Blender: suite skips — implement anyway, verification then relies on Step 4's selftest + Task 8's full run.

- [ ] **Step 3: Implement in `scripts/kino_render.py`**

**3a — sequence-aware screen material.** Change `build_screen_material` signature to `build_screen_material(image_path, name, frame_count=0)` and replace the load block:

```python
def build_screen_material(image_path, name, frame_count=0):
    """Emission-mixed screenshot texture; a directory (frame_count > 0) mounts f%05d.png as an
    image SEQUENCE that advances with scene.frame_set. Missing/unreadable asset -> dark emission
    fallback, never raises (a broken beat asset shouldn't crash a whole build)."""
    mat = new_material(name)
    nt = mat.node_tree
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emission = nt.nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.4
    loaded = False
    load_path = image_path
    if image_path and frame_count > 0 and os.path.isdir(image_path):
        load_path = os.path.join(image_path, "f00001.png")
    if load_path and os.path.isfile(load_path):
        try:
            img = bpy.data.images.load(load_path, check_existing=True)
            img.colorspace_settings.name = "sRGB"
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = img
            if frame_count > 0 and load_path != image_path:
                img.source = "SEQUENCE"
                tex.image_user.frame_duration = frame_count
                tex.image_user.frame_start = 1
                tex.image_user.frame_offset = 0
                tex.image_user.use_auto_refresh = True
            nt.links.new(tex.outputs["Color"], emission.inputs["Color"])
            loaded = True
        except Exception:
            loaded = False
    if not loaded:
        emission.inputs["Color"].default_value = (0.02, 0.02, 0.02, 1.0)
        emission.inputs["Strength"].default_value = 0.05
    nt.links.new(emission.outputs[0], out.inputs["Surface"])
    set_material_transparent(mat, False)
    return mat
```

**3b — devicePhone passes the frame count.** In `build_device_phone`, change the material append line to:

```python
    screen.data.materials.append(
        build_screen_material(full_path, spec["id"] + "_screen_mat", int(o.get("screenFrames", 0)))
    )
```

**3c — layer builder.** Add after `build_device_phone`:

```python
def build_layer_material(image_path, name, material_kind, emission_strength):
    """Rasterized SVG plane: texture color -> emission (unlit look, both engines), texture alpha ×
    per-frame KinoAlpha -> Principled Alpha via a transparent mix. Missing asset -> fully
    transparent plane (invisible, never crashes)."""
    mat = new_material(name)
    nt = mat.node_tree
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emission = nt.nodes.new("ShaderNodeEmission")
    strength = emission_strength if material_kind == "emissive" else 1.0
    emission.inputs["Strength"].default_value = strength
    transparent = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    alpha_mul = nt.nodes.new("ShaderNodeMath")
    alpha_mul.operation = "MULTIPLY"
    alpha_node = add_alpha_value_node(mat)  # KinoAlpha: set_material_opacity animates this
    loaded = False
    if image_path and os.path.isfile(image_path):
        try:
            img = bpy.data.images.load(image_path, check_existing=True)
            img.colorspace_settings.name = "sRGB"
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = img
            nt.links.new(tex.outputs["Color"], emission.inputs["Color"])
            nt.links.new(tex.outputs["Alpha"], alpha_mul.inputs[0])
            loaded = True
        except Exception:
            loaded = False
    if not loaded:
        alpha_mul.inputs[0].default_value = 0.0
    nt.links.new(alpha_node.outputs[0], alpha_mul.inputs[1])
    nt.links.new(alpha_mul.outputs[0], mix.inputs["Fac"])
    nt.links.new(transparent.outputs[0], mix.inputs[1])
    nt.links.new(emission.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    set_material_transparent(mat, True)
    return mat


def build_layer(spec, public_dir):
    o = spec["opts"]
    w = float(o.get("width", 1))
    h = w * float(o.get("aspect", 1))
    bpy.ops.mesh.primitive_plane_add(size=1)
    obj = bpy.context.active_object
    obj.name = spec["id"]
    obj.dimensions = (w, h, 0)
    bpy.context.view_layer.update()
    apply_scale(obj)
    # Face kino +z (toward the default camera), height on blender Z — same convention as the
    # devicePhone screen plane.
    obj.rotation_euler = (math.radians(90), 0.0, 0.0)
    path = o.get("path", "")
    full = path if os.path.isabs(path) else os.path.join(public_dir, path)
    obj.data.materials.append(
        build_layer_material(full, spec["id"] + "_mat", o.get("material", "unlit"), float(o.get("emission", 1)))
    )
    return obj
```

**Check `apply_frame` rotation stomping:** the recorder snapshots the handle rotation (0,0,0) each frame and `apply_frame` overwrites `rotation_euler` via `kino_to_blender_euler`. Verify `kino_to_blender_euler([0,0,0])` yields the same 90° X result the builder set — read the function; if (like `kino_to_blender_pos`) it maps kino Y-up to Blender Z-up by adding the axis conversion, the builder's initial rotation is redundant and harmless. If instead it returns identity (plane lies flat after frame 1), **bake the facing into the mesh instead of the object rotation**: after `apply_scale(obj)` do

```python
    obj.data.transform(Euler((math.radians(90), 0.0, 0.0)).to_matrix().to_4x4())
    obj.rotation_euler = (0.0, 0.0, 0.0)
```

(add `from mathutils import Euler` beside the existing `Vector` import) and delete the `rotation_euler = (math.radians(90), ...)` line. The blender-gated layer test (red-channel assertion) catches the wrong choice.

**3d — dispatch.** In `build_object`, before the `raise`:

```python
    if t == "layer":
        return build_layer(spec, public_dir)
```

**3e — frame loop.** In `main()`, add `scene.frame_set(i + 1)` as the first line of the render loop:

```python
    for i, frame in enumerate(timeline["frames"]):
        scene.frame_set(i + 1)
        apply_frame(frame, objects_by_id, object_types_by_id, camera_obj)
        scene.render.filepath = os.path.join(out_dir, f"f{i + 1:05d}.png")
        bpy.ops.render.render(write_still=True)
```

- [ ] **Step 4: Python selftest still green**

Run: `python3 scripts/kino_render.py --selftest`
Expected: exits 0 (pure-math selftest; bpy not needed).

- [ ] **Step 5: Run Blender-gated tests**

Run: `npx vitest run tests/blenderRender.test.ts`
Expected: PASS (or SKIPPED without Blender — then run on a machine with Blender before ship).

- [ ] **Step 6: Commit**

```bash
git add scripts/kino_render.py tests/blenderRender.test.ts
git commit -m "feat(3d): blender translator — sequence screen material + svg layer planes"
```

---

### Task 8: Preset upgrade, docs, dist build

**Files:**
- Modify: `assets-lib/motion/phone-orbit.scene.js:4`, `docs/3d-scenes.md` (api table + spec shape), `.claude/skills/3d-scenes/SKILL.md` (presets/craft tables)
- Test: full suite + `npm run build`

**Interfaces:**
- Consumes: everything above.
- Produces: `phone-orbit` accepts `.html` or image `screenshot` param; docs/skill describe `api.screen` / `api.layer`.

- [ ] **Step 1: Preset**

In `assets-lib/motion/phone-orbit.scene.js` change line 4 and the params comment (line 3):

```js
// params: screenshot (required asset path — .png/.jpg still or .html animated screen) · spin (yaw sweep in half-turns, default 0.35 ≈ 63°) · zoom (default 1)
const phone = api.devicePhone({ screen: api.screen(api.param("screenshot")) });
```

- [ ] **Step 2: Docs**

`docs/3d-scenes.md` — add to the api table (match its existing row format):

| member | what |
|---|---|
| `api.screen(pathOrParam)` | Screen texture. `.html` → VO-synced animated sequence (Tier-1 contract: `--kino-*` vars, `--progress`, `--kino-words-shown`; rasterized 720×1556 before Blender). Image paths pass through like `api.texture`. |
| `api.layer(pathOrParam, {x,y,z,width,material,emission})` | One SVG element as its own plane (alpha PNG, 2048px long edge). `width` in world units, height from the SVG aspect. `material: "unlit"` (default) or `"emissive"` + `emission`. Animate via handle transforms + `.material.opacity`. Layer z values must differ by ≥ 0.02. |

Note in the caching section: raster outputs are content-addressed under `_public/_screens/<digest>/` and `_public/_layers/<digest>.png`; Chrome raster runs only on a Blender cache miss.

`.claude/skills/3d-scenes/SKILL.md` — add craft-bar row:

| Layered SVG / HTML screen | Each element crisp at rest; visible depth separation on camera move; no halo on alpha edges; screen UI state lands on spoken words |

and mention in the presets section that `phone-orbit`'s `screenshot` accepts `.html`.

- [ ] **Step 3: Full verification**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all green. (Memory: the CLI runs `dist/` — without `npm run build` the new api members are silently absent.)

- [ ] **Step 4: Commit**

```bash
git add assets-lib/motion/phone-orbit.scene.js docs/3d-scenes.md .claude/skills/3d-scenes/SKILL.md
git commit -m "feat(3d): phone-orbit html screens + api.screen/api.layer docs"
```

---

## Self-Review Notes

- Spec coverage: `api.screen` (Tasks 3–7), `api.layer` multi-SVG (2,3,5,6,7), VO sync via `buildMotionVars` (5), cache/digest (5,6), error posture — missing raster throws, never blank (3,6; Python keeps its never-crash fallback for missing *files* per its existing contract), z-gap lint (3), phone-orbit upgrade + docs (8). P2 (`svg3d`) and P3 (composite-after) intentionally absent — later phases.
- Type consistency: `{ dir, frames }` for screens and `{ path, aspect }` for layers used identically in Tasks 2–7; `screenFrames` opt name consistent between recordApi and Python.
- Known deliberate simplifications: screens are devicePhone-only in P1 (layers cover flat panels); raster resolution fixed (720×1556 / 2048); sequential raster jobs (beats are few, Chrome pool reused).
