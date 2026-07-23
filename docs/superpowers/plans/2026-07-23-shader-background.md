# Shader Background (Rung 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic WebGL fragment-shader backdrop, authored in the ShaderToy `mainImage` convention, as a new flavor of the existing `custom` background.

**Architecture:** Rides the existing `background:"custom"` + `backgroundComponent` seam. The resolver learns `.frag`/`.glsl` files; the build reads the source into a new `shaderCode` prop; a new `ShaderBackground` React component compiles a fullscreen-quad WebGL2 program once and sets frame-derived uniforms per seek (`iTime = frame/fps`), so every frame is a pure function of its index — same determinism contract as the Canvas2D backgrounds it sits beside.

**Tech Stack:** TypeScript, React 18 (native render page), WebGL2 (GLSL ES 3.00), puppeteer frame-stepping engine, esbuild page bundle, vitest.

## Global Constraints

- Kino runs from compiled `dist/`, not `src/` — run `npm run build` before any `kino` invocation picks up new source. `build` = `tsc && node scripts/build-page.mjs`; the page bundle (`scripts/build-page.mjs`, entry `src/render/native/page/index.tsx`, `bundle:true`) auto-includes any component reachable through the import graph — no manual registration.
- Determinism: time comes only from `iTime`/`iFrame` (frame-derived). No wall clock, no RAF, no random. `gl.finish()` before a frame is considered done.
- Background layer only. No motion overlays, no Three.js, no textures/GLTF (that is rung 2).
- No schema change: authored spec stays `{ "background": "custom", "backgroundComponent": "<id-or-path>" }`.
- Palette tokens: `night`, `mint`, `green`, `gold`, `white` (see `Theme`, `src/render/props.ts:5`). Background base params carry `colorA`/`colorB`/`colorC` (brand backgroundColors) + `intensity`.
- Tests: vitest only, no new frameworks. Pure units get unit tests; WebGL raster is verified by eye via `kino still`.

---

### Task 1: Shader source assembly + uniform resolution (pure)

The two pure, GL-free units: assemble the compiled GLSL from the agent's `mainImage` body, and turn resolved params + frame context into concrete uniform values. Both fully unit-tested.

**Files:**
- Create: `src/render/shaderSource.ts`
- Test: `tests/render/shaderSource.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `assembleShaderSource(body: string): string` — full fragment shader (`#version 300 es` … `main()` calling `mainImage`).
  - `hexToVec3(hex: string): [number, number, number]` — `#rrggbb`/`#rgb` → normalized RGB; invalid → `[1,1,1]`.
  - `EXTRA_PARAM_SLOTS = 4`
  - `interface UniformValues { iResolution: [number, number, number]; iTime: number; iFrame: number; iTimeDelta: number; uPulse: number; uColorA: [number, number, number]; uColorB: [number, number, number]; uColorC: [number, number, number]; uIntensity: number; uParams: number[] }`
  - `resolveUniforms(params: Record<string, number | string>, ctx: { frame: number; fps: number; width: number; height: number; pulse: number }): UniformValues`

- [ ] **Step 1: Write the failing test**

```ts
// tests/render/shaderSource.test.ts
import { describe, it, expect } from "vitest";
import { assembleShaderSource, hexToVec3, resolveUniforms } from "../../src/render/shaderSource.js";

const BODY = "void mainImage(out vec4 fragColor, in vec2 fragCoord){ fragColor = vec4(uColorA, 1.0); }";

describe("assembleShaderSource", () => {
  it("prepends version, precision, uniforms, and a main() that calls mainImage", () => {
    const src = assembleShaderSource(BODY);
    expect(src.startsWith("#version 300 es")).toBe(true);
    expect(src).toContain("precision highp float;");
    for (const u of ["iResolution", "iTime", "iFrame", "iTimeDelta", "uPulse", "uColorA", "uColorB", "uColorC", "uIntensity", "uParam0", "uParam3"]) {
      expect(src).toContain(`uniform`);
      expect(src).toContain(u);
    }
    expect(src).toContain(BODY);
    expect(src).toContain("void main()");
    expect(src).toContain("mainImage(kino_fragColor, gl_FragCoord.xy)");
  });
});

describe("hexToVec3", () => {
  it("parses #rrggbb to normalized rgb", () => {
    const [r, g, b] = hexToVec3("#ff8000");
    expect(r).toBeCloseTo(1, 5);
    expect(g).toBeCloseTo(0.50196, 4);
    expect(b).toBeCloseTo(0, 5);
  });
  it("expands #rgb shorthand", () => {
    expect(hexToVec3("#0f0")).toEqual([0, 1, 0]);
  });
  it("falls back to white on garbage", () => {
    expect(hexToVec3("not-a-color")).toEqual([1, 1, 1]);
  });
});

describe("resolveUniforms", () => {
  const params = { colorA: "#ff0000", colorB: "#00ff00", colorC: "#0000ff", intensity: 0.7, speed: 2, wobble: 0.3 };
  const ctx = { frame: 48, fps: 24, width: 1080, height: 1920, pulse: 0.5 };

  it("derives iTime/iFrame from the frame index only", () => {
    const u = resolveUniforms(params, ctx);
    expect(u.iTime).toBeCloseTo(2, 6);          // 48 / 24
    expect(u.iFrame).toBe(48);
    expect(u.iTimeDelta).toBeCloseTo(1 / 24, 6);
    expect(u.iResolution).toEqual([1080, 1920, 1]);
  });
  it("is a pure function of frame (same frame -> identical values)", () => {
    expect(resolveUniforms(params, ctx)).toEqual(resolveUniforms(params, { ...ctx }));
  });
  it("maps color params through hexToVec3 and passes intensity/pulse", () => {
    const u = resolveUniforms(params, ctx);
    expect(u.uColorA).toEqual([1, 0, 0]);
    expect(u.uIntensity).toBeCloseTo(0.7, 6);
    expect(u.uPulse).toBeCloseTo(0.5, 6);
  });
  it("maps extra numeric params (sorted by key, reserved excluded) into uParams[0..3]", () => {
    const u = resolveUniforms(params, ctx);
    // extras sorted: speed, wobble -> [2, 0.3, 0, 0]
    expect(u.uParams).toEqual([2, 0.3, 0, 0]);
  });
  it("guards fps=0", () => {
    const u = resolveUniforms(params, { ...ctx, fps: 0 });
    expect(u.iTime).toBe(0);
    expect(u.iTimeDelta).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render/shaderSource.test.ts`
Expected: FAIL — `Cannot find module '../../src/render/shaderSource.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/render/shaderSource.ts
// Pure helpers for the WebGL shader background (rung 1). GL-free so they unit-test in Node.
// Determinism: iTime/iFrame come only from the frame index — no wall clock.

export const EXTRA_PARAM_SLOTS = 4;

// Params owned by the fixed uniform header; everything else numeric spills into uParam0..N.
const RESERVED = new Set(["colorA", "colorB", "colorC", "intensity"]);

const UNIFORM_HEADER = [
  "uniform vec3  iResolution;",
  "uniform float iTime;",
  "uniform int   iFrame;",
  "uniform float iTimeDelta;",
  "uniform vec4  iMouse;", // zeroed — ShaderToy paste-compat, no interactivity
  "uniform float uPulse;",
  "uniform vec3  uColorA;",
  "uniform vec3  uColorB;",
  "uniform vec3  uColorC;",
  "uniform float uIntensity;",
  "uniform float uParam0;",
  "uniform float uParam1;",
  "uniform float uParam2;",
  "uniform float uParam3;",
].join("\n");

/** Wrap an agent-authored ShaderToy `mainImage` body into a compilable GLSL ES 3.00 fragment shader. */
export function assembleShaderSource(body: string): string {
  return (
    "#version 300 es\n" +
    "precision highp float;\n\n" +
    UNIFORM_HEADER +
    "\n\nout vec4 kino_fragColor;\n\n" +
    "// ---- authored body ----\n" +
    body +
    "\n// ---- kino entry ----\n" +
    "void main() { mainImage(kino_fragColor, gl_FragCoord.xy); }\n"
  );
}

/** `#rrggbb` / `#rgb` → normalized [r,g,b]; anything unparseable → white. */
export function hexToVec3(hex: string): [number, number, number] {
  if (typeof hex !== "string") return [1, 1, 1];
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [1, 1, 1];
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

export interface UniformValues {
  iResolution: [number, number, number];
  iTime: number;
  iFrame: number;
  iTimeDelta: number;
  uPulse: number;
  uColorA: [number, number, number];
  uColorB: [number, number, number];
  uColorC: [number, number, number];
  uIntensity: number;
  uParams: number[];
}

const numOf = (v: unknown, d: number): number => (typeof v === "number" ? v : Number(v) || d);
const colOf = (v: unknown): [number, number, number] => hexToVec3(typeof v === "string" ? v : "#ffffff");

/** Resolved (already-tweened) params + frame context → concrete uniform values. Pure. */
export function resolveUniforms(
  params: Record<string, number | string>,
  ctx: { frame: number; fps: number; width: number; height: number; pulse: number },
): UniformValues {
  const extras = Object.keys(params)
    .filter((k) => !RESERVED.has(k) && typeof params[k] === "number")
    .sort();
  const uParams = Array.from({ length: EXTRA_PARAM_SLOTS }, (_, i) => (i < extras.length ? (params[extras[i]] as number) : 0));
  return {
    iResolution: [ctx.width, ctx.height, 1],
    iTime: ctx.fps > 0 ? ctx.frame / ctx.fps : 0,
    iFrame: ctx.frame,
    iTimeDelta: ctx.fps > 0 ? 1 / ctx.fps : 0,
    uPulse: ctx.pulse,
    uColorA: colOf(params.colorA),
    uColorB: colOf(params.colorB),
    uColorC: colOf(params.colorC),
    uIntensity: numOf(params.intensity, 0.5),
    uParams,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/render/shaderSource.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/render/shaderSource.ts tests/render/shaderSource.test.ts
git commit -m "feat(render): shader source assembly + uniform resolution (pure)"
```

---

### Task 2: Resolver learns `.frag`/`.glsl`

Teach the background-component resolver to find shader files by bare id, expose a kind check, and list shader ids alongside `.js`.

**Files:**
- Modify: `src/media/backgroundLib.ts`
- Test: `tests/media/backgroundLib.shader.test.ts`

**Interfaces:**
- Consumes: existing `resolveBackgroundComponent(src, project)` (returns an absolute path).
- Produces:
  - `SHADER_EXTS = [".frag", ".glsl"]`
  - `isShaderPath(p: string): boolean`
  - `resolveBackgroundComponent` bare-id probe order becomes `.js`, `.frag`, `.glsl`; a bare id matching more than one extension throws a disambiguation error.
  - `listBackgroundIds()` includes shader ids.

- [ ] **Step 1: Write the failing test**

```ts
// tests/media/backgroundLib.shader.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isShaderPath, resolveBackgroundComponent } from "../../src/media/backgroundLib.js";

describe("isShaderPath", () => {
  it("is true for .frag/.glsl and false for .js", () => {
    expect(isShaderPath("a/b/aurora-flow.frag")).toBe(true);
    expect(isShaderPath("x.glsl")).toBe(true);
    expect(isShaderPath("x.GLSL")).toBe(true);
    expect(isShaderPath("brand-wash.js")).toBe(false);
  });
});

describe("resolveBackgroundComponent — project shader path", () => {
  let ws: string;
  const project = () => ({
    assetPath: (rel: string) => join(ws, "assets", rel),
    workspaceRoot: ws,
  }) as any;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "kino-bglib-"));
    mkdirSync(join(ws, "assets", "backgrounds"), { recursive: true });
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it("resolves a project-relative .frag path", () => {
    const p = join(ws, "assets", "backgrounds", "waves.frag");
    writeFileSync(p, "void mainImage(out vec4 c, in vec2 f){}");
    expect(resolveBackgroundComponent("backgrounds/waves.frag", project())).toBe(p);
    expect(isShaderPath(resolveBackgroundComponent("backgrounds/waves.frag", project()))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/media/backgroundLib.shader.test.ts`
Expected: FAIL — `isShaderPath` is not exported.

- [ ] **Step 3: Write minimal implementation**

Replace the body of `src/media/backgroundLib.ts` with (changes: `SHADER_EXTS`/`isShaderPath`, multi-ext bare-id probe, shader ids in the listing):

```ts
// Background draw-fn / shader resolution: bare id ("brand-wash") → assets-lib/backgrounds/<id>.{js,frag,glsl};
// otherwise project assets/ path, then workspace-relative (brand.backgroundComponent).
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import type { Project } from "../config/project.js";

const here = dirname(fileURLToPath(import.meta.url));
export const BACKGROUND_LIB_DIR = resolve(here, "../../assets-lib/backgrounds");

export const SHADER_EXTS = [".frag", ".glsl"];
const LIB_EXTS = [".js", ...SHADER_EXTS];

/** A resolved component path that should render through the WebGL shader engine (vs Canvas2D). */
export function isShaderPath(p: string): boolean {
  return SHADER_EXTS.includes(extname(p).toLowerCase());
}

function isBareId(src: string): boolean {
  return !src.includes("/") && !src.includes(".");
}

export function listBackgroundIds(): string[] {
  if (!existsSync(BACKGROUND_LIB_DIR)) return [];
  return readdirSync(BACKGROUND_LIB_DIR)
    .filter((f) => LIB_EXTS.includes(extname(f).toLowerCase()))
    .map((f) => f.slice(0, -extname(f).length))
    .sort();
}

export function resolveBackgroundComponent(src: string, project: Project): string {
  if (isBareId(src)) {
    const hits = LIB_EXTS.map((ext) => join(BACKGROUND_LIB_DIR, `${src}${ext}`)).filter((p) => existsSync(p));
    if (hits.length > 1) {
      throw new Error(
        `Ambiguous background id "${src}" — multiple files match (${hits
          .map((h) => h.slice(BACKGROUND_LIB_DIR.length + 1))
          .join(", ")}). Reference one by path to disambiguate.`,
      );
    }
    if (hits.length === 0) {
      const ids = listBackgroundIds();
      throw new Error(
        `Unknown background id "${src}" — ${
          ids.length ? `library has: ${ids.join(", ")}` : "assets-lib/backgrounds/ is empty"
        }. Use a project path (e.g. "backgrounds/${src}.frag") or add the file to assets-lib/backgrounds/.`,
      );
    }
    return hits[0];
  }
  const asAsset = project.assetPath(src);
  if (existsSync(asAsset)) return asAsset;
  const asWorkspace = isAbsolute(src) ? src : join(project.workspaceRoot, src);
  if (existsSync(asWorkspace)) return asWorkspace;
  throw new Error(
    `Background component not found: tried assets/${src} and ${src} (workspace). ` +
      `For a library draw fn or shader use a bare id (kino backgrounds).`,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/media/backgroundLib.shader.test.ts`
Expected: PASS.
Run (regression): `npx vitest run tests/media`
Expected: PASS — existing `.js` resolution unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/media/backgroundLib.ts tests/media/backgroundLib.shader.test.ts
git commit -m "feat(bg): resolver finds .frag/.glsl shader components"
```

---

### Task 3: Prop + build wiring

Carry a resolved shader's source into the render props on a new `shaderCode` field, distinct from the Canvas2D `customCode`.

**Files:**
- Modify: `src/render/props.ts:83-90` (BackgroundProps)
- Modify: `src/commands/build.ts:219-242` (custom branch + background object)

**Interfaces:**
- Consumes: `isShaderPath`, `resolveBackgroundComponent` (Task 2).
- Produces: `BackgroundProps.shaderCode: string | null`; build sets exactly one of `customCode` / `shaderCode`.

- [ ] **Step 1: Add the prop field**

In `src/render/props.ts`, extend `BackgroundProps` (after the `customCode` line at :86):

```ts
export interface BackgroundProps {
  kind: "glow" | "image" | "mesh" | "aurora" | "particles" | "grid" | "solid" | "custom";
  image: string | null; // staticFile-relative path, for kind="image"
  customCode: string | null; // Canvas2D draw-fn source, for kind="custom" (.js)
  shaderCode: string | null; // GLSL mainImage body, for kind="custom" (.frag/.glsl)
  params: Record<string, BgParamValue>; // base param values (tweened by keyframes)
  keyframes: BgKeyframe[]; // agent-authored param tweens over time
  triggers: BgTrigger[]; // agent-authored one-shot actions (e.g. pulse)
}
```

- [ ] **Step 2: Wire the build's custom branch**

In `src/commands/build.ts`, add `isShaderPath` to the existing import from `../media/backgroundLib.js` (line ~27):

```ts
import { resolveBackgroundComponent, isShaderPath } from "../media/backgroundLib.js";
```

Replace the custom branch + background object (lines ~213-242) so a shader path routes to `shaderCode`:

```ts
  let bgImageRel: string | null = null;
  let bgCustomCode: string | null = null;
  let bgShaderCode: string | null = null;
  if (bgKind === "image") {
    const imgAbs = resolveBrandFile(brand.facelessBackdrop, project);
    if (!imgAbs) throw new Error('background "image" needs brand.facelessBackdrop');
    copyFileSync(imgAbs, join(publicDir, "faceless-bg.png"));
    bgImageRel = "faceless-bg.png";
  } else if (bgKind === "custom") {
    const compRef = spec.backgroundComponent ?? brand.backgroundComponent;
    if (!compRef) {
      throw new Error(
        'background "custom" needs backgroundComponent on the spec or brand ' +
          '(bare id e.g. "brand-wash", or a path). See `kino backgrounds`.',
      );
    }
    const compPath = resolveBackgroundComponent(compRef, project);
    const code = readFileSync(compPath, "utf8");
    if (isShaderPath(compPath)) bgShaderCode = code;
    else bgCustomCode = code;
  }
  const bgColors = resolveBackgroundColors(brand);
  const background = {
    kind: bgKind,
    image: bgImageRel,
    customCode: bgCustomCode,
    shaderCode: bgShaderCode,
    params: {
      colorA: bgColors[0],
      colorB: bgColors[1],
      colorC: bgColors[2],
      intensity: resolveBackgroundIntensity(brand, spec),
    },
    keyframes: spec.backgroundKeyframes ?? [],
    triggers: spec.backgroundTriggers ?? [],
  };
```

- [ ] **Step 3: Typecheck + full test suite (regression gate)**

Run: `npm run build`
Expected: `tsc` passes (no missing-property errors on `BackgroundProps`), page bundle emits.
Run: `npx vitest run`
Expected: PASS — no existing test constructs a `BackgroundProps` literal without `shaderCode`; if one does, add `shaderCode: null` to it (surfaced as a tsc error in this step, fix inline).

- [ ] **Step 4: Commit**

```bash
git add src/render/props.ts src/commands/build.ts
git commit -m "feat(build): route .frag/.glsl backgrounds to shaderCode prop"
```

---

### Task 4: ShaderBackground component + mount

The WebGL2 fullscreen-quad renderer. Sibling of `CanvasBackground.tsx`, same per-frame layout-effect contract; compile once, set uniforms per frame, `gl.finish()`.

**Files:**
- Create: `src/render/native/page/ShaderBackground.tsx`
- Modify: `src/render/native/page/components.tsx:181-211` (FacelessBackdrop)

**Interfaces:**
- Consumes: `assembleShaderSource`, `resolveUniforms` (Task 1); `paramsAt`, `pulseAt` (`src/render/bgparams.ts`); `BackgroundProps.shaderCode`; runtime `useCurrentFrame`/`useVideoConfig`/`AbsoluteFill` (`./runtime`).
- Produces: `ShaderBackground` React component: `{ shaderSrc: string; params; keyframes; triggers; t: Theme }`.

- [ ] **Step 1: Create the component**

```tsx
// src/render/native/page/ShaderBackground.tsx
// WebGL2 fullscreen-quad background (rung 1). Mirrors CanvasBackground's contract: a per-frame
// useLayoutEffect runs synchronously inside the flushSync seek, so the screenshot captures a
// completed frame. The program compiles once (ref-cached); each frame only resolves tweened params
// and sets uniforms. Motion is frame-derived (iTime = frame/fps) → deterministic.
import React, { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "./runtime";
import type { Theme, BgParamValue, BgKeyframe, BgTrigger } from "../../props.js";
import { paramsAt, pulseAt } from "../../bgparams.js";
import { assembleShaderSource, resolveUniforms } from "../../shaderSource.js";

const VERT = `#version 300 es
void main() {
  // gl_VertexID fullscreen triangle — no attributes/VBO.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

interface Program {
  gl: WebGL2RenderingContext;
  prog: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
}

function compile(canvas: HTMLCanvasElement, fragSrc: string): Program | string {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
  if (!gl) return "webgl2 unavailable";
  const mk = (type: number, src: string): WebGLShader | string => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return gl.getShaderInfoLog(sh) ?? "shader compile failed";
    return sh;
  };
  const vs = mk(gl.VERTEX_SHADER, VERT);
  if (typeof vs === "string") return vs;
  const fs = mk(gl.FRAGMENT_SHADER, fragSrc);
  if (typeof fs === "string") return fs;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return gl.getProgramInfoLog(prog) ?? "program link failed";
  const names = ["iResolution", "iTime", "iFrame", "iTimeDelta", "iMouse", "uPulse", "uColorA", "uColorB", "uColorC", "uIntensity", "uParam0", "uParam1", "uParam2", "uParam3"];
  const loc: Record<string, WebGLUniformLocation | null> = {};
  for (const n of names) loc[n] = gl.getUniformLocation(prog, n);
  return { gl, prog, loc };
}

export const ShaderBackground: React.FC<{
  shaderSrc: string;
  params: Record<string, BgParamValue>;
  keyframes: BgKeyframe[];
  triggers: BgTrigger[];
  t: Theme;
}> = ({ shaderSrc, params, keyframes, triggers, t }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const ref = useRef<HTMLCanvasElement>(null);
  const progRef = useRef<Program | null>(null);
  const errRef = useRef<string | null>(null);

  // Intentional: re-runs every frame (frame-derived deps). NOT a missing-deps bug — do not add [].
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas || errRef.current) return;
    if (!progRef.current) {
      const built = compile(canvas, assembleShaderSource(shaderSrc));
      if (typeof built === "string") {
        errRef.current = built;
        if (frame === 0) console.error("ShaderBackground compile failed:\n" + built);
        return;
      }
      progRef.current = built;
    }
    const { gl, prog, loc } = progRef.current;
    const tt = fps > 0 ? frame / fps : 0;
    const u = resolveUniforms(paramsAt(params, keyframes, tt), { frame, fps, width, height, pulse: pulseAt(triggers, tt) });

    gl.viewport(0, 0, width, height);
    gl.useProgram(prog);
    gl.uniform3f(loc.iResolution, u.iResolution[0], u.iResolution[1], u.iResolution[2]);
    gl.uniform1f(loc.iTime, u.iTime);
    gl.uniform1i(loc.iFrame, u.iFrame);
    gl.uniform1f(loc.iTimeDelta, u.iTimeDelta);
    gl.uniform4f(loc.iMouse, 0, 0, 0, 0);
    gl.uniform1f(loc.uPulse, u.uPulse);
    gl.uniform3fv(loc.uColorA, u.uColorA);
    gl.uniform3fv(loc.uColorB, u.uColorB);
    gl.uniform3fv(loc.uColorC, u.uColorC);
    gl.uniform1f(loc.uIntensity, u.uIntensity);
    gl.uniform1f(loc.uParam0, u.uParams[0]);
    gl.uniform1f(loc.uParam1, u.uParams[1]);
    gl.uniform1f(loc.uParam2, u.uParams[2]);
    gl.uniform1f(loc.uParam3, u.uParams[3]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.finish(); // ensure the draw completes before the frame screenshot
  });

  return (
    <AbsoluteFill style={{ backgroundColor: t.night }}>
      <canvas ref={ref} width={width} height={height} style={{ width: "100%", height: "100%" }} />
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Mount it in FacelessBackdrop**

In `src/render/native/page/components.tsx`, add the import near the `CanvasBackground` import (line ~14):

```tsx
import { ShaderBackground } from "./ShaderBackground";
```

Update `FacelessBackdrop` (lines ~181-211) to destructure `shaderCode` and branch to the shader before the Canvas2D path:

```tsx
export const FacelessBackdrop: React.FC<{ t: Theme; background: BackgroundProps }> = ({ t, background }) => {
  const { kind, customCode, shaderCode, params, keyframes, triggers, image } = background;
  const draw = React.useMemo<DrawFn | undefined>(() => {
    if (kind === "custom" && customCode) {
      // TRUST BOUNDARY: new Function() executes config-supplied code. This is safe ONLY because the
      // source is trusted local project config that has already passed the sanitize + determinism lint
      // (sanitize: src/render/sanitizeMotion.ts; lint: src/render/motiongraphic.ts). Never feed untrusted/remote input here.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      return new Function("ctx", "env", customCode) as DrawFn;
    }
    return getPreset(kind);
  }, [kind, customCode]);

  if (kind === "image" && image) {
    return (
      <AbsoluteFill>
        <ImageBg src={staticFile(image)} t={t} />
        <Scrim t={t} />
      </AbsoluteFill>
    );
  }
  if (kind === "custom" && shaderCode) {
    return (
      <AbsoluteFill>
        <ShaderBackground shaderSrc={shaderCode} params={params} keyframes={keyframes} triggers={triggers} t={t} />
        <Scrim t={t} />
      </AbsoluteFill>
    );
  }
  if (draw) {
    return (
      <AbsoluteFill>
        <CanvasBackground draw={draw} params={params} keyframes={keyframes} triggers={triggers} t={t} />
        <Scrim t={t} />
      </AbsoluteFill>
    );
  }
  return <GlowBg t={t} />;
};
```

- [ ] **Step 3: Typecheck + bundle**

Run: `npm run build`
Expected: `tsc` passes; `scripts/build-page.mjs` bundles `ShaderBackground` into `dist/render/native/page.bundle.js` (reachable via `components.tsx`). Confirm no esbuild error in output.

- [ ] **Step 4: Commit**

```bash
git add src/render/native/page/ShaderBackground.tsx src/render/native/page/components.tsx
git commit -m "feat(render): WebGL ShaderBackground component + custom-kind mount"
```

---

### Task 5: Reference shader + docs + end-to-end still

Ship the library asset, list it, document the convention, and prove the pipeline rasters a real shader frame.

**Files:**
- Create: `assets-lib/backgrounds/aurora-flow.frag`
- Modify: `src/commands/backgrounds.ts` (help text)
- Modify: `docs/spec-reference.md` (or the background section — grep for `backgroundComponent`)
- Create (throwaway, do not commit): a scratch project spec for the still check

**Interfaces:**
- Consumes: the full pipeline from Tasks 1-4.
- Produces: bare id `aurora-flow` usable as `backgroundComponent`.

- [ ] **Step 1: Write the reference shader**

```glsl
// assets-lib/backgrounds/aurora-flow.frag
// aurora-flow — flowing three-color brand plasma. Author only mainImage(); kino provides the
// uniforms (iResolution, iTime = frame/fps, uColorA/B/C, uIntensity 0..1, uPulse). Deterministic:
// all motion rides iTime, which is frame-derived. Reference asset — copy into a project to tweak.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 p = (fragCoord - 0.5 * iResolution.xy) / iResolution.y; // aspect-correct, centered
  float t = iTime * (0.12 + 0.18 * uIntensity);

  float f = 0.0;
  f += sin(p.x * 3.0 + t);
  f += sin(p.y * 3.5 - t * 1.3);
  f += sin((p.x + p.y) * 2.5 + t * 0.7);
  f += sin(length(p) * 6.0 - t * 1.6);
  float m = 0.5 + 0.125 * f; // ~0..1

  vec3 col = mix(uColorA, uColorB, smoothstep(0.0, 0.6, m));
  col = mix(col, uColorC, smoothstep(0.5, 1.0, m));

  float vig = smoothstep(1.2, 0.2, length(p));
  col *= 0.6 + 0.55 * vig;      // soft edge falloff
  col += uColorC * (0.12 * uPulse); // trigger flash

  fragColor = vec4(col, 1.0);
}
```

- [ ] **Step 2: List + document**

In `src/commands/backgrounds.ts`, extend the custom-library help so shader ids are visible. After the existing library-ids line (grep `listBackgroundIds` / the "Custom library" block near line ~18), the ids already come from `listBackgroundIds()` (now includes `.frag`), so only the prose needs a note. Add one line to the "Spec recipe" block:

```ts
  process.stdout.write('    · shader (.frag): author mainImage(); uniforms iTime/iResolution/uColorA-C/uIntensity/uPulse\n');
```

In the background section of `docs/spec-reference.md` (grep `backgroundComponent`), add a short subsection documenting: `.frag`/`.glsl` files author a ShaderToy `void mainImage(out vec4 fragColor, in vec2 fragCoord)`; the provided uniforms table (iResolution, iTime=frame/fps, iFrame, iTimeDelta, uPulse, uColorA/B/C, uIntensity, uParam0..3); determinism note (iTime is frame-derived; no wall clock); example `{ "background": "custom", "backgroundComponent": "aurora-flow.frag" }`.

- [ ] **Step 3: Rebuild**

Run: `npm run build`
Expected: passes.

- [ ] **Step 4: End-to-end still (manual raster verification)**

Create a scratch project using the shader and render one still. Use an existing demo project as the base — pick one with a faceless/motion beat, set `background:"custom"`, `backgroundComponent:"aurora-flow.frag"` in its spec, or point `kino still` at a minimal spec. Concretely:

```bash
# from repo root, against a scratch spec dir (adjust to the real still CLI shape shown by `kino still --help`)
node bin/kino.mjs still <scratch-project> --at 1.0 --format 9:16 --out /tmp/aurora.png
```

Expected: `/tmp/aurora.png` shows a smooth flowing gradient in the brand colors (mint/green/gold), no solid-black frame, no error. A black frame or a compile error printed to stderr means the shader path is broken — debug before committing.

Verify motion is frame-varying (two different times differ):

```bash
node bin/kino.mjs still <scratch-project> --at 0.0 --out /tmp/a0.png
node bin/kino.mjs still <scratch-project> --at 2.0 --out /tmp/a2.png
# a0.png and a2.png should visibly differ (plasma moved)
```

- [ ] **Step 5: Commit (asset + docs only — not the scratch project)**

```bash
git add assets-lib/backgrounds/aurora-flow.frag src/commands/backgrounds.ts docs/spec-reference.md
git commit -m "feat(bg): aurora-flow reference shader + docs"
```

---

## Self-Review

**Spec coverage:**
- §1 spec seam (reuse custom/backgroundComponent, extension probe, kind by extension) → Tasks 2, 3. ✓
- §2 uniform contract (fixed header, iTime=frame/fps, palette/intensity/pulse/params) → Task 1 (`assembleShaderSource`, `resolveUniforms`), Task 4 (uniform set). ✓
- §3 render component (compile-once, per-frame layout effect, gl.finish, preserveDrawingBuffer, compile-error at frame 0) → Task 4. ✓
- §4 wiring (build reads source→prop, components branch, props field) → Task 3, Task 4 Step 2. ✓
- §5 determinism rules → enforced by design in Tasks 1/4; no denylist needed (noted). ✓
- Validation/lint (compile error surfaced) → Task 4 Step 1. ✓
- Library asset + `kino backgrounds` listing + docs → Task 5. ✓
- Tests (header assembly, env→uniform) → Task 1. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. Task 5 Step 4 CLI flags are marked "adjust to `kino still --help`" because the exact still-command flags aren't in scope of this plan's reads — this is a real command to run, not a placeholder implementation.

**Type consistency:** `shaderCode` used identically in props.ts (Task 3), build.ts object (Task 3), destructure + `<ShaderBackground shaderSrc=…>` (Task 4). `resolveUniforms`/`assembleShaderSource`/`hexToVec3` signatures match between Task 1 definition and Task 4 use. `isShaderPath`/`SHADER_EXTS` match between Task 2 and Task 3. ✓

**Scope:** Single subsystem (one background variant). No decomposition needed.
