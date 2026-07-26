# GL Compositor Phase 4 — Performance and DOM Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the compositor the only render path — faster than the DOM path it replaces, with the DOM path deleted and every capability that depended on it rebuilt on the layer graph.

**Architecture:** Four independent strands. Restore the DOM-only capability the compositor broke (`[data-measure]` geometry). Take the deferred wins (supersampling at the composite, the faster capture path, raster prefetch). Flip the default. Delete ~2,450 lines of DOM path and the branches that select it.

**Tech Stack:** TypeScript (strict), WebGL2, puppeteer/CDP, vitest, ImageMagick (`magick`), ffmpeg.

## Global Constraints

- **Blocked on phases 1–3.** Deleting the DOM path before masks, effects and post FX exist on the compositor would remove capability, not duplication.
- **No spec document precedes this plan.** Design choices a spec would settle are marked **ASSUMPTION** inline.
- **Task order is not free.** Tasks 1–5 must all land before Task 6 flips the default, and Task 6 must land before Task 7 deletes anything. Deleting the reference implementation while the compositor is still opt-in leaves no way to diagnose a regression.
- Every task before Task 7 must leave **both** paths working and the full suite green.
- Phase 1's parity harness is the safety net for Tasks 1–6 and becomes meaningless at Task 7 — Task 7 converts it to a golden-image harness before removing its DOM half.
- Measure before optimizing. Tasks 2–4 each require a before/after number in the same units phase 1's M1 used; an optimization with no measured win gets reverted, not merged.
- Commit messages need a DCO sign-off (`git commit -s`).

## What phase 4 inherits

| Deferred from | What | Where it was deferred |
|---|---|---|
| Phase 1 | Supersampling stays per-source instead of moving to the composite | spec "Capture, color and cache"; core plan Task 11 |
| Phase 1 | Capture stays CDP JPEG; `readPixels` benchmarked but not adopted | spec; spike M5 |
| Phase 1 | `[data-measure]` geometry silently wrong under the compositor | core plan Task 13 Step 4 comment |
| Phase 1 | `frameCache` carries a `compositor` discriminator so both paths coexist | core plan Task 14 |
| Phase 3 | Frame cost re-measured after groups and post passes | phase 3 Task 6 Step 8 |

## The deletion target

| File | Lines | Fate |
|---|---|---|
| `src/render/native/page/KinoVideo.tsx` | 213 | delete |
| `src/render/native/page/components.tsx` | 608 | delete |
| `src/render/native/page/CanvasBackground.tsx` | 46 | delete |
| `src/render/native/page/ShaderBackground.tsx` | 354 | delete |
| `src/render/native/page/RegionShader.tsx` | 571 | delete |
| `src/render/native/page/MotionGraphic.tsx` | 190 | delete |
| `src/render/native/page/liquidGlass.ts` | 472 | keep — the compositor calls it (phase 2 Task 9); delete only its `CanvasImageSource` backdrop path |

~1,982 lines deleted outright, plus the branch in `index.tsx` that chooses between paths.

---

### Task 1: Measurements from the layer graph

**Files:**
- Create: `src/render/measure.ts`
- Modify: `src/render/native/engine.ts`
- Test: `tests/layer-measure.test.ts`

**Interfaces:**
- Consumes: `layersAt`, `LayerDraw`.
- Produces: `measureLayers(layers: LayerDraw[], dims: Dims): ElementMeasure[]` — the same shape `collectMeasurements` returns today, computed from the graph instead of the DOM.

This is a **bug fix, not an optimization**, and it is first because it is the one thing the compositor made worse. `collectMeasurements` ([engine.ts:431](src/render/native/engine.ts:431)) reads `getBoundingClientRect()` off `[data-measure]` nodes; under the compositor those nodes live in a staging container at `left:-99999`, so every measurement comes back offset by that amount. Silently wrong numbers are worse than missing ones — layout QA reads them as truth.

Computing from `layersAt` is also strictly better than the DOM version: exact rects, no layout query, and it works for layers that were never DOM elements.

- [ ] **Step 1: Write the failing test**

Create `tests/layer-measure.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { measureLayers } from "../src/render/measure.js";
import { normalizeLayer } from "../src/render/native/page/compositor/graph.js";

const DIMS = { width: 1080, height: 1920 };
const layer = (id: string, rect: { x: number; y: number; w: number; h: number }, transform?: { scale: number; rotate: number; translate: [number, number] }) =>
  normalizeLayer({ id, source: { providerId: id }, rect, transform });

describe("measureLayers", () => {
  it("reports a full-frame layer as centered", () => {
    const [m] = measureLayers([layer("caption0", { x: 0, y: 0, w: 1080, h: 1920 })], DIMS);
    expect(m.label).toBe("caption0");
    expect(m.cxPct).toBeCloseTo(50, 5);
    expect(m.dxPct).toBeCloseTo(0, 5);
    expect(m.dyPct).toBeCloseTo(0, 5);
  });

  it("reports an off-center layer's signed offset", () => {
    const [m] = measureLayers([layer("logo", { x: 0, y: 0, w: 108, h: 108 })], DIMS);
    // Center at (54, 54) → 5% across, 2.8125% down.
    expect(m.cxPct).toBeCloseTo(5, 4);
    expect(m.dxPct).toBeCloseTo(-45, 4);
    expect(m.dyPct).toBeCloseTo(-47.1875, 4);
  });

  it("accounts for the layer transform, not just the rect", () => {
    const scaled = layer("seg0", { x: 0, y: 0, w: 1080, h: 1920 }, { scale: 2, rotate: 0, translate: [0, 0] });
    const [m] = measureLayers([scaled], DIMS);
    expect(m.w).toBeCloseTo(2160, 5);
    expect(m.h).toBeCloseTo(3840, 5);
    expect(m.cxPct).toBeCloseTo(50, 5); // scaling about the center does not move it
  });

  it("accounts for translation", () => {
    const moved = layer("cap", { x: 0, y: 0, w: 1080, h: 1920 }, { scale: 1, rotate: 0, translate: [108, 0] });
    const [m] = measureLayers([moved], DIMS);
    expect(m.dxPct).toBeCloseTo(10, 4);
  });

  it("measures every layer, in draw order", () => {
    const ms = measureLayers([
      layer("backdrop", { x: 0, y: 0, w: 1080, h: 1920 }),
      layer("caption0", { x: 0, y: 1400, w: 1080, h: 300 }),
    ], DIMS);
    expect(ms.map((m) => m.label)).toEqual(["backdrop", "caption0"]);
  });

  it("returns an empty list for no layers", () => {
    expect(measureLayers([], DIMS)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/layer-measure.test.ts
```

Expected: FAIL — cannot resolve `src/render/measure.js`.

- [ ] **Step 3: Write the measurer**

Create `src/render/measure.ts`:

```ts
// Layout geometry from the layer graph.
//
// Replaces engine.ts's collectMeasurements(), which walked the DOM for [data-measure] nodes.
// That approach cannot survive the compositor: staged markup sits off-screen at left:-99999,
// so every rect came back offset by that amount — silently wrong rather than absent.
//
// Reading the graph is also more accurate: these are the exact rects the renderer draws, and
// it covers layers that were never DOM elements at all.
import type { LayerDraw } from "./native/page/compositor/graph.js";
import type { Dims } from "./native/page/compositor/graph.js";

export interface ElementMeasure {
  label: string;
  x: number; y: number; w: number; h: number;
  cx: number; cy: number;
  cxPct: number; cyPct: number;
  dxPct: number; dyPct: number;
}

export function measureLayers(layers: LayerDraw[], dims: Dims): ElementMeasure[] {
  const { width: W, height: H } = dims;
  return layers.map((layer) => {
    const { x, y, w, h } = layer.rect;
    const { scale, translate } = layer.transform;
    // Transform scales about the rect center, then translates — the same order modelMatrix
    // applies in the renderer. Rotation is deliberately not folded into w/h: a rotated
    // layer's axis-aligned bounds would misreport its actual size, and every consumer of
    // these numbers is checking alignment, not bounding boxes.
    const cx = x + w / 2 + translate[0];
    const cy = y + h / 2 + translate[1];
    const sw = w * scale;
    const sh = h * scale;
    return {
      label: layer.id,
      x: cx - sw / 2,
      y: cy - sh / 2,
      w: sw,
      h: sh,
      cx,
      cy,
      cxPct: (cx / W) * 100,
      cyPct: (cy / H) * 100,
      dxPct: (cx / W) * 100 - 50,
      dyPct: (cy / H) * 100 - 50,
    };
  });
}
```

- [ ] **Step 4: Route the engine's measureSink through it**

In `engine.ts`'s `renderStillsLocked`, when the compositor is active, fill `measureSink` from `measureLayers(layersAt(props, frame, dims), dims)` instead of the in-page `collectMeasurements` evaluate. Keep the DOM path on the old collector until Task 7 removes it.

Re-export `ElementMeasure` from `engine.ts` as it does today so no consumer's import breaks.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run tests/layer-measure.test.ts && npm run build && npx vitest run
```

Expected: PASS throughout.

- [ ] **Step 6: Verify against the DOM path on a real spec**

Render the same frame of a real spec both ways with a `measureSink` and compare the caption's `dxPct`. The two should agree within a pixel-equivalent. A large disagreement means either the layer rect or the DOM box was never what it claimed — investigate before continuing, because Task 7 deletes the thing you would compare against.

- [ ] **Step 7: Commit**

```bash
git add src/render/measure.ts src/render/native/engine.ts tests/layer-measure.test.ts
git commit -s -m "fix(measure): compute layout geometry from the layer graph, not the staging DOM"
```

---

### Task 2: Supersampling at the composite

**Files:**
- Modify: `src/render/native/page/compositor/renderer.ts`
- Modify: `src/render/native/page/compositor/providers/shader.ts`, `providers/region.ts`
- Test: `tests/compositor-ss.test.ts`

**Interfaces:**
- Consumes: `TargetPool`.
- Produces: `StageRenderer` renders the whole graph at SS× and resolves once at `present`.

Deferred from phase 1 because relocating SS changes shader pixels and phase 1's only job was parity. Now that parity is established and about to be retired, the move is safe — and it is the one change that improves quality for *every* layer rather than just shaders: rasterized text and video edges get supersampled too, which they never were.

- [ ] **Step 1: Write the failing test**

Create `tests/compositor-ss.test.ts`:

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
// A hard diagonal: the classic aliasing test. Supersampling must soften its staircase.
const diagonal = { kind: "custom" as const, image: null, shaderCode: null,
  customCode: "const w=ctx.canvas.width,h=ctx.canvas.height;ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);ctx.fillStyle='#fff';ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(w,h);ctx.lineTo(w,0);ctx.closePath();ctx.fill();",
  params: {}, keyframes: [], triggers: [] };

const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: diagonal, disclosure: "",
  segments: [{ kind: "scene", caption: "", startSec: 0, endSec: 2 }],
};

const render = async (ss: string, name: string) => {
  process.env.KINO_COMPOSITOR = "1";
  process.env.KINO_SHADER_SSAA = ss;
  try {
    const [png] = await renderStills({
      props, publicDir: mkdtempSync(join(tmpdir(), "ss-pub-")),
      format: "9:16", frames: [{ frame: 5, name }],
      outDir: mkdtempSync(join(tmpdir(), "ss-out-")),
    });
    return png;
  } finally {
    delete process.env.KINO_COMPOSITOR;
    delete process.env.KINO_SHADER_SSAA;
  }
};

/** Count of pixels that are neither black nor white — the antialiased edge population. */
const edgePixels = (png: string) =>
  parseFloat(magick([png, "-colorspace", "gray", "-solarize", "50%", "-format", "%[fx:mean]", "info:"]).trim());

describe("supersampling at the composite", () => {
  it("SS=2 produces a softer edge than SS=1", async () => {
    const [one, two] = [await render("1", "ss1"), await render("2", "ss2")];
    expect(edgePixels(two)).toBeGreaterThan(edgePixels(one));
  }, 300000);

  it("stays deterministic at SS=2", async () => {
    const [a, b] = [await render("2", "a"), await render("2", "b")];
    const diff = parseFloat(
      magick([a, b, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim(),
    );
    expect(diff).toBe(0);
  }, 300000);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run build && npx vitest run tests/compositor-ss.test.ts
```

Expected: FAIL on the first test — the canvas2d backdrop is not supersampled today, so SS=1 and SS=2 give it identical edges.

- [ ] **Step 3: Render the graph at SS×**

In `StageRenderer`'s constructor, size the accumulator target at `width * ss` by `height * ss` while the canvas stays at frame size. Every group target, mask target and effect target follows the accumulator's size. At `present`, run the existing FXAA pass and downsample to the canvas.

- [ ] **Step 4: Remove per-source SS from the shader and region providers**

Both currently render into their own canvas at SS× and resolve internally. Now that the graph is already at SS×, they render at 1:1 into the SS-sized target instead — one resolve for the frame rather than one per source. Delete their internal FXAA/downsample and keep the composite's.

- [ ] **Step 5: Measure the cost**

Run the phase-1 M1 comparison at SS=1 and SS=2. Record both. **ASSUMPTION**: the win from removing per-source resolves offsets some of the cost of a 4× accumulator. If the measurement says otherwise — if SS=2 at the composite is materially slower than SS=2 per-source — keep the change only if the quality gain on text and video edges justifies it, and record that judgement.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm run build && npx vitest run tests/compositor-ss.test.ts tests/render-compositor-parity.test.ts
```

Expected: the SS tests PASS. Parity rows will drift — the compositor is now antialiasing things the DOM path never did. Re-baseline the affected rows with a recorded reason, exactly as phase 3 Task 5 did for the film finish.

- [ ] **Step 7: Commit**

```bash
git add src/render/native/page/compositor/renderer.ts src/render/native/page/compositor/providers/shader.ts src/render/native/page/compositor/providers/region.ts tests/compositor-ss.test.ts tests/render-compositor-parity.test.ts
git commit -s -m "perf(compositor): supersample the whole composite, one resolve per frame"
```

---

### Task 3: The capture path

**Files:**
- Modify: `src/render/native/engine.ts`
- Test: `tests/capture-path.test.ts`

**Interfaces:**
- Consumes: the spike's M5 numbers.
- Produces: whichever capture path measured faster, behind `KINO_CAPTURE=cdp|canvas` with the winner as the default.

**Read the spike's M5 row before writing any code here.** If CDP screenshot won, this task is a no-op — close it, record why, and move on. Implementing the loser because a plan said to is exactly the failure this note exists to prevent.

- [ ] **Step 1: Re-measure on the current build**

M5 measured a bare canvas. The compositor now does group compositing, post passes and an SS resolve, so the balance may have shifted. Re-run the comparison against a real build:

```bash
KINO_TIMING=1 KINO_CONCURRENCY=1 KINO_COMPOSITOR=1 npx kino build <typical-spec.json> --draft 2> /tmp/cap-cdp.log
KINO_TIMING=1 KINO_CONCURRENCY=1 KINO_COMPOSITOR=1 KINO_CAPTURE=canvas npx kino build <typical-spec.json> --draft 2> /tmp/cap-canvas.log
```

- [ ] **Step 2: Decide from the numbers**

If the two are within 10%, keep CDP: it is the incumbent, it is fewer moving parts, and `preserveDrawingBuffer` is already load-bearing for it. Only switch on a clear win.

- [ ] **Step 3: If switching, write the failing test**

Create `tests/capture-path.test.ts`:

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
const magenta = { kind: "custom" as const, image: null, shaderCode: null,
  customCode: "ctx.fillStyle='#ff00ff';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);",
  params: {}, keyframes: [], triggers: [] };
const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: magenta, disclosure: "",
  segments: [{ kind: "scene", caption: "", startSec: 0, endSec: 2 }],
};

const render = async (capture: string, name: string) => {
  process.env.KINO_COMPOSITOR = "1";
  process.env.KINO_CAPTURE = capture;
  try {
    const [png] = await renderStills({
      props, publicDir: mkdtempSync(join(tmpdir(), "cap-pub-")),
      format: "9:16", frames: [{ frame: 5, name }],
      outDir: mkdtempSync(join(tmpdir(), "cap-out-")),
    });
    return png;
  } finally {
    delete process.env.KINO_COMPOSITOR;
    delete process.env.KINO_CAPTURE;
  }
};

describe("capture paths agree", () => {
  it("cdp and canvas capture produce the same pixels", async () => {
    const [a, b] = [await render("cdp", "cdp"), await render("canvas", "canvas")];
    const diff = parseFloat(
      magick([a, b, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim(),
    );
    // Both encode the same framebuffer; only the transport differs.
    expect(diff).toBeLessThan(0.001);
  }, 300000);
});
```

- [ ] **Step 4: Implement the alternate path**

In `engine.ts`'s `shot()`, branch on `KINO_CAPTURE`. The canvas path evaluates `document.getElementById("kino-stage").toDataURL("image/jpeg", 0.95)` and decodes the base64 node-side. Keep CDP as the fallback when the element is missing, so a mis-set env var degrades rather than crashes.

- [ ] **Step 5: Run the test and record the numbers**

```bash
npm run build && npx vitest run tests/capture-path.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/render/native/engine.ts tests/capture-path.test.ts
git commit -s -m "perf(capture): select the measured-faster capture path"
```

If Step 2 said keep CDP, commit only a note in the phase-4 record explaining that M5's conclusion held, and skip the rest.

---

### Task 4: Raster prefetch

**Files:**
- Modify: `src/render/native/page/compositor/Stage.tsx`
- Modify: `src/render/native/page/compositor/providers/html.ts`
- Test: `tests/compositor-prefetch.test.ts`

**Interfaces:**
- Consumes: the `html` provider's cadence classification.
- Produces: `Stage.seek` optionally prepares frame *n+1*'s rasters while frame *n* encodes.

The engine renders frames in order, and after `seek(n)` resolves, the page sits idle while node captures and encodes. A `dynamic` layer's raster for frame *n+1* could be produced during that window. **ASSUMPTION**: this is worth doing. It is only worth doing if the capture window is actually idle *and* the spike's M2 showed raster cost dominating — check both before building.

- [ ] **Step 1: Confirm the premise**

From the phase-1 M1 log, compare `capture` time against `resolve` time. If capture is a small fraction of resolve, there is no idle window worth filling — close this task and record why.

- [ ] **Step 2: Write the failing test**

Create `tests/compositor-prefetch.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextFrameKeys } from "../src/render/native/page/compositor/Stage.js";
import { normalizeLayer } from "../src/render/native/page/compositor/graph.js";

const layer = (id: string, key?: string) =>
  normalizeLayer({ id, source: { providerId: id, key }, rect: { x: 0, y: 0, w: 10, h: 10 } });

describe("nextFrameKeys", () => {
  it("names the sources the next frame will need", () => {
    const keys = nextFrameKeys([layer("motion0", "41")], [layer("motion0", "42")]);
    expect(keys).toEqual([{ providerId: "motion0", key: "42" }]);
  });

  it("skips sources whose key is unchanged — already cached", () => {
    expect(nextFrameKeys([layer("caption0", "w3")], [layer("caption0", "w3")])).toEqual([]);
  });

  it("includes a source that appears for the first time", () => {
    const keys = nextFrameKeys([layer("motion0", "10")], [layer("motion0", "11"), layer("overlay0", "0")]);
    expect(keys.map((k) => k.providerId).sort()).toEqual(["motion0", "overlay0"]);
  });

  it("ignores sources that are leaving", () => {
    expect(nextFrameKeys([layer("motion0", "59"), layer("caption0", "w2")], [layer("caption0", "w2")])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
npx vitest run tests/compositor-prefetch.test.ts
```

Expected: FAIL — `nextFrameKeys` is not exported.

- [ ] **Step 4: Implement prefetch**

Export `nextFrameKeys(current: LayerDraw[], next: LayerDraw[])` from `Stage.tsx` — a pure diff of `(providerId, key)` pairs, returning what the next frame needs that this frame did not.

After the draw phase, kick off (but do not await) `prepare` for those pairs. The seek promise must resolve without waiting on them, or prefetch becomes a serial cost rather than a parallel one.

Two invariants the implementation must hold, or determinism breaks:
- A prefetch in flight when the *next* `seek` arrives must be awaited by that seek, not raced against it.
- A prefetch must never write to a provider's `current` pointer — only to its cache. Otherwise frame *n*'s draw could bind frame *n+1*'s raster.

- [ ] **Step 5: Run the tests and measure**

```bash
npx vitest run tests/compositor-prefetch.test.ts && npm run build
KINO_TIMING=1 KINO_CONCURRENCY=1 KINO_COMPOSITOR=1 npx kino build <worst-case-spec.json> --draft 2> /tmp/prefetch.log
```

Compare against the pre-prefetch run. **If there is no measurable win, revert this task.** A speculative optimization that costs complexity and buys nothing is worse than not having it.

- [ ] **Step 6: Verify determinism is intact**

```bash
npx vitest run tests/render-compositor-parity.test.ts
```

Expected: PASS, including every self-determinism row. A prefetch race would show up here as an intermittent non-zero diff — if any row flakes, revert rather than debug under time pressure.

- [ ] **Step 7: Commit**

```bash
git add src/render/native/page/compositor/Stage.tsx src/render/native/page/compositor/providers/html.ts tests/compositor-prefetch.test.ts
git commit -s -m "perf(compositor): prefetch the next frame's rasters during capture"
```

---

### Task 5: Full-build validation

**Files:**
- Create: `docs/superpowers/specs/2026-07-25-gl-compositor-phase4-REPORT.md`

**Interfaces:**
- Consumes: everything from phases 1–4.
- Produces: the evidence Task 6 needs to flip the default.

- [ ] **Step 1: Build a representative set both ways**

Render at least four real specs on both paths: the phase-1 typical and worst-case specs, one spec using a shader background, and one using region shaders. Use `--draft` to keep it free.

- [ ] **Step 2: Record per-frame cost for each**

Using `KINO_TIMING=1 KINO_CONCURRENCY=1` and `scripts/spike/percentiles.mjs`, fill a table: spec, DOM p50, compositor p50, ratio.

- [ ] **Step 3: Run the adversarial visual pass**

Invoke the `adversarial-critique` skill on the compositor renders of all four. It catches what thresholds cannot: a caption a few px off, a logo at the wrong scale, a motion graphic missing an image the inliner failed to resolve.

- [ ] **Step 4: Check the frame cache end to end**

Build the same spec twice with the compositor on and confirm the second build serves from cache. Then build once with it off and confirm **no** cross-serving — the phase-1 discriminator must still be holding.

- [ ] **Step 5: Write the REPORT**

Cover: the cost table, the visual pass findings, cache behavior, which of Tasks 2–4 measured a win and which were reverted, and any parity rows re-baselined across phases 2–4 with their recorded reasons.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-07-25-gl-compositor-phase4-REPORT.md
git commit -s -m "docs(spec): phase 4 validation report"
```

---

### Task 6: Flip the default

**Files:**
- Modify: `src/render/native/engine.ts`
- Modify: `docs/build-and-preview.md`
- Test: `tests/compositor-default.test.ts`

**Interfaces:**
- Consumes: Task 5's REPORT.
- Produces: `KINO_COMPOSITOR` defaults to on; `KINO_COMPOSITOR=0` selects the DOM path.

- [ ] **Step 1: Gate on the REPORT**

Flip only if all three hold: the parity harness is green (with re-baselines documented), the visual pass found nothing, and per-frame cost meets phase 1's proceed criterion on a real build. If any fails, stop here — a default-off compositor with everything else shipped is still a good outcome, and Task 7 must not proceed without this task.

- [ ] **Step 2: Write the failing test**

Create `tests/compositor-default.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { compositorEnabled } from "../src/render/native/engine.js";

describe("compositorEnabled", () => {
  it("is on by default", () => {
    expect(compositorEnabled({})).toBe(true);
  });

  it("is off when explicitly disabled", () => {
    expect(compositorEnabled({ KINO_COMPOSITOR: "0" })).toBe(false);
  });

  it("is on when explicitly enabled", () => {
    expect(compositorEnabled({ KINO_COMPOSITOR: "1" })).toBe(true);
  });

  it("treats any other value as on — only an explicit 0 opts out", () => {
    expect(compositorEnabled({ KINO_COMPOSITOR: "yes" })).toBe(true);
  });
});
```

- [ ] **Step 2b: Run it to verify it fails**

```bash
npx vitest run tests/compositor-default.test.ts
```

Expected: FAIL — `compositorEnabled` is not exported, and the current check is `=== "1"`.

- [ ] **Step 3: Invert the check**

In `engine.ts`, replace every `process.env.KINO_COMPOSITOR === "1"` with a call to one exported predicate:

```ts
/** The compositor is the default path. Only an explicit "0" selects the legacy DOM path,
 *  which phase 4 removes entirely. */
export function compositorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.KINO_COMPOSITOR !== "0";
}
```

Update the `frameCache` discriminator call site to use it too — the cache must follow the same predicate or a default-on build could serve DOM-path frames.

- [ ] **Step 4: Run the whole suite**

```bash
npm run build && npx vitest run
```

Every render test now exercises the compositor by default. Tests that assert DOM-path behavior must set `KINO_COMPOSITOR=0` explicitly; fix them one at a time rather than loosening assertions.

- [ ] **Step 5: Document the flag**

In `docs/build-and-preview.md`, document `KINO_COMPOSITOR=0` as the escape hatch, note that it is scheduled for removal, and say what to do instead if someone needs it — file the frame that made them reach for it.

- [ ] **Step 6: Commit**

```bash
git add src/render/native/engine.ts docs/build-and-preview.md tests/compositor-default.test.ts
git commit -s -m "feat(compositor): make the GL compositor the default render path"
```

---

### Task 7: Delete the DOM path

**Files:**
- Delete: `KinoVideo.tsx`, `components.tsx`, `CanvasBackground.tsx`, `ShaderBackground.tsx`, `RegionShader.tsx`, `MotionGraphic.tsx`
- Modify: `src/render/native/page/index.tsx`, `liquidGlass.ts`, `frameCache.ts`, `engine.ts`
- Modify: every test that renders through the DOM path

**Interfaces:**
- Consumes: a shipped, default-on compositor.
- Produces: one render path.

Do this **last**, in the order below, and not in one commit. Deleting the reference implementation removes the ability to diagnose a regression by comparison, so each step must leave the suite green on its own.

- [ ] **Step 1: Convert the parity harness to golden images**

`tests/render-compositor-parity.test.ts` compares against a path that is about to stop existing. Before deleting anything, re-render every matrix row through the compositor, commit those PNGs as golden images under `tests/golden/`, and rewrite the harness to compare against them with the same `meanDiff ≤ 0.01` gate.

This keeps the regression net intact and is the whole reason deletion can be safe. Do it first.

```bash
npx vitest run tests/render-compositor-parity.test.ts
```

Expected: PASS against goldens, with no DOM-path render in the run.

```bash
git add tests/golden tests/render-compositor-parity.test.ts
git commit -s -m "test(compositor): golden-image harness replacing DOM-path parity"
```

- [ ] **Step 2: Remove the path branch**

In `index.tsx`, delete the `config.compositor` conditional and its DOM branch; `Stage` becomes the only thing mounted. In `engine.ts`, delete `compositorEnabled` and every call, and stop writing `compositor` into the render config.

```bash
npm run build && npx vitest run
```

Expected: green, after any test that set `KINO_COMPOSITOR=0` is updated. If a test genuinely needs the DOM path, that is a signal the compositor is missing something — find out what before continuing.

```bash
git add src/render/native/page/index.tsx src/render/native/engine.ts tests/
git commit -s -m "refactor(render): remove the DOM-path branch"
```

- [ ] **Step 3: Delete the components**

```bash
git rm src/render/native/page/KinoVideo.tsx src/render/native/page/components.tsx src/render/native/page/CanvasBackground.tsx src/render/native/page/ShaderBackground.tsx src/render/native/page/RegionShader.tsx src/render/native/page/MotionGraphic.tsx
npm run build && npx vitest run
```

Anything that fails to build now was importing the DOM path. Most will be helper imports (`captionLayout`, `textStyles`, `motionCss`) that should move into the compositor's own modules rather than be deleted — check each one before removing it, since these are shared pure helpers, not DOM code.

```bash
git commit -s -m "refactor(render): delete the DOM render path"
```

- [ ] **Step 4: Trim liquid glass**

`liquidGlass.ts` stays — the compositor calls it. Delete only the `CanvasImageSource` form of `registerBackdrop` and the canvas-upload branch it feeds, leaving `registerBackdropTexture` from phase 2 Task 9 as the sole entry point.

```bash
npx vitest run tests/render-glass.test.ts tests/compositor-glass-composite.test.ts
git commit -s -m "refactor(glass): drop the canvas-backdrop path"
```

- [ ] **Step 5: Simplify the frame cache**

With one path, the `compositor` discriminator in `globalSig` is dead weight. Remove it and bump `VERSION` to 4 — the bump is what prevents caches written by the two-path era from being served now.

```bash
npx vitest run tests/cache.test.ts tests/compositor-framecache.test.ts
```

`tests/compositor-framecache.test.ts` asserted the two paths differ and no longer has a subject — delete it and note in the commit message that its purpose ended with the second path.

```bash
git commit -s -m "refactor(cache): drop the compositor discriminator, bump cache version"
```

- [ ] **Step 6: Update the docs**

Sweep `docs/` for anything describing DOM composition, CSS-based layering, or `KINO_COMPOSITOR`. `backgrounds-and-overlays.md`, `motion-graphics.md` and `build-and-preview.md` are the likely ones. Motion graphics are still authored as HTML — that has not changed and the docs must not imply it has. What changed is that they are rasterized into a layer rather than composited by the browser, which matters to authors in exactly one way: nested `<canvas>` elements and external image references are handled specially (phase 1 Tasks 9 and 12). Say that plainly.

```bash
git add docs/
git commit -s -m "docs: describe the compositor as the render path"
```

- [ ] **Step 7: Update the spec's status**

In `docs/superpowers/specs/2026-07-25-gl-compositor-design.md`:

```markdown
**Status:** implemented — phases 1-4 complete, DOM path removed
```

```bash
git add docs/superpowers/specs/2026-07-25-gl-compositor-design.md
git commit -s -m "docs(spec): mark the GL compositor implemented"
```

- [ ] **Step 8: Final verification**

```bash
npm run build && npx vitest run
```

Then build one real spec end to end and watch it — the last check is a human one, on a finished MP4.

```bash
npx kino build <typical-spec.json>
```
