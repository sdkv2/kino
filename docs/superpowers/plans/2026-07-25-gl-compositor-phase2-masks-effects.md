# GL Compositor Phase 2 — Masks and Per-Layer Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make masking a property of any layer rather than a property of the region-shader beat kind, and give every layer an effect chain that samples the true composite beneath it.

**Architecture:** `StageRenderer` gains offscreen render targets, so a layer can be rendered to a texture instead of straight to the frame. That single capability unlocks both features: a mask is a texture multiplied into a layer's alpha, and an effect is a fragment pass over a layer's own render target. Mask sources are shapes (analytic SDF), files (the existing mask + SDF frame pipeline), or another layer's alpha/luma.

**Tech Stack:** TypeScript (strict), WebGL2, esbuild, puppeteer, vitest, ImageMagick (`magick`), ffmpeg (existing SDF frame pipeline).

## Global Constraints

- **Blocked on phase 1.** Requires a green parity harness from `docs/superpowers/plans/2026-07-25-gl-compositor-core.md` Task 15. Masks over a compositor that does not yet match the DOM path cannot be validated.
- **No spec document precedes this plan.** Phases 2–4 were deliberately deferred in `docs/superpowers/specs/2026-07-25-gl-compositor-design.md` because their design depends on phase 1's measured costs. Where this plan makes a design choice that a spec would normally settle, it is called out inline as **ASSUMPTION** — revisit each one against phase 1's outcome before building.
- The DOM path stays alive and untouched. `KinoVideo.tsx`, `components.tsx` and `RegionShader.tsx` are read-only; phase 4 deletes them, not this phase.
- `KINO_COMPOSITOR` still defaults to off unless phase 1 Task 16 flipped it. Every task leaves the full suite green either way.
- Blending stays sRGB with premultiplied alpha. Effect passes operate on premultiplied values — un-premultiply before any operation that is not linear in alpha (blur is; saturation is not).
- Everything stays a pure function of the frame index. No wall clock, no `Math.random()` — effect noise derives from the frame.
- Existing region-shader behavior must not regress: `tests/render-region-*.test.ts` and `tests/render-maskdist*.test.ts` stay green throughout.
- Commit messages need a DCO sign-off (`git commit -s`).

## What already exists

Phase 2 is mostly generalization, not invention. Before starting, read these:

| Existing | Where | What phase 2 does with it |
|---|---|---|
| `kinoMaskDist(idx, channel, fragCoord, radius)` | `shaderSource.ts:220` | Currently injected **only** into region programs, with mask count baked into the compiled source. Lift into the compositor's shader library. |
| Exact SDF generation | `sdf.ts` (pure, Felzenszwalb–Huttenlocher) + `sdfFrames.ts` (ffmpeg I/O) | Reuse unchanged for file-backed masks. |
| `SDF_MAX_PX = 128`, 8-bit encode, one object per RGBA channel | `sdf.ts:29` | The encoding contract for every file-backed mask. |
| Mask/SDF slot upload, `uMaskTexN` / `uMaskSdfN` / `uMaskSdfMaxN` | `RegionShader.tsx:342` | The pattern the compositor's mask binding copies. |
| `registerBackdrop(source, w, h)` | `liquidGlass.ts:57` | Replaced by a true-composite feed (Task 9). |
| `MAX_REGION_MASKS` | `shaderSource.ts` | The cap that phase 2's per-layer masks are *not* bound by — one mask per layer, any number of layers. |

## File Structure

| File | Responsibility |
|---|---|
| `src/render/native/page/compositor/targets.ts` | `RenderTarget` — FBO + texture pair, pooled and reused across frames. |
| `src/render/native/page/compositor/masks.ts` | Mask resolution: which texture, which channel, feather from SDF. |
| `src/render/shapes.ts` | Analytic shape SDF math (pure, node-testable). |
| `src/render/native/page/compositor/providers/mask.ts` | File-backed mask source (image/video + its SDF frames). |
| `src/render/native/page/compositor/effects/` | One file per effect pass, plus `chain.ts` that runs them. |
| `src/render/maskSpec.ts` | Spec-level mask/effect types + validation, shared by CLI and page. |

---

### Task 1: Render targets

**Files:**
- Create: `src/render/native/page/compositor/targets.ts`
- Modify: `src/render/native/page/compositor/renderer.ts`
- Test: `tests/compositor-targets.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `class TargetPool` with `acquire(gl, w, h): RenderTarget`, `release(t: RenderTarget): void`, `dispose(gl): void`; `interface RenderTarget { fbo: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }`. Tasks 2–9 all depend on this.

Every later task needs the same thing: render something somewhere other than the screen. Pooling matters because a 1080×1920 RGBA target is 8MB and allocating per layer per frame would thrash.

- [ ] **Step 1: Write the failing test**

Create `tests/compositor-targets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";

const GL_ARGS = ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"];

describe("TargetPool", () => {
  it("reuses a released target instead of allocating a new one", async () => {
    const bundle = await build({
      entryPoints: ["src/render/native/page/compositor/targets.ts"],
      bundle: true, write: false, format: "iife", globalName: "KinoTargets",
      platform: "browser", target: "chrome120", logLevel: "silent",
    });
    const browser = await puppeteer.launch({ headless: true, args: GL_ARGS });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><body><canvas id="c" width="64" height="64"></canvas></body>`);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const result = await page.evaluate(() => {
        const gl = (document.getElementById("c") as HTMLCanvasElement).getContext("webgl2")!;
        const pool = new (window as any).KinoTargets.TargetPool();
        const a = pool.acquire(gl, 64, 64);
        pool.release(a);
        const b = pool.acquire(gl, 64, 64);
        const c = pool.acquire(gl, 64, 64);
        return { reused: a.tex === b.tex, distinct: b.tex !== c.tex, size: [b.w, b.h] };
      });
      expect(result.reused).toBe(true);   // released target came back
      expect(result.distinct).toBe(true); // a second live target is its own allocation
      expect(result.size).toEqual([64, 64]);
    } finally {
      await browser.close();
    }
  }, 120000);

  it("does not hand back a target of the wrong size", async () => {
    const bundle = await build({
      entryPoints: ["src/render/native/page/compositor/targets.ts"],
      bundle: true, write: false, format: "iife", globalName: "KinoTargets",
      platform: "browser", target: "chrome120", logLevel: "silent",
    });
    const browser = await puppeteer.launch({ headless: true, args: GL_ARGS });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><body><canvas id="c" width="64" height="64"></canvas></body>`);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const reused = await page.evaluate(() => {
        const gl = (document.getElementById("c") as HTMLCanvasElement).getContext("webgl2")!;
        const pool = new (window as any).KinoTargets.TargetPool();
        const a = pool.acquire(gl, 64, 64);
        pool.release(a);
        return pool.acquire(gl, 32, 32).tex === a.tex;
      });
      expect(reused).toBe(false);
    } finally {
      await browser.close();
    }
  }, 120000);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/compositor-targets.test.ts
```

Expected: FAIL — cannot resolve `compositor/targets.ts`.

- [ ] **Step 3: Write the pool**

Create `src/render/native/page/compositor/targets.ts`:

```ts
// Offscreen render targets. A layer that carries a mask or an effect chain cannot draw
// straight to the frame — it renders here first, gets operated on, then composites.
//
// Pooled by size: a 1080x1920 RGBA target is ~8MB, and allocating one per layer per frame
// would thrash the driver. Targets are handed out for the duration of one layer's draw and
// returned immediately after.
export interface RenderTarget {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

const key = (w: number, h: number) => `${w}x${h}`;

export class TargetPool {
  private free = new Map<string, RenderTarget[]>();
  private all: RenderTarget[] = [];

  acquire(gl: WebGL2RenderingContext, w: number, h: number): RenderTarget {
    const bucket = this.free.get(key(w, h));
    const reused = bucket?.pop();
    if (reused) return reused;

    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`compositor: render target incomplete (0x${status.toString(16)}) at ${w}x${h}`);
    }

    const target: RenderTarget = { fbo, tex, w, h };
    this.all.push(target);
    return target;
  }

  release(target: RenderTarget): void {
    const k = key(target.w, target.h);
    const bucket = this.free.get(k) ?? [];
    bucket.push(target);
    this.free.set(k, bucket);
  }

  /** Clear a target to fully transparent. Callers rely on this: a reused target still holds
   *  the previous layer's pixels. */
  clear(gl: WebGL2RenderingContext, target: RenderTarget): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.w, target.h);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  dispose(gl: WebGL2RenderingContext): void {
    for (const t of this.all) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    }
    this.all = [];
    this.free.clear();
  }
}
```

- [ ] **Step 4: Give the renderer a pool and an off-screen draw**

In `renderer.ts`, add a pool field and a method that draws one layer into a target rather than the frame. Add to the class:

```ts
  private pool = new TargetPool();

  /** Draw a single layer into an offscreen target, unblended, at frame scale. The caller
   *  owns the target and must release it. */
  drawToTarget(layer: LayerDraw, source: TextureSource, frame: number): RenderTarget | null {
    const gl = this.gl;
    const tex = source.texture(gl, frame, layer.source.key);
    if (!tex) return null;
    const target = this.pool.acquire(gl, this.width, this.height);
    this.pool.clear(gl, target);
    gl.useProgram(this.prog);
    gl.uniform2f(this.uRes, this.width, this.height);
    gl.uniform1i(this.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniformMatrix3fv(this.uModel, false, modelMatrix(layer));
    gl.uniform1f(this.uOpacity, 1); // opacity applies at composite time, not here
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return target;
  }

  releaseTarget(target: RenderTarget): void {
    this.pool.release(target);
  }
```

Import `TargetPool` and `RenderTarget` at the top, and call `this.pool.dispose(this.gl)` from `dispose()`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run tests/compositor-targets.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Confirm nothing regressed**

```bash
npx vitest run tests/compositor-renderer.test.ts tests/render-compositor-parity.test.ts
```

Expected: PASS — adding a pool must not change any composited pixel.

- [ ] **Step 7: Commit**

```bash
git add src/render/native/page/compositor/targets.ts src/render/native/page/compositor/renderer.ts tests/compositor-targets.test.ts
git commit -s -m "feat(compositor): pooled offscreen render targets"
```

---

### Task 2: Shape mask SDF math

**Files:**
- Create: `src/render/shapes.ts`
- Test: `tests/shapes.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type ShapeKind = "rect" | "circle" | "ellipse"`; `interface ShapeMask { kind: ShapeKind; x: number; y: number; w: number; h: number; radius?: number; rotate?: number }`; `shapeDistance(shape: ShapeMask, px: number, py: number): number` — signed distance in px, negative inside. The GLSL port in Task 4 must agree with this function, and the test proves it.

Shape masks need no file, no SDF pass and no upload — the distance is analytic. This is the cheapest mask source and the one most specs will reach for.

- [ ] **Step 1: Write the failing test**

Create `tests/shapes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shapeDistance, type ShapeMask } from "../src/render/shapes.js";

const rect: ShapeMask = { kind: "rect", x: 100, y: 100, w: 200, h: 100 };
const rounded: ShapeMask = { ...rect, radius: 20 };
const circle: ShapeMask = { kind: "circle", x: 100, y: 100, w: 200, h: 200 };

describe("shapeDistance — rect", () => {
  it("is negative at the center", () => {
    expect(shapeDistance(rect, 200, 150)).toBeLessThan(0);
  });

  it("is zero on the edge", () => {
    expect(shapeDistance(rect, 100, 150)).toBeCloseTo(0, 5);
  });

  it("equals the perpendicular gap outside an edge", () => {
    expect(shapeDistance(rect, 70, 150)).toBeCloseTo(30, 5);
  });

  it("equals the diagonal gap outside a corner", () => {
    // 30 left and 40 above the top-left corner → 50 by Pythagoras.
    expect(shapeDistance(rect, 70, 60)).toBeCloseTo(50, 5);
  });

  it("rounds the corner when radius is set", () => {
    // A rounded corner pushes the boundary inward, so the same point is closer to it.
    expect(shapeDistance(rounded, 70, 60)).toBeLessThan(shapeDistance(rect, 70, 60));
  });
});

describe("shapeDistance — circle", () => {
  it("is -r at the center", () => {
    expect(shapeDistance(circle, 200, 200)).toBeCloseTo(-100, 5);
  });

  it("is zero on the rim", () => {
    expect(shapeDistance(circle, 300, 200)).toBeCloseTo(0, 5);
  });

  it("is the radial gap outside", () => {
    expect(shapeDistance(circle, 350, 200)).toBeCloseTo(50, 5);
  });
});

describe("shapeDistance — ellipse", () => {
  it("is zero on both axes' extremes", () => {
    const e: ShapeMask = { kind: "ellipse", x: 0, y: 0, w: 200, h: 100 };
    expect(shapeDistance(e, 200, 50)).toBeCloseTo(0, 1);
    expect(shapeDistance(e, 100, 100)).toBeCloseTo(0, 1);
  });
});

describe("shapeDistance — rotation", () => {
  it("rotates the shape, not the sample point's frame", () => {
    const r: ShapeMask = { kind: "rect", x: 100, y: 150, w: 200, h: 20, rotate: 90 };
    // Rotated 90°, the thin bar runs vertically through the center.
    expect(shapeDistance(r, 200, 160)).toBeLessThan(0);
    expect(shapeDistance(r, 260, 160)).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/shapes.test.ts
```

Expected: FAIL — cannot resolve `src/render/shapes.js`.

- [ ] **Step 3: Write the math**

Create `src/render/shapes.ts`:

```ts
// Analytic signed distance for shape masks. Negative inside, zero on the boundary, positive
// outside, in frame pixels.
//
// This is the reference implementation. The GLSL in masks.ts is a port of it, and
// tests/compositor-shape-mask.test.ts asserts the two agree — a divergence would show up as a
// mask whose feather does not match its authored radius.
export type ShapeKind = "rect" | "circle" | "ellipse";

export interface ShapeMask {
  kind: ShapeKind;
  /** Top-left of the shape's bounding box, in frame px. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corner radius for "rect", in px. Ignored by circle/ellipse. */
  radius?: number;
  /** Degrees, about the shape's own center. */
  rotate?: number;
}

/** Rotate (px,py) into the shape's local frame, centered on the shape. */
function toLocal(shape: ShapeMask, px: number, py: number): [number, number] {
  const cx = shape.x + shape.w / 2;
  const cy = shape.y + shape.h / 2;
  const dx = px - cx;
  const dy = py - cy;
  const deg = shape.rotate ?? 0;
  if (!deg) return [dx, dy];
  const rad = (-deg * Math.PI) / 180; // inverse rotation: shape rotates, sample does not
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [dx * cos - dy * sin, dx * sin + dy * cos];
}

/** Inigo Quilez's rounded-box SDF. */
function roundedBox(px: number, py: number, hw: number, hh: number, r: number): number {
  const rr = Math.min(r, Math.min(hw, hh));
  const qx = Math.abs(px) - hw + rr;
  const qy = Math.abs(py) - hh + rr;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - rr;
}

export function shapeDistance(shape: ShapeMask, px: number, py: number): number {
  const [lx, ly] = toLocal(shape, px, py);
  const hw = shape.w / 2;
  const hh = shape.h / 2;

  if (shape.kind === "rect") return roundedBox(lx, ly, hw, hh, shape.radius ?? 0);
  if (shape.kind === "circle") return Math.hypot(lx, ly) - Math.min(hw, hh);

  // Ellipse: no closed form. One Newton step on the scaled-circle approximation, which is
  // exact on the axes and within a fraction of a pixel elsewhere — well inside what an 8-bit
  // feather resolves.
  const k1 = Math.hypot(lx / hw, ly / hh);
  if (k1 === 0) return -Math.min(hw, hh);
  const k2 = Math.hypot(lx / (hw * hw), ly / (hh * hh));
  return (k1 * (k1 - 1)) / k2;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/shapes.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render/shapes.ts tests/shapes.test.ts
git commit -s -m "feat(masks): analytic signed distance for shape masks"
```

---

### Task 3: Mask spec types and validation

**Files:**
- Create: `src/render/maskSpec.ts`
- Test: `tests/mask-spec.test.ts`

**Interfaces:**
- Consumes: `ShapeMask` from `./shapes.js`.
- Produces: `type MaskSource`, `interface LayerMask`, `validateMask(m: unknown): string[]` (returns error strings, empty when valid), `resolveMaskDefaults(m: LayerMask): Required<...>`. `graph.ts`'s `MaskRef` is widened to match, and the CLI's spec validation calls `validateMask`.

**ASSUMPTION** — this fixes the authoring surface before phase 3 exists. If phase 3's transitions need mask features this shape cannot express (animated mask keyframes, multiple masks per layer), that is a breaking change to a shipped spec field. The mitigation baked in below: `masks` is an **array** from day one even though phase 2 only honors the first entry, so growing to N masks later is additive.

- [ ] **Step 1: Write the failing test**

Create `tests/mask-spec.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateMask, resolveMaskDefaults, type LayerMask } from "../src/render/maskSpec.js";

const shape: LayerMask = { source: { kind: "shape", shape: { kind: "rect", x: 0, y: 0, w: 100, h: 100 } } };

describe("validateMask", () => {
  it("accepts a shape mask", () => {
    expect(validateMask(shape)).toEqual([]);
  });

  it("accepts a file mask with a channel", () => {
    expect(validateMask({ source: { kind: "file", src: "mask.png", channel: "r" } })).toEqual([]);
  });

  it("accepts a layer mask referencing another layer id", () => {
    expect(validateMask({ source: { kind: "layer", layerId: "motion0", channel: "luma" } })).toEqual([]);
  });

  it("rejects an unknown source kind", () => {
    expect(validateMask({ source: { kind: "vibes" } })[0]).toMatch(/unknown mask source/i);
  });

  it("rejects a file mask with no src", () => {
    expect(validateMask({ source: { kind: "file", channel: "r" } })[0]).toMatch(/src/i);
  });

  it("rejects a negative feather", () => {
    expect(validateMask({ ...shape, feather: -4 })[0]).toMatch(/feather/i);
  });

  it("rejects a feather beyond the SDF encode range", () => {
    // SDF_MAX_PX is 128; asking for more feather than the field encodes would clip silently.
    expect(validateMask({ ...shape, feather: 400 })[0]).toMatch(/128/);
  });
});

describe("resolveMaskDefaults", () => {
  it("defaults feather to 0, invert to false, and expand to 0", () => {
    const r = resolveMaskDefaults(shape);
    expect(r.feather).toBe(0);
    expect(r.invert).toBe(false);
    expect(r.expand).toBe(0);
  });

  it("preserves explicit values", () => {
    const r = resolveMaskDefaults({ ...shape, feather: 12, invert: true, expand: -6 });
    expect([r.feather, r.invert, r.expand]).toEqual([12, true, -6]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/mask-spec.test.ts
```

Expected: FAIL — cannot resolve `src/render/maskSpec.js`.

- [ ] **Step 3: Write the types and validation**

Create `src/render/maskSpec.ts`:

```ts
// Spec-level mask types. Shared by the CLI (validation at build time) and the render page
// (resolution at draw time), so an invalid mask fails with a message instead of rendering
// a silently empty layer.
import { SDF_MAX_PX } from "./sdf.js";
import type { ShapeMask } from "./shapes.js";

export type MaskChannel = "r" | "g" | "b" | "a" | "luma";

export type MaskSource =
  /** Analytic shape — no file, no upload, exact distance. */
  | { kind: "shape"; shape: ShapeMask }
  /** A mask image or video under /public, with its SDF frames generated node-side. */
  | { kind: "file"; src: string; channel: MaskChannel }
  /** Another layer's own alpha or luma, rendered to a target and sampled. */
  | { kind: "layer"; layerId: string; channel: MaskChannel };

export interface LayerMask {
  source: MaskSource;
  /** Soften the boundary over this many px. Resolved from the SDF, so it is a true distance,
   *  not a blur of the coverage. */
  feather?: number;
  /** Grow (positive) or shrink (negative) the masked region, in px. */
  expand?: number;
  /** Swap kept and cut regions. */
  invert?: boolean;
}

const CHANNELS: MaskChannel[] = ["r", "g", "b", "a", "luma"];

export function validateMask(m: unknown): string[] {
  const errs: string[] = [];
  if (!m || typeof m !== "object") return ["mask must be an object"];
  const mask = m as Partial<LayerMask>;
  const src = mask.source as Partial<MaskSource> | undefined;

  if (!src || typeof src !== "object") {
    errs.push("mask.source is required");
  } else if (src.kind === "shape") {
    if (!("shape" in src) || !src.shape) errs.push("mask.source.shape is required for kind 'shape'");
  } else if (src.kind === "file") {
    if (!("src" in src) || !src.src) errs.push("mask.source.src is required for kind 'file'");
    if ("channel" in src && src.channel && !CHANNELS.includes(src.channel)) {
      errs.push(`mask.source.channel must be one of ${CHANNELS.join(", ")}`);
    }
  } else if (src.kind === "layer") {
    if (!("layerId" in src) || !src.layerId) errs.push("mask.source.layerId is required for kind 'layer'");
  } else {
    errs.push(`unknown mask source kind: ${String((src as { kind?: unknown }).kind)}`);
  }

  const { feather, expand } = mask;
  if (feather !== undefined) {
    if (typeof feather !== "number" || feather < 0) errs.push("mask.feather must be a number >= 0");
    // Feather is resolved from the encoded distance field, which saturates at SDF_MAX_PX.
    // Asking beyond that would clip with no warning.
    else if (feather > SDF_MAX_PX) errs.push(`mask.feather must be <= ${SDF_MAX_PX} (the SDF encode range)`);
  }
  if (expand !== undefined) {
    if (typeof expand !== "number") errs.push("mask.expand must be a number");
    else if (Math.abs(expand) > SDF_MAX_PX) errs.push(`mask.expand must be within ±${SDF_MAX_PX} (the SDF encode range)`);
  }
  return errs;
}

export interface ResolvedMask {
  source: MaskSource;
  feather: number;
  expand: number;
  invert: boolean;
}

export function resolveMaskDefaults(m: LayerMask): ResolvedMask {
  return {
    source: m.source,
    feather: m.feather ?? 0,
    expand: m.expand ?? 0,
    invert: m.invert ?? false,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/mask-spec.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render/maskSpec.ts tests/mask-spec.test.ts
git commit -s -m "feat(masks): spec-level mask types and validation"
```

---

### Task 4: Mask application in the compositor

**Files:**
- Create: `src/render/native/page/compositor/masks.ts`
- Modify: `src/render/native/page/compositor/renderer.ts`
- Test: `tests/compositor-shape-mask.test.ts`

**Interfaces:**
- Consumes: `TargetPool` (Task 1), `ShapeMask`/`shapeDistance` (Task 2), `ResolvedMask` (Task 3).
- Produces: `MASK_GLSL` (shader library string), `applyMask(gl, target, mask, resolved, frame): RenderTarget` — takes a layer's rendered target and returns a masked one.

The GLSL here is a port of `shapeDistance`, and the test asserts the two agree numerically. A silent divergence between the JS reference and the GPU implementation is the failure mode this task is designed to prevent.

- [ ] **Step 1: Write the failing test**

Create `tests/compositor-shape-mask.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import { shapeDistance, type ShapeMask } from "../src/render/shapes.js";

const GL_ARGS = ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"];

// Sample points chosen to hit every branch: inside, on-edge, off-edge, off-corner, rotated.
const SAMPLES: Array<[ShapeMask, number, number]> = [
  [{ kind: "rect", x: 100, y: 100, w: 200, h: 100 }, 200, 150],
  [{ kind: "rect", x: 100, y: 100, w: 200, h: 100 }, 70, 60],
  [{ kind: "rect", x: 100, y: 100, w: 200, h: 100, radius: 20 }, 105, 105],
  [{ kind: "circle", x: 100, y: 100, w: 200, h: 200 }, 350, 200],
  [{ kind: "rect", x: 100, y: 150, w: 200, h: 20, rotate: 90 }, 200, 200],
];

describe("mask GLSL matches the JS reference", () => {
  it("agrees within a pixel at every sample", async () => {
    const bundle = await build({
      entryPoints: ["src/render/native/page/compositor/masks.ts"],
      bundle: true, write: false, format: "iife", globalName: "KinoMasks",
      platform: "browser", target: "chrome120", logLevel: "silent",
    });
    const browser = await puppeteer.launch({ headless: true, args: GL_ARGS });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><body><canvas id="c" width="512" height="512"></canvas></body>`);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });

      // Encode the GPU's distance into the red channel over a known range so it reads back.
      const gpu = await page.evaluate((samples) => {
        return (window as any).KinoMasks.probeShapeDistance(
          document.getElementById("c") as HTMLCanvasElement,
          samples,
        );
      }, SAMPLES);

      SAMPLES.forEach(([shape, px, py], i) => {
        expect(Math.abs(gpu[i] - shapeDistance(shape, px, py))).toBeLessThan(1);
      });
    } finally {
      await browser.close();
    }
  }, 120000);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/compositor-shape-mask.test.ts
```

Expected: FAIL — cannot resolve `compositor/masks.ts`.

- [ ] **Step 3: Write the mask module**

Create `src/render/native/page/compositor/masks.ts`:

```ts
// Mask application. A masked layer is rendered to a target (Task 1), then this pass rewrites
// its alpha from a mask source before it composites.
//
// The shape SDF below is a port of src/render/shapes.ts. tests/compositor-shape-mask.test.ts
// asserts the two agree — keep them in step, or authored feather radii stop meaning px.
import type { ShapeMask } from "../../shapes.js";
import type { ResolvedMask } from "../../maskSpec.js";
import type { RenderTarget, TargetPool } from "./targets.js";

export const MASK_GLSL = `
// Rounded box (Inigo Quilez). Ported from shapes.ts roundedBox().
float kinoRoundedBox(vec2 p, vec2 half_, float r) {
  float rr = min(r, min(half_.x, half_.y));
  vec2 q = abs(p) - half_ + rr;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rr;
}

// Signed distance to the shape, in px. kind: 0 = rect, 1 = circle, 2 = ellipse.
float kinoShapeDist(vec2 frag, int kind, vec2 center, vec2 half_, float radius, float rotDeg) {
  vec2 d = frag - center;
  if (rotDeg != 0.0) {
    float a = radians(-rotDeg);
    float c = cos(a), s = sin(a);
    d = vec2(d.x * c - d.y * s, d.x * s + d.y * c);
  }
  if (kind == 0) return kinoRoundedBox(d, half_, radius);
  if (kind == 1) return length(d) - min(half_.x, half_.y);
  float k1 = length(d / half_);
  if (k1 == 0.0) return -min(half_.x, half_.y);
  float k2 = length(d / (half_ * half_));
  return k1 * (k1 - 1.0) / k2;
}
`;

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSrc;      // the layer, already rendered
uniform sampler2D uMask;     // file/layer mask coverage (unused when uSourceKind == 0)
uniform sampler2D uMaskSdf;  // distance field for the mask, when one exists
uniform float uMaskSdfMax;   // 0 = no field this frame
uniform vec2 uRes;
uniform int uSourceKind;     // 0 = shape, 1 = file/layer texture
uniform int uChannel;        // 0..3 = rgba, 4 = luma
uniform float uFeather;
uniform float uExpand;
uniform float uInvert;
// shape params
uniform int uShapeKind;
uniform vec2 uShapeCenter;
uniform vec2 uShapeHalf;
uniform float uShapeRadius;
uniform float uShapeRot;
out vec4 kino_frag;

${MASK_GLSL}

float channelOf(vec4 c) {
  if (uChannel == 0) return c.r;
  if (uChannel == 1) return c.g;
  if (uChannel == 2) return c.b;
  if (uChannel == 3) return c.a;
  return dot(c.rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 src = texture(uSrc, uv);

  float coverage;
  if (uSourceKind == 0) {
    // Analytic: distance is exact, so feather is a true px band.
    float d = kinoShapeDist(gl_FragCoord.xy, uShapeKind, uShapeCenter, uShapeHalf, uShapeRadius, uShapeRot) - uExpand;
    coverage = uFeather > 0.0 ? 1.0 - smoothstep(-uFeather * 0.5, uFeather * 0.5, d)
                              : 1.0 - step(0.0, d);
  } else if (uMaskSdfMax > 0.0) {
    // A real distance field: decode, then feather in px exactly as the shape branch does.
    float d = (texture(uMaskSdf, uv).r * 2.0 - 1.0) * uMaskSdfMax - uExpand;
    coverage = uFeather > 0.0 ? 1.0 - smoothstep(-uFeather * 0.5, uFeather * 0.5, d)
                              : 1.0 - step(0.0, d);
  } else {
    // No field — fall back to raw coverage. Feather degrades to a coverage ramp, which is
    // softer than a true px band but never wrong-looking.
    float c = channelOf(texture(uMask, uv));
    coverage = uFeather > 0.0 ? smoothstep(0.5 - uFeather / 255.0, 0.5 + uFeather / 255.0, c) : step(0.5, c);
  }

  if (uInvert > 0.5) coverage = 1.0 - coverage;
  // src is premultiplied, so scaling the whole texel scales colour and alpha together.
  kino_frag = src * coverage;
}`;

export interface MaskBinding {
  /** Coverage texture for file/layer masks; null for shape masks. */
  mask: WebGLTexture | null;
  /** Distance field for the mask, when one was written for this frame. */
  sdf: WebGLTexture | null;
  /** Encode half-range in px, or 0 when there is no field this frame. */
  sdfMax: number;
}

const CHANNEL_INDEX: Record<string, number> = { r: 0, g: 1, b: 2, a: 3, luma: 4 };

let program: { gl: WebGL2RenderingContext; prog: WebGLProgram; loc: Record<string, WebGLUniformLocation | null> } | null = null;

function ensureProgram(gl: WebGL2RenderingContext) {
  if (program && program.gl === gl) return program;
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(`mask shader failed to compile: ${gl.getShaderInfoLog(s)}`);
    }
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`mask program failed to link: ${gl.getProgramInfoLog(prog)}`);
  }
  const names = ["uSrc", "uMask", "uMaskSdf", "uMaskSdfMax", "uRes", "uSourceKind", "uChannel",
    "uFeather", "uExpand", "uInvert", "uShapeKind", "uShapeCenter", "uShapeHalf", "uShapeRadius", "uShapeRot"];
  const loc: Record<string, WebGLUniformLocation | null> = {};
  for (const n of names) loc[n] = gl.getUniformLocation(prog, n);
  program = { gl, prog, loc };
  return program;
}

const SHAPE_KIND: Record<string, number> = { rect: 0, circle: 1, ellipse: 2 };

/** Mask `src` into a fresh target. The caller releases both. */
export function applyMask(
  gl: WebGL2RenderingContext,
  pool: TargetPool,
  src: RenderTarget,
  mask: ResolvedMask,
  binding: MaskBinding,
): RenderTarget {
  const { prog, loc } = ensureProgram(gl);
  const out = pool.acquire(gl, src.w, src.h);
  pool.clear(gl, out);

  gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
  gl.viewport(0, 0, out.w, out.h);
  gl.disable(gl.BLEND);
  gl.useProgram(prog);
  gl.uniform2f(loc.uRes, out.w, out.h);
  gl.uniform1f(loc.uFeather, mask.feather);
  gl.uniform1f(loc.uExpand, mask.expand);
  gl.uniform1f(loc.uInvert, mask.invert ? 1 : 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, src.tex);
  gl.uniform1i(loc.uSrc, 0);

  if (mask.source.kind === "shape") {
    const s: ShapeMask = mask.source.shape;
    gl.uniform1i(loc.uSourceKind, 0);
    gl.uniform1i(loc.uShapeKind, SHAPE_KIND[s.kind] ?? 0);
    gl.uniform2f(loc.uShapeCenter, s.x + s.w / 2, s.y + s.h / 2);
    gl.uniform2f(loc.uShapeHalf, s.w / 2, s.h / 2);
    gl.uniform1f(loc.uShapeRadius, s.radius ?? 0);
    gl.uniform1f(loc.uShapeRot, s.rotate ?? 0);
    gl.uniform1f(loc.uMaskSdfMax, 0);
  } else {
    gl.uniform1i(loc.uSourceKind, 1);
    gl.uniform1i(loc.uChannel, CHANNEL_INDEX[mask.source.channel] ?? 4);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, binding.mask);
    gl.uniform1i(loc.uMask, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, binding.sdf);
    gl.uniform1i(loc.uMaskSdf, 2);
    gl.uniform1f(loc.uMaskSdfMax, binding.sdfMax);
  }

  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return out;
}

/** Test hook: render the shape SDF for a list of sample points and read the values back, so
 *  the GLSL can be compared against shapes.ts numerically. */
export function probeShapeDistance(
  canvas: HTMLCanvasElement,
  samples: Array<[ShapeMask, number, number]>,
): number[] {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const out: number[] = [];
  const PROBE_FRAG = `#version 300 es
precision highp float;
uniform int uShapeKind; uniform vec2 uShapeCenter; uniform vec2 uShapeHalf;
uniform float uShapeRadius; uniform float uShapeRot; uniform vec2 uSample;
out vec4 kino_frag;
${MASK_GLSL}
void main() {
  float d = kinoShapeDist(uSample, uShapeKind, uShapeCenter, uShapeHalf, uShapeRadius, uShapeRot);
  // Encode ±512px into 0..1 so an 8-bit read-back still resolves under a pixel.
  kino_frag = vec4((d / 1024.0) + 0.5, 0.0, 0.0, 1.0);
}`;
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, PROBE_FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const px = new Uint8Array(4);
  for (const [shape, sx, sy] of samples) {
    gl.uniform1i(gl.getUniformLocation(prog, "uShapeKind"), SHAPE_KIND[shape.kind] ?? 0);
    gl.uniform2f(gl.getUniformLocation(prog, "uShapeCenter"), shape.x + shape.w / 2, shape.y + shape.h / 2);
    gl.uniform2f(gl.getUniformLocation(prog, "uShapeHalf"), shape.w / 2, shape.h / 2);
    gl.uniform1f(gl.getUniformLocation(prog, "uShapeRadius"), shape.radius ?? 0);
    gl.uniform1f(gl.getUniformLocation(prog, "uShapeRot"), shape.rotate ?? 0);
    gl.uniform2f(gl.getUniformLocation(prog, "uSample"), sx, sy);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    out.push((px[0] / 255 - 0.5) * 1024);
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/compositor-shape-mask.test.ts
```

Expected: PASS. A failure here means the GLSL and `shapes.ts` have diverged — fix the GLSL, not the test.

- [ ] **Step 5: Wire masking into the renderer's draw loop**

In `renderer.ts`'s `draw`, replace the direct texture bind for masked layers:

```ts
      if (layer.mask) {
        const rendered = this.drawToTarget(layer, source, frame);
        if (!rendered) continue;
        const masked = applyMask(gl, this.pool, rendered, resolveMaskDefaults(layer.mask), bindingFor(layer.mask, frame));
        this.pool.release(rendered);
        // Composite the masked target as an ordinary quad covering the full frame.
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.width, this.height);
        gl.useProgram(this.prog);
        applyBlend(gl, layer.blend);
        gl.bindTexture(gl.TEXTURE_2D, masked.tex);
        gl.uniformMatrix3fv(this.uModel, false, modelMatrix({ ...layer, rect: { x: 0, y: 0, w: this.width, h: this.height }, transform: IDENTITY_TRANSFORM }));
        gl.uniform1f(this.uOpacity, layer.opacity);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        this.pool.release(masked);
        continue;
      }
```

Note the model matrix: the layer's own transform was already applied when it rendered to the target, so compositing the target uses identity. Applying the transform twice is the mistake this comment exists to prevent.

`bindingFor` is supplied by the registry — shape masks return `{mask: null, sdf: null, sdfMax: 0}`; file and layer masks return real textures (Tasks 5 and 6).

- [ ] **Step 6: Run parity to confirm unmasked layers are untouched**

```bash
npm run build && npx vitest run tests/render-compositor-parity.test.ts
```

Expected: PASS — no spec uses masks yet, so every row must be byte-for-byte what it was.

- [ ] **Step 7: Commit**

```bash
git add src/render/native/page/compositor/masks.ts src/render/native/page/compositor/renderer.ts tests/compositor-shape-mask.test.ts
git commit -s -m "feat(masks): shape masks with true-distance feather in the compositor"
```

---

### Task 5: File-backed masks

**Files:**
- Create: `src/render/native/page/compositor/providers/mask.ts`
- Modify: `src/render/native/videoFrames.ts` (extend `planMediaJobs` to plan layer-mask media)
- Test: `tests/compositor-mask-media.test.ts`

**Interfaces:**
- Consumes: `MediaEntry`, `useSdfImageUrl`'s lookup shape from `media.ts`; `createFramesSource` from `providers/frames.js`.
- Produces: `createMaskSource(entry: MediaEntry, fromFrame: number): TextureSource & { sdfTexture(gl, frame): WebGLTexture | null; sdfMax(frame): number }`; `planMaskJobs(props, fps): MediaJob[]`.

The node side already extracts mask frames and writes SDF frames beside them (`videoFrames.ts` + `sdfFrames.ts`), keyed `rsmask<i>_<j>` for region shaders. This task adds the same planning for layer masks, keyed `lmask<layerId>`.

- [ ] **Step 1: Write the failing test**

Create `tests/compositor-mask-media.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planMaskJobs } from "../src/render/native/videoFrames.js";
import type { KinoProps, KinoSegment } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
};
const bg = { kind: "glow" as const, image: null, customCode: null, shaderCode: null, params: {}, keyframes: [], triggers: [] };

const withMask = (mask: unknown): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: bg, disclosure: "",
  segments: [{ kind: "video", caption: "", startSec: 0, endSec: 2, source: "clip.mp4", mask } as unknown as KinoSegment],
});

describe("planMaskJobs", () => {
  it("plans a media job for a video mask", () => {
    const jobs = planMaskJobs(withMask({ source: { kind: "file", src: "m.mp4", channel: "r" } }), 30);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].key).toMatch(/^lmask/);
    expect(jobs[0].assetRel).toBe("m.mp4");
  });

  it("plans nothing for a shape mask — no file to extract", () => {
    expect(planMaskJobs(withMask({ source: { kind: "shape", shape: { kind: "rect", x: 0, y: 0, w: 10, h: 10 } } }), 30)).toEqual([]);
  });

  it("plans nothing for a layer mask — the source is another layer, not a file", () => {
    expect(planMaskJobs(withMask({ source: { kind: "layer", layerId: "motion0", channel: "luma" } }), 30)).toEqual([]);
  });

  it("spans the masked beat's frames", () => {
    const jobs = planMaskJobs(withMask({ source: { kind: "file", src: "m.mp4", channel: "r" } }), 30);
    expect(jobs[0].fromFrame).toBe(0);
    expect(jobs[0].seqDurFrames).toBe(60);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/compositor-mask-media.test.ts
```

Expected: FAIL — `planMaskJobs` is not exported.

- [ ] **Step 3: Add mask job planning**

In `src/render/native/videoFrames.ts`, add alongside `planMediaJobs`:

```ts
/** Media jobs for layer masks that are files. Shape and layer masks need no extraction.
 *  Keyed `lmask<segmentIndex>` so it cannot collide with the region-shader `rsmask<i>_<j>`
 *  namespace. SDF frames are written beside the mask frames by the same path region-shader
 *  masks already use. */
export function planMaskJobs(props: KinoProps, fps: number): MediaJob[] {
  const f = (sec: number) => Math.round(sec * fps);
  const jobs: MediaJob[] = [];
  props.segments.forEach((s, i) => {
    const mask = (s as { mask?: { source?: { kind?: string; src?: string } } }).mask;
    if (mask?.source?.kind !== "file" || !mask.source.src) return;
    jobs.push({
      key: `lmask${i}`,
      assetRel: mask.source.src,
      fromFrame: f(s.startSec),
      seqDurFrames: Math.max(1, f(s.endSec) - f(s.startSec)),
      isMask: true,
    });
  });
  return jobs;
}
```

Match `MediaJob`'s real field names — read the interface at `videoFrames.ts:20` and use whatever it actually declares for the mask flag that triggers SDF generation. If no such flag exists, follow how `rsmask` jobs signal it and copy that.

Then call `planMaskJobs` wherever `planMediaJobs` is consumed in `engine.ts`, concatenating the results.

- [ ] **Step 4: Write the mask provider**

Create `src/render/native/page/compositor/providers/mask.ts`:

```ts
// A file-backed mask: coverage frames plus the exact distance field written beside them.
// Both are ordinary /vframes stills, so this is the frames provider with a second channel.
import type { MediaEntry } from "../../media.js";
import { SDF_MAX_PX } from "../../../sdf.js";
import { loadImage, uploadCanvasOrImage } from "./upload.js";

export interface MaskSourceHandle {
  prepare(frame: number): Promise<void>;
  coverage(gl: WebGL2RenderingContext, frame: number): WebGLTexture | null;
  sdf(gl: WebGL2RenderingContext, frame: number): WebGLTexture | null;
  /** 0 means no field for this frame — the mask shader falls back to raw coverage. */
  sdfMax(frame: number): number;
}

export function createMaskSource(entry: MediaEntry, fromFrame: number): MaskSourceHandle {
  const images = new Map<string, HTMLImageElement>();
  let covTex: WebGLTexture | null = null;
  let sdfTex: WebGLTexture | null = null;

  const urlFor = (frame: number, kind: "cov" | "sdf"): string | null => {
    const idx = Math.min(Math.max(0, frame - fromFrame), entry.maxFrame);
    const file = kind === "cov" ? entry.byFrame[idx] : entry.sdfByFrame?.[idx];
    return file ? `/vframes/${entry.dir}/${file}` : null;
  };

  return {
    async prepare(frame: number): Promise<void> {
      await Promise.all(
        (["cov", "sdf"] as const).map(async (kind) => {
          const url = urlFor(frame, kind);
          if (!url || images.has(url)) return;
          const img = await loadImage(url);
          if (img) images.set(url, img);
        }),
      );
    },
    coverage(gl, frame) {
      const url = urlFor(frame, "cov");
      const img = url ? images.get(url) : undefined;
      if (!img) return null;
      covTex = uploadCanvasOrImage(gl, covTex, img);
      return covTex;
    },
    sdf(gl, frame) {
      const url = urlFor(frame, "sdf");
      const img = url ? images.get(url) : undefined;
      if (!img) return null;
      sdfTex = uploadCanvasOrImage(gl, sdfTex, img);
      return sdfTex;
    },
    sdfMax(frame) {
      // Mirrors RegionShader: 0 signals "no field this frame", which the mask shader reads
      // as its cue to fall back to raw coverage rather than decoding garbage.
      return urlFor(frame, "sdf") ? SDF_MAX_PX : 0;
    },
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run tests/compositor-mask-media.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/render/native/page/compositor/providers/mask.ts src/render/native/videoFrames.ts tests/compositor-mask-media.test.ts
git commit -s -m "feat(masks): file-backed masks with exact distance fields"
```

---

### Task 6: Layer-as-mask

**Files:**
- Modify: `src/render/native/page/compositor/renderer.ts`
- Modify: `src/render/layers.ts`
- Test: `tests/compositor-layer-mask.test.ts`

**Interfaces:**
- Consumes: `TargetPool`, `applyMask`.
- Produces: renderer support for `{ kind: "layer", layerId }` masks — the named layer is rendered to a target and used as coverage.

This is the capability the spec named as the point of the whole exercise: masking one layer against another. A caption cut out of footage, a motion graphic clipped to a subject's silhouette.

- [ ] **Step 1: Write the failing test**

Create `tests/compositor-layer-mask.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#000000", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0,
};
// Solid white background so a masked white layer is measurable purely by coverage.
const white = { kind: "custom" as const, image: null, shaderCode: null,
  customCode: "ctx.fillStyle='#ffffff';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);",
  params: {}, keyframes: [], triggers: [] };

// A motion graphic covering the left half — used as the mask.
const halfMotion = {
  html: `<style>.h{position:absolute;left:0;top:0;width:50%;height:100%;background:#fff}</style><div class="h"></div>`,
  params: {}, keyframes: [], triggers: [],
};

const props = (mask: unknown): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: white, disclosure: "",
  segments: [{ kind: "motion", caption: "", startSec: 0, endSec: 2, motion: halfMotion, mask } as never],
});

const meanOf = (png: string) => parseFloat(magick([png, "-format", "%[fx:mean]", "info:"]).trim());

describe("layer-as-mask", () => {
  it("clips a layer to another layer's coverage", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      const outDir = mkdtempSync(join(tmpdir(), "kino-lmask-"));
      const [png] = await renderStills({
        props: props({ source: { kind: "shape", shape: { kind: "rect", x: 0, y: 0, w: 540, h: 1920 } } }),
        publicDir: mkdtempSync(join(tmpdir(), "lmask-pub-")),
        format: "9:16", frames: [{ frame: 10, name: "masked" }], outDir,
      });
      // Background is white everywhere, so the frame mean stays high; the assertion that
      // matters is that the masked half differs from the unmasked half.
      const left = parseFloat(magick([png, "-crop", "540x1920+0+0", "-format", "%[fx:mean]", "info:"]).trim());
      const right = parseFloat(magick([png, "-crop", "540x1920+540+0", "-format", "%[fx:mean]", "info:"]).trim());
      expect(Math.abs(left - right)).toBeGreaterThan(0.01);
      expect(meanOf(png)).toBeGreaterThan(0);
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 300000);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run build && npx vitest run tests/compositor-layer-mask.test.ts
```

Expected: FAIL — `mask` on a segment is not read, so both halves are identical.

- [ ] **Step 3: Emit the mask on the layer**

In `src/render/layers.ts`, thread each beat's `mask` onto the layers it produces. For a motion beat:

```ts
    out.push({
      id: `motion${i}`,
      source: { providerId: `motion${i}`, key: String(local) },
      rect: full,
      opacity,
      mask: s.mask,
    });
```

Do the same for `seg${i}`, `overlay${i}` and `caption${i}`. `LayerDraw.mask` is widened from the phase-1 `MaskRef` placeholder to `LayerMask` from `maskSpec.ts`.

- [ ] **Step 4: Resolve layer masks in the renderer**

A `{kind: "layer"}` mask needs the referenced layer's pixels. Before the main loop in `draw`, render every layer that is referenced as a mask into a target and index it:

```ts
    // Layers referenced as masks are rendered first, into their own targets. A layer may be
    // both drawn and used as a mask; it is rendered twice, which is correct — the mask copy
    // is unblended and untransformed by the consumer's opacity.
    const maskTargets = new Map<string, RenderTarget>();
    for (const layer of layers) {
      const ref = layer.mask?.source;
      if (ref?.kind !== "layer" || maskTargets.has(ref.layerId)) continue;
      const maskLayer = layers.find((l) => l.id === ref.layerId);
      const maskSource = maskLayer && sources.get(maskLayer.source.providerId);
      if (!maskLayer || !maskSource) continue;
      const t = this.drawToTarget(maskLayer, maskSource, frame);
      if (t) maskTargets.set(ref.layerId, t);
    }
```

Release every entry at the end of `draw`. A mask referencing a layer id that is not on screen this frame resolves to no target, which the mask shader treats as fully transparent coverage — the consumer layer disappears. **ASSUMPTION**: that is the right default. The alternative (missing mask means no masking) hides authoring errors; this one makes them obvious immediately.

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm run build && npx vitest run tests/compositor-layer-mask.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/render/layers.ts src/render/native/page/compositor/renderer.ts tests/compositor-layer-mask.test.ts
git commit -s -m "feat(masks): mask a layer against another layer"
```

---

### Task 7: Effect chain framework

**Files:**
- Create: `src/render/native/page/compositor/effects/chain.ts`
- Create: `src/render/native/page/compositor/effects/pass.ts`
- Test: `tests/compositor-effect-chain.test.ts`

**Interfaces:**
- Consumes: `TargetPool`, `RenderTarget`.
- Produces: `interface EffectPass { name: string; frag: string; uniforms(gl, loc, params, frame): void }`; `runChain(gl, pool, src, passes, params, frame): RenderTarget`; `registerPass(pass: EffectPass): void`; `getPass(name: string): EffectPass | undefined`.

Ping-pong between two targets, one pass at a time. Every effect in Task 8 and every post-FX pass in phase 3 is an `EffectPass`, so this framework is shared.

- [ ] **Step 1: Write the failing test**

Create `tests/compositor-effect-chain.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";

const GL_ARGS = ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"];

describe("runChain", () => {
  it("applies passes in order — two halvings quarter the value", async () => {
    const bundle = await build({
      entryPoints: ["src/render/native/page/compositor/effects/chain.ts"],
      bundle: true, write: false, format: "iife", globalName: "KinoChain",
      platform: "browser", target: "chrome120", logLevel: "silent",
    });
    const browser = await puppeteer.launch({ headless: true, args: GL_ARGS });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><body><canvas id="c" width="16" height="16"></canvas></body>`);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const value = await page.evaluate(() => (window as any).KinoChain.probeChain(
        document.getElementById("c") as HTMLCanvasElement,
        ["halve", "halve"],
      ));
      // 1.0 → 0.5 → 0.25, read back as 8-bit.
      expect(value).toBeGreaterThanOrEqual(62);
      expect(value).toBeLessThanOrEqual(66);
    } finally {
      await browser.close();
    }
  }, 120000);

  it("returns the source unchanged for an empty chain", async () => {
    const bundle = await build({
      entryPoints: ["src/render/native/page/compositor/effects/chain.ts"],
      bundle: true, write: false, format: "iife", globalName: "KinoChain",
      platform: "browser", target: "chrome120", logLevel: "silent",
    });
    const browser = await puppeteer.launch({ headless: true, args: GL_ARGS });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><body><canvas id="c" width="16" height="16"></canvas></body>`);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const value = await page.evaluate(() => (window as any).KinoChain.probeChain(
        document.getElementById("c") as HTMLCanvasElement, [],
      ));
      expect(value).toBe(255);
    } finally {
      await browser.close();
    }
  }, 120000);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/compositor-effect-chain.test.ts
```

Expected: FAIL — cannot resolve `effects/chain.ts`.

- [ ] **Step 3: Write the pass interface**

Create `src/render/native/page/compositor/effects/pass.ts`:

```ts
// One fragment pass over a rendered layer. Every per-layer effect and every phase-3 post-FX
// stage is one of these, so they share compilation, ping-pong and uniform plumbing.
//
// Values arriving in `uSrc` are PREMULTIPLIED. A pass that is linear in alpha (blur, add) can
// work on them directly; anything that is not (saturation, gamma, contrast) must un-premultiply
// first and re-premultiply after, or dark halos appear around every soft edge.
export interface EffectPass {
  name: string;
  /** Fragment source. Receives `uniform sampler2D uSrc`, `uniform vec2 uRes`,
   *  `uniform float uFrame`, plus whatever this pass declares. */
  frag: string;
  /** Set this pass's own uniforms. `loc` is pre-resolved by name. */
  uniforms(
    gl: WebGL2RenderingContext,
    loc: Record<string, WebGLUniformLocation | null>,
    params: Record<string, number | string>,
    frame: number,
  ): void;
  /** Uniform names to resolve for `loc`. */
  uniformNames?: string[];
}

export const PASS_PREAMBLE = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform float uFrame;
out vec4 kino_frag;

vec4 kinoUnpremul(vec4 c) { return c.a > 0.0 ? vec4(c.rgb / c.a, c.a) : c; }
vec4 kinoPremul(vec4 c) { return vec4(c.rgb * c.a, c.a); }
`;
```

- [ ] **Step 4: Write the chain**

Create `src/render/native/page/compositor/effects/chain.ts`:

```ts
// Ping-pong an effect chain over a rendered layer.
import type { RenderTarget, TargetPool } from "../targets.js";
import { PASS_PREAMBLE, type EffectPass } from "./pass.js";

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const registry = new Map<string, EffectPass>();
export function registerPass(pass: EffectPass): void {
  registry.set(pass.name, pass);
}
export function getPass(name: string): EffectPass | undefined {
  return registry.get(name);
}

interface Compiled {
  prog: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
}
const compiled = new WeakMap<WebGL2RenderingContext, Map<string, Compiled>>();

function compileFor(gl: WebGL2RenderingContext, pass: EffectPass): Compiled {
  let byName = compiled.get(gl);
  if (!byName) {
    byName = new Map();
    compiled.set(gl, byName);
  }
  const hit = byName.get(pass.name);
  if (hit) return hit;

  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(`effect "${pass.name}" failed to compile: ${gl.getShaderInfoLog(s)}`);
    }
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, PASS_PREAMBLE + pass.frag));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`effect "${pass.name}" failed to link: ${gl.getProgramInfoLog(prog)}`);
  }
  const loc: Record<string, WebGLUniformLocation | null> = {};
  for (const n of ["uSrc", "uRes", "uFrame", ...(pass.uniformNames ?? [])]) {
    loc[n] = gl.getUniformLocation(prog, n);
  }
  const entry = { prog, loc };
  byName.set(pass.name, entry);
  return entry;
}

/**
 * Run `passes` over `src`, returning the final target. `src` is NOT released — the caller owns
 * it. An empty chain returns `src` itself, so callers must compare identity before releasing.
 */
export function runChain(
  gl: WebGL2RenderingContext,
  pool: TargetPool,
  src: RenderTarget,
  passes: Array<{ pass: EffectPass; params: Record<string, number | string> }>,
  frame: number,
): RenderTarget {
  if (!passes.length) return src;
  let read = src;
  let owned: RenderTarget | null = null;

  for (const { pass, params } of passes) {
    const { prog, loc } = compileFor(gl, pass);
    const write = pool.acquire(gl, src.w, src.h);
    pool.clear(gl, write);
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
    gl.viewport(0, 0, write.w, write.h);
    gl.disable(gl.BLEND);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, read.tex);
    gl.uniform1i(loc.uSrc, 0);
    gl.uniform2f(loc.uRes, write.w, write.h);
    gl.uniform1f(loc.uFrame, frame);
    pass.uniforms(gl, loc, params, frame);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (owned) pool.release(owned);
    owned = write;
    read = write;
  }
  return read;
}

/** Test hook: run a chain of named passes over a fully-white 1x1 source and read the red
 *  channel back. Registers a "halve" pass so the ordering property is checkable. */
export function probeChain(canvas: HTMLCanvasElement, names: string[]): number {
  registerPass({
    name: "halve",
    frag: `void main(){ kino_frag = texture(uSrc, gl_FragCoord.xy / uRes) * 0.5; }`,
    uniforms: () => {},
  });
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  // Deliberately imported lazily so this file has no import cycle with targets.ts at runtime.
  const { TargetPool } = require("../targets.js") as typeof import("../targets.js");
  const pool = new TargetPool();
  const src = pool.acquire(gl, canvas.width, canvas.height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, src.fbo);
  gl.viewport(0, 0, src.w, src.h);
  gl.clearColor(1, 1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const passes = names.map((n) => ({ pass: getPass(n)!, params: {} }));
  const out = runChain(gl, pool, src, passes, 0);
  const px = new Uint8Array(4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px[0];
}
```

If the bundler rejects `require` in this ESM context, hoist `TargetPool` to a normal top-level import — the lazy form is only there to keep the probe self-contained.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run tests/compositor-effect-chain.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add src/render/native/page/compositor/effects/ tests/compositor-effect-chain.test.ts
git commit -s -m "feat(effects): per-layer effect chain framework"
```

---

### Task 8: The first three effects

**Files:**
- Create: `src/render/native/page/compositor/effects/blur.ts`
- Create: `src/render/native/page/compositor/effects/glow.ts`
- Create: `src/render/native/page/compositor/effects/grade.ts`
- Test: `tests/compositor-effects.test.ts`

**Interfaces:**
- Consumes: `EffectPass`, `registerPass` from `effects/chain.js`.
- Produces: three registered passes — `blur` (params: `radius`), `glow` (params: `radius`, `intensity`, `threshold`), `grade` (params: `brightness`, `contrast`, `saturation`).

**ASSUMPTION** — this set is chosen because each exercises a different property of the framework: blur is separable and alpha-linear, glow reads a threshold and adds, grade is alpha-nonlinear and so must un-premultiply. A spec would settle the real effect list; if phase 3's post FX end up covering grade at the frame level, the per-layer version may be redundant.

- [ ] **Step 1: Write the failing test**

Create `tests/compositor-effects.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";

const GL_ARGS = ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"];

async function probe(effect: string, params: Record<string, number>): Promise<number[]> {
  const bundle = await build({
    entryPoints: ["src/render/native/page/compositor/effects/index.ts"],
    bundle: true, write: false, format: "iife", globalName: "KinoFx",
    platform: "browser", target: "chrome120", logLevel: "silent",
  });
  const browser = await puppeteer.launch({ headless: true, args: GL_ARGS });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><body><canvas id="c" width="64" height="64"></canvas></body>`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    return await page.evaluate((effect, params) => (window as any).KinoFx.probeEffect(
      document.getElementById("c") as HTMLCanvasElement, effect, params,
    ), effect, params);
  } finally {
    await browser.close();
  }
}

describe("blur", () => {
  it("spreads a hard edge — the pixel beside the edge gains value", async () => {
    const [atEdge] = await probe("blur", { radius: 8 });
    expect(atEdge).toBeGreaterThan(10);
    expect(atEdge).toBeLessThan(245);
  });

  it("radius 0 leaves the edge hard", async () => {
    const [atEdge] = await probe("blur", { radius: 0 });
    expect(atEdge === 0 || atEdge === 255).toBe(true);
  });
});

describe("grade", () => {
  it("saturation 0 makes a colored pixel grey", async () => {
    const [r, g, b] = await probe("grade", { saturation: 0, brightness: 1, contrast: 1 });
    expect(Math.abs(r - g)).toBeLessThanOrEqual(2);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(2);
  });

  it("brightness scales value", async () => {
    const [full] = await probe("grade", { saturation: 1, brightness: 1, contrast: 1 });
    const [half] = await probe("grade", { saturation: 1, brightness: 0.5, contrast: 1 });
    expect(half).toBeLessThan(full);
  });

  it("does not darken the edge of a soft shape — premultiply handled correctly", async () => {
    // A grade on premultiplied values without un-premultiplying produces a dark rim.
    const [, , , edgeDelta] = await probe("grade", { saturation: 1, brightness: 1.2, contrast: 1 });
    expect(edgeDelta).toBeLessThan(6);
  });
});

describe("glow", () => {
  it("adds light around a bright region", async () => {
    const [outside] = await probe("glow", { radius: 12, intensity: 1, threshold: 0.5 });
    expect(outside).toBeGreaterThan(0);
  });

  it("intensity 0 is a no-op", async () => {
    const [outside] = await probe("glow", { radius: 12, intensity: 0, threshold: 0.5 });
    expect(outside).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/compositor-effects.test.ts
```

Expected: FAIL — cannot resolve `effects/index.ts`.

- [ ] **Step 3: Write blur**

Create `src/render/native/page/compositor/effects/blur.ts`:

```ts
// Gaussian blur. Alpha-linear, so it operates on premultiplied values directly.
//
// Single-pass with a fixed tap count rather than separable two-pass: a layer effect runs on a
// full-frame target, and the second pass would double the target churn for a quality gain that
// is invisible at the radii layer effects use. Phase 3's bloom uses the separable form, where
// the radii are large enough to matter.
import type { EffectPass } from "./pass.js";

export const blurPass: EffectPass = {
  name: "blur",
  uniformNames: ["uRadius"],
  frag: `
uniform float uRadius;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  if (uRadius <= 0.0) { kino_frag = texture(uSrc, uv); return; }
  vec2 texel = 1.0 / uRes;
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  // 13 taps over ±radius, Gaussian-weighted. sigma = radius/2 puts ~95% of the kernel inside.
  float sigma = max(uRadius * 0.5, 0.0001);
  for (int i = -6; i <= 6; i++) {
    for (int j = -6; j <= 6; j++) {
      vec2 off = vec2(float(i), float(j)) * (uRadius / 6.0);
      float w = exp(-dot(off, off) / (2.0 * sigma * sigma));
      sum += texture(uSrc, uv + off * texel) * w;
      wsum += w;
    }
  }
  kino_frag = sum / max(wsum, 0.0001);
}`,
  uniforms(gl, loc, params) {
    gl.uniform1f(loc.uRadius, Number(params.radius ?? 0));
  },
};
```

- [ ] **Step 4: Write grade**

Create `src/render/native/page/compositor/effects/grade.ts`:

```ts
// Brightness / contrast / saturation. NONE of these are linear in alpha, so the pass
// un-premultiplies first and re-premultiplies after — skipping that gives every soft edge a
// dark rim, which is the bug tests/compositor-effects.test.ts's edge assertion catches.
import type { EffectPass } from "./pass.js";

export const gradePass: EffectPass = {
  name: "grade",
  uniformNames: ["uBrightness", "uContrast", "uSaturation"],
  frag: `
uniform float uBrightness;
uniform float uContrast;
uniform float uSaturation;
void main() {
  vec4 src = kinoUnpremul(texture(uSrc, gl_FragCoord.xy / uRes));
  vec3 c = src.rgb * uBrightness;
  c = (c - 0.5) * uContrast + 0.5;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, uSaturation);
  kino_frag = kinoPremul(vec4(clamp(c, 0.0, 1.0), src.a));
}`,
  uniforms(gl, loc, params) {
    gl.uniform1f(loc.uBrightness, Number(params.brightness ?? 1));
    gl.uniform1f(loc.uContrast, Number(params.contrast ?? 1));
    gl.uniform1f(loc.uSaturation, Number(params.saturation ?? 1));
  },
};
```

- [ ] **Step 5: Write glow**

Create `src/render/native/page/compositor/effects/glow.ts`:

```ts
// Bright-pass, blur, add back. Additive light around the bright parts of a layer.
import type { EffectPass } from "./pass.js";

export const glowPass: EffectPass = {
  name: "glow",
  uniformNames: ["uRadius", "uIntensity", "uThreshold"],
  frag: `
uniform float uRadius;
uniform float uIntensity;
uniform float uThreshold;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 src = texture(uSrc, uv);
  if (uIntensity <= 0.0) { kino_frag = src; return; }
  vec2 texel = 1.0 / uRes;
  vec3 bloom = vec3(0.0);
  float wsum = 0.0;
  float sigma = max(uRadius * 0.5, 0.0001);
  for (int i = -6; i <= 6; i++) {
    for (int j = -6; j <= 6; j++) {
      vec2 off = vec2(float(i), float(j)) * (uRadius / 6.0);
      vec4 s = texture(uSrc, uv + off * texel);
      // Bright pass on unpremultiplied colour so a faint-but-bright edge still contributes.
      vec3 lit = kinoUnpremul(s).rgb;
      float l = dot(lit, vec3(0.299, 0.587, 0.114));
      float keep = max(l - uThreshold, 0.0) / max(1.0 - uThreshold, 0.0001);
      float w = exp(-dot(off, off) / (2.0 * sigma * sigma));
      bloom += lit * keep * s.a * w;
      wsum += w;
    }
  }
  bloom = bloom / max(wsum, 0.0001) * uIntensity;
  // Additive: light adds, it does not occlude.
  kino_frag = vec4(src.rgb + bloom, max(src.a, min(1.0, dot(bloom, vec3(0.333)))));
}`,
  uniforms(gl, loc, params) {
    gl.uniform1f(loc.uRadius, Number(params.radius ?? 8));
    gl.uniform1f(loc.uIntensity, Number(params.intensity ?? 1));
    gl.uniform1f(loc.uThreshold, Number(params.threshold ?? 0.6));
  },
};
```

- [ ] **Step 6: Write the barrel and probe**

Create `src/render/native/page/compositor/effects/index.ts`:

```ts
// Registers every built-in effect. Importing this module is what makes getPass(name) work.
import { registerPass, runChain, getPass } from "./chain.js";
import { TargetPool } from "../targets.js";
import { blurPass } from "./blur.js";
import { gradePass } from "./grade.js";
import { glowPass } from "./glow.js";

registerPass(blurPass);
registerPass(gradePass);
registerPass(glowPass);

export { registerPass, runChain, getPass };
export { blurPass, gradePass, glowPass };

/** Test hook. Renders a half-white / half-transparent source with a soft-edged coloured band,
 *  runs one effect, and reads back four numbers:
 *    [0] the pixel just outside the hard edge  [1] green at a coloured pixel
 *    [2] blue at that pixel                    [3] darkening at a soft edge (premultiply check)
 */
export function probeEffect(
  canvas: HTMLCanvasElement,
  effect: string,
  params: Record<string, number>,
): number[] {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const pool = new TargetPool();
  const src = pool.acquire(gl, canvas.width, canvas.height);

  // Paint the source through a 2D canvas so the fixture is readable and its alpha is real.
  const c2d = document.createElement("canvas");
  c2d.width = canvas.width;
  c2d.height = canvas.height;
  const ctx = c2d.getContext("2d")!;
  ctx.clearRect(0, 0, c2d.width, c2d.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c2d.width / 2, c2d.height);          // hard edge at x = w/2
  ctx.fillStyle = "#ff6600";
  ctx.fillRect(4, 4, 8, 8);                                // coloured probe pixel region
  const grad = ctx.createLinearGradient(0, c2d.height - 12, 0, c2d.height);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, c2d.height - 12, c2d.width, 12);          // soft edge for the premultiply check

  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c2d);

  // Blit the fixture into the source target.
  gl.bindFramebuffer(gl.FRAMEBUFFER, src.fbo);
  gl.viewport(0, 0, src.w, src.h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const blit = getPass("blit") ?? (registerPass({
    name: "blit",
    frag: `void main(){ kino_frag = texture(uSrc, gl_FragCoord.xy / uRes); }`,
    uniforms: () => {},
  }), getPass("blit")!);
  const staged = pool.acquire(gl, src.w, src.h);
  gl.bindFramebuffer(gl.FRAMEBUFFER, staged.fbo);
  gl.viewport(0, 0, staged.w, staged.h);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  runChain(gl, pool, staged, [{ pass: blit, params: {} }], 0);

  const out = runChain(gl, pool, staged, [{ pass: getPass(effect)!, params }], 0);
  const read = (x: number, y: number): Uint8Array => {
    const px = new Uint8Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  const edge = read(canvas.width / 2 + 1, canvas.height / 2)[0];
  const colour = read(8, 8);
  const softTop = read(2, canvas.height - 12)[0];
  const softMid = read(2, canvas.height - 6)[0];
  return [edge, colour[1], colour[2], Math.max(0, softTop - softMid * 2)];
}
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npx vitest run tests/compositor-effects.test.ts
```

Expected: PASS, 6 tests. The premultiply assertion is the one worth watching — if it fails, `grade` is operating on premultiplied values somewhere.

- [ ] **Step 8: Wire effects into the renderer**

In `draw`, after masking and before compositing:

```ts
      const chain = layer.effects
        .map((e) => ({ pass: getPass(e.kind), params: e.params }))
        .filter((e): e is { pass: EffectPass; params: Record<string, number | string> } => Boolean(e.pass));
      const affected = chain.length ? runChain(gl, this.pool, current, chain, frame) : current;
```

releasing `affected` only when it is not identity-equal to `current`.

- [ ] **Step 9: Commit**

```bash
git add src/render/native/page/compositor/effects/ tests/compositor-effects.test.ts src/render/native/page/compositor/renderer.ts
git commit -s -m "feat(effects): blur, glow and grade layer effects"
```

---

### Task 9: Glass on the true composite

**Files:**
- Modify: `src/render/native/page/liquidGlass.ts`
- Modify: `src/render/native/page/compositor/renderer.ts`
- Test: `tests/compositor-glass-composite.test.ts`

**Interfaces:**
- Consumes: `RenderTarget`, the accumulated composite.
- Produces: `registerBackdropTexture(tex: WebGLTexture, w: number, h: number): void` alongside the existing `registerBackdrop`.

This is the payoff the spec named: today `registerBackdrop` hands the glass runtime whatever background layer drew last, so glass over footage or over a caption is impossible. In the compositor every layer is a texture, so the renderer can hand glass the composite accumulated *beneath the glass layer*.

- [ ] **Step 1: Write the failing test**

Create `tests/compositor-glass-composite.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0,
};
// Flat grey background: anything the glass refracts must come from the layer ABOVE it.
const grey = { kind: "custom" as const, image: null, shaderCode: null,
  customCode: "ctx.fillStyle='#808080';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);",
  params: {}, keyframes: [], triggers: [] };

// Stripes drawn by a motion layer BELOW the glass card — invisible to the old
// registerBackdrop path, which only ever saw the background canvas.
const stripes = {
  html: `<style>.s{position:absolute;inset:0;background:repeating-linear-gradient(90deg,#000 0 32px,#fff 32px 64px)}</style><div class="s"></div>`,
  params: {}, keyframes: [], triggers: [],
};
const card = {
  html: `<style>.c{position:absolute;left:14%;right:14%;top:36%;bottom:36%;border-radius:48px;background:transparent;--glass-strength:48px;--glass-band:120px}</style><div class="c kino-glass"></div>`,
  params: {}, keyframes: [], triggers: [],
};

const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: grey, disclosure: "",
  segments: [
    { kind: "motion", caption: "", startSec: 0, endSec: 2, motion: stripes, motionOverlay: card },
  ],
};

const meanDiff = (a: string, b: string) =>
  parseFloat(magick([a, b, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim());

describe("glass on the true composite", () => {
  it("refracts a layer above the background, which the DOM path cannot", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      const outDir = mkdtempSync(join(tmpdir(), "kino-glasscomp-"));
      const pngs = await renderStills({
        props, publicDir: mkdtempSync(join(tmpdir(), "glasscomp-pub-")),
        format: "9:16", frames: [{ frame: 20, name: "a" }, { frame: 20, name: "b" }], outDir,
      });
      // Deterministic first — a flaky GL path would make the next assertion meaningless.
      expect(meanDiff(pngs[0], pngs[1])).toBe(0);

      // The card region must not be a flat grey plate: it has to carry displaced stripe edges.
      const stddev = parseFloat(
        magick([pngs[0], "-crop", "760x760+160+580", "-format", "%[fx:standard_deviation]", "info:"]).trim(),
      );
      expect(stddev).toBeGreaterThan(0.05);
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 300000);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run build && npx vitest run tests/compositor-glass-composite.test.ts
```

Expected: FAIL on the stddev assertion — glass currently sees only the grey background, so the card region is flat.

- [ ] **Step 3: Add a texture-based backdrop entry point**

In `liquidGlass.ts`, add beside the existing `registerBackdrop`:

```ts
/** Compositor entry point: the true composite beneath this layer, already on the GPU.
 *  registerBackdrop's CanvasImageSource form stays for the DOM path, which phase 4 deletes. */
export function registerBackdropTexture(tex: WebGLTexture, width: number, height: number): void {
  backdropTexture = { tex, width, height };
}
```

and in the mirror's per-element draw, prefer `backdropTexture` when set — binding it directly instead of running `texImage2D` on a canvas. Skipping the upload is most of the reason this is also faster than the DOM path.

Reset `backdropTexture = null` at the start of each frame so a stale texture from the previous frame can never be sampled.

- [ ] **Step 4: Feed the composite from the renderer**

In `draw`, accumulate into a target rather than straight to the default framebuffer, and before drawing any layer whose markup contains `kino-glass`, hand the accumulated target to glass:

```ts
      // Glass layers refract everything already composited beneath them.
      if (this.glassLayerIds.has(layer.id)) {
        registerBackdropTexture(accum.tex, this.width, this.height);
      }
```

then blit `accum` to the default framebuffer once at the end. `glassLayerIds` is computed at registry build time by scanning each `html` source's markup for `kino-glass`.

**ASSUMPTION**: glass refracts everything beneath it in layer order. The alternative — refracting only the background — is what happens today, and the whole point of this task is that it is a limitation rather than a design.

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm run build && npx vitest run tests/compositor-glass-composite.test.ts
```

Expected: PASS.

- [ ] **Step 6: Confirm the DOM path's glass is unchanged**

```bash
npx vitest run tests/render-glass.test.ts
```

Expected: PASS with `KINO_COMPOSITOR` unset.

- [ ] **Step 7: Commit**

```bash
git add src/render/native/page/liquidGlass.ts src/render/native/page/compositor/renderer.ts tests/compositor-glass-composite.test.ts
git commit -s -m "feat(effects): liquid glass refracts the true composite beneath it"
```

---

### Task 10: Spec surface, validation and docs

**Files:**
- Modify: `src/render/props.ts` (add `mask` and `effects` to `KinoSegment`)
- Modify: the spec validation path that the CLI runs at build time
- Modify: `docs/spec-reference.md`, `docs/backgrounds-and-overlays.md`
- Test: `tests/mask-spec-validation.test.ts`

**Interfaces:**
- Consumes: `validateMask` (Task 3), `getPass` (Task 7).
- Produces: authored `mask` and `effects` fields that fail loudly when wrong.

- [ ] **Step 1: Write the failing test**

Create `tests/mask-spec-validation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateSegmentFx } from "../src/render/maskSpec.js";

describe("validateSegmentFx", () => {
  it("accepts a beat with no mask or effects", () => {
    expect(validateSegmentFx({}, 0)).toEqual([]);
  });

  it("prefixes errors with the beat index so the message is actionable", () => {
    const errs = validateSegmentFx({ mask: { source: { kind: "nope" } } }, 3);
    expect(errs[0]).toMatch(/beat 3/);
  });

  it("rejects an unknown effect kind, naming the ones that exist", () => {
    const errs = validateSegmentFx({ effects: [{ kind: "bokeh", params: {} }] }, 0);
    expect(errs[0]).toMatch(/bokeh/);
    expect(errs[0]).toMatch(/blur/);
  });

  it("accepts the built-in effects", () => {
    expect(validateSegmentFx({ effects: [{ kind: "blur", params: { radius: 8 } }] }, 0)).toEqual([]);
  });

  it("rejects effects that is not an array", () => {
    expect(validateSegmentFx({ effects: { kind: "blur" } }, 0)[0]).toMatch(/array/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/mask-spec-validation.test.ts
```

Expected: FAIL — `validateSegmentFx` is not exported.

- [ ] **Step 3: Add the validator**

Append to `src/render/maskSpec.ts`:

```ts
/** Effect kinds the compositor can run. Kept as a literal list rather than read from the pass
 *  registry: validation runs node-side in the CLI, where the page's registry is not loaded. */
export const EFFECT_KINDS = ["blur", "glow", "grade"] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

export interface LayerEffect {
  kind: EffectKind;
  params: Record<string, number | string>;
}

/** Validate the mask and effects on one beat. `index` is the beat's position, so a message
 *  points at the thing the author has to edit. */
export function validateSegmentFx(seg: unknown, index: number): string[] {
  const s = (seg ?? {}) as { mask?: unknown; effects?: unknown };
  const errs: string[] = [];
  const at = (msg: string) => `beat ${index}: ${msg}`;

  if (s.mask !== undefined) errs.push(...validateMask(s.mask).map(at));

  if (s.effects !== undefined) {
    if (!Array.isArray(s.effects)) {
      errs.push(at("effects must be an array"));
    } else {
      s.effects.forEach((e, j) => {
        const eff = (e ?? {}) as Partial<LayerEffect>;
        if (!eff.kind || !(EFFECT_KINDS as readonly string[]).includes(eff.kind)) {
          errs.push(at(`effects[${j}].kind "${String(eff.kind)}" is not an effect — expected one of ${EFFECT_KINDS.join(", ")}`));
        }
        if (eff.params !== undefined && (typeof eff.params !== "object" || eff.params === null)) {
          errs.push(at(`effects[${j}].params must be an object`));
        }
      });
    }
  }
  return errs;
}
```

- [ ] **Step 4: Add the fields to the props type**

In `src/render/props.ts`, add to `KinoSegment`:

```ts
  mask?: LayerMask;          // clip this beat's layers to a shape, file or other layer
  effects?: LayerEffect[];   // per-layer effect chain, applied before compositing
```

importing both from `./maskSpec.js`.

- [ ] **Step 5: Call the validator from the CLI's spec validation**

Find where the build validates a spec (the path that produces the existing user-facing validation errors) and add a pass over `segments` calling `validateSegmentFx(seg, i)`, collecting into the same error list. Follow the existing error-reporting shape exactly — a mask error should read like every other spec error, not like a new subsystem.

- [ ] **Step 6: Run the tests**

```bash
npx vitest run tests/mask-spec-validation.test.ts && npm run build && npx vitest run
```

Expected: PASS throughout.

- [ ] **Step 7: Document the fields**

Add a **Masks and effects** section to `docs/spec-reference.md` covering: the three mask sources with one JSON example each, `feather`/`expand`/`invert` and that they are true pixel distances, the three effect kinds with their params, and the two behaviors an author will otherwise discover the hard way — a `layer` mask whose target is off-screen hides the masked layer entirely, and `feather` beyond 128px is rejected because it exceeds the SDF encode range.

Cross-reference from `docs/backgrounds-and-overlays.md` where overlays are described.

- [ ] **Step 8: Commit**

```bash
git add src/render/props.ts src/render/maskSpec.ts docs/spec-reference.md docs/backgrounds-and-overlays.md tests/mask-spec-validation.test.ts
git commit -s -m "feat(masks): spec surface for layer masks and effects"
```

---

### Task 11: Phase 2 regression sweep

**Files:**
- Modify: `tests/render-compositor-parity.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: confidence that masks and effects did not disturb the parity established in phase 1.

- [ ] **Step 1: Confirm unmasked parity is untouched**

```bash
npm run build && npx vitest run tests/render-compositor-parity.test.ts
```

Expected: PASS on every row, with the same `meanDiff` values phase 1 recorded. A row that drifted means a phase-2 change leaked into the unmasked path — the render targets and effect chain must be no-ops for a layer with neither.

- [ ] **Step 2: Confirm region shaders still work**

```bash
npx vitest run tests/render-region-params.test.ts tests/render-region-backdrop.test.ts tests/render-region-crosssample.test.ts tests/render-maskdist.test.ts tests/render-maskdist-video.test.ts tests/render-region-reuse.test.ts
```

Expected: PASS. Phase 2 generalizes masking but must not touch the region-shader path; phase 4 is where the two converge.

- [ ] **Step 3: Add mask and effect rows to the parity matrix**

These rows have no DOM-path equivalent, so they cannot be compared against it. Add them instead as **self-determinism and non-triviality** rows: render each twice, assert `meanDiff === 0`, and assert the frame differs from the same spec rendered without the mask or effect. A mask that silently does nothing would otherwise pass every test in this plan.

- [ ] **Step 4: Run the full suite**

```bash
npx vitest run
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add tests/render-compositor-parity.test.ts
git commit -s -m "test(compositor): mask and effect coverage in the parity matrix"
```

- [ ] **Step 6: Hand off to phase 3**

Phase 3 builds on two things this phase delivered: `TargetPool` (post FX need somewhere to accumulate) and `EffectPass` (every post stage is one). The one capability phase 3 needs that phase 2 did not build is **layer groups** — compositing a subset of layers into a named target — which is what a shader transition between two beats requires.
