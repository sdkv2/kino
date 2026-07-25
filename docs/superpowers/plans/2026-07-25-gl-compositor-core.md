# GL Compositor Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render every kino frame through one WebGL2 stage where each composition layer is a texture, at perceptual parity with today's DOM composition, behind `KINO_COMPOSITOR=1`.

**Architecture:** The React tree becomes a hidden staging DOM; the only visible element is one `<canvas id="kino-stage">`. `kinoSeek(n)` splits into an async resolve phase (compute the layer list, prepare every texture) and a synchronous draw phase (bind, transform, blend, present). Layer geometry moves out of JSX into `layersAt(props, frame, dims)`, a pure node-testable function.

**Tech Stack:** TypeScript (strict), React 18 (staging DOM only), WebGL2, esbuild (page bundle), puppeteer, vitest, ImageMagick (`magick`).

## Global Constraints

- **Blocked on the spike.** Do not start until `docs/superpowers/specs/2026-07-25-gl-compositor-spike-REPORT.md` records a **proceed** verdict.
- `src/render/native/page/KinoVideo.tsx` and `components.tsx` are **read-only** for the whole plan. They are the parity reference; editing them invalidates every comparison.
- `KINO_COMPOSITOR` defaults to off. Every task must leave the DOM path working and the full suite green.
- Blending happens in **sRGB**, never linear. Uploads use `UNPACK_PREMULTIPLY_ALPHA_WEBGL = true` and `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)`.
- WebGL2 contexts are created with `{preserveDrawingBuffer: true, premultipliedAlpha: true, antialias: false}` — the convention in `RegionShader.tsx:290` and `liquidGlass.ts:250`.
- Everything is a pure function of the frame index. No `Date.now()`, no `Math.random()`, no `requestAnimationFrame`, no wall clock anywhere in the render path.
- Parity gate: `meanDiff ≤ 0.01` against the DOM path. Self-determinism gate: the same frame rendered twice is `meanDiff === 0`.
- The CLI runs compiled `dist/`, not `src/` — run `npm run build` before any test that goes through the CLI, or new fields are silently stripped.
- Commit messages need a DCO sign-off (`git commit -s`); PRs are blocked without one.

## File Structure

| File | Responsibility |
|---|---|
| `src/render/layers.ts` | `layersAt` — pure layer geometry. Outside `page/` so node tests import it without a browser. |
| `src/render/native/page/compositor/graph.ts` | `LayerDraw`, `TextureRef`, `MaskRef`, `EffectRef`, `TextureSource` types. No logic. |
| `src/render/native/page/compositor/renderer.ts` | `StageRenderer` — quad program, transform, blend, FBO, present. |
| `src/render/native/page/compositor/registry.ts` | `SourceRegistry` — builds and owns one `TextureSource` per layer id. |
| `src/render/native/page/compositor/rasterPolicy.ts` | `classifyRaster` — static / keyed / dynamic. |
| `src/render/native/page/compositor/inline.ts` | `inlineExternalRefs` — external references → data URLs. |
| `src/render/native/page/compositor/providers/*.ts` | One file per provider: `image`, `frames`, `canvas2d`, `shader`, `region`, `html`, plus `upload` (shared texture upload) and `nested` (canvas lifting). |
| `src/render/native/page/compositor/textMarkup.ts` | HTML-string ports of the text layers in `components.tsx`. |
| `src/render/backgrounds/glow.ts` | Canvas2D ports of the CSS-only `glow`, `Scrim` and Ken-Burns backdrops. |
| `src/render/interpolate.ts` | `interpolate` + `Easing`, extracted from `runtime.tsx` so node tests can use them. |
| `src/render/native/page/compositor/Stage.tsx` | Mounts the canvas plus the hidden staging DOM; owns the two-phase seek. |

---

### Task 1: Layer graph types

**Files:**
- Create: `src/render/native/page/compositor/graph.ts`
- Test: `tests/compositor-graph.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `LayerDraw`, `TextureRef`, `MaskRef`, `EffectRef`, `TextureSource`, `IDENTITY_TRANSFORM`, `normalizeLayer`. Every later task imports from here.

- [ ] **Step 1: Write the failing test**

Create `tests/compositor-graph.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeLayer, IDENTITY_TRANSFORM } from "../src/render/native/page/compositor/graph.js";

describe("normalizeLayer", () => {
  it("fills defaults for a minimal layer", () => {
    const l = normalizeLayer({ id: "bg", source: { providerId: "bg" }, rect: { x: 0, y: 0, w: 1080, h: 1920 } });
    expect(l.opacity).toBe(1);
    expect(l.blend).toBe("normal");
    expect(l.transform).toEqual(IDENTITY_TRANSFORM);
    expect(l.effects).toEqual([]);
    expect(l.mask).toBeUndefined();
  });

  it("preserves explicit values", () => {
    const l = normalizeLayer({
      id: "cap", source: { providerId: "cap", key: "word-3" },
      rect: { x: 0, y: 1400, w: 1080, h: 300 },
      opacity: 0.5, blend: "screen",
      transform: { scale: 1.08, rotate: 0, translate: [0, -12] },
    });
    expect(l.opacity).toBe(0.5);
    expect(l.blend).toBe("screen");
    expect(l.transform.scale).toBe(1.08);
    expect(l.source.key).toBe("word-3");
  });

  it("clamps opacity into 0..1", () => {
    expect(normalizeLayer({ id: "a", source: { providerId: "a" }, rect: { x: 0, y: 0, w: 1, h: 1 }, opacity: 1.5 }).opacity).toBe(1);
    expect(normalizeLayer({ id: "a", source: { providerId: "a" }, rect: { x: 0, y: 0, w: 1, h: 1 }, opacity: -3 }).opacity).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/compositor-graph.test.ts
```

Expected: FAIL — cannot resolve `compositor/graph.js`.

- [ ] **Step 3: Write the types**

Create `src/render/native/page/compositor/graph.ts`:

```ts
// The compositor's layer graph. Pure types plus one normalizer — no GL, no DOM, so both
// node-side tests and the page bundle import it freely.

/** Which source produces this layer's pixels, and which variant of it. */
export interface TextureRef {
  providerId: string; // registry key — "bg", "av0", "seg2", "motion2", "caption", …
  key?: string;       // content key within the provider: caption word index, scrub value, …
}

/** Phase-2 seam. Threaded through the renderer as a no-op in phase 1. */
export interface MaskRef {
  providerId: string;
  channel: "r" | "g" | "b" | "a" | "luma";
  invert?: boolean;
  feather?: number; // px, resolved against the SDF when the source has one
}

/** Phase-2 seam. Threaded through the renderer as a no-op in phase 1. */
export interface EffectRef {
  kind: string;
  params: Record<string, number | string>;
}

export type BlendMode = "normal" | "screen" | "multiply" | "add";

export interface LayerTransform {
  scale: number;
  rotate: number;          // degrees, about the rect center
  translate: [number, number]; // px
}

export interface LayerDraw {
  id: string;
  source: TextureRef;
  rect: { x: number; y: number; w: number; h: number }; // frame px, top-left origin
  transform: LayerTransform;
  opacity: number;
  blend: BlendMode;
  effects: EffectRef[];
  mask?: MaskRef;
}

/** What `layersAt` may omit; `normalizeLayer` fills the rest. */
export type LayerSpec = Pick<LayerDraw, "id" | "source" | "rect"> &
  Partial<Omit<LayerDraw, "id" | "source" | "rect">>;

/** Composition pixel dimensions. Defined once here — layers.ts, registry.ts and Stage.tsx
 *  all import this rather than declaring their own structurally-identical copy. */
export interface Dims {
  width: number;
  height: number;
}

export const IDENTITY_TRANSFORM: LayerTransform = { scale: 1, rotate: 0, translate: [0, 0] };

export function normalizeLayer(spec: LayerSpec): LayerDraw {
  return {
    id: spec.id,
    source: spec.source,
    rect: spec.rect,
    transform: spec.transform ?? IDENTITY_TRANSFORM,
    opacity: Math.min(1, Math.max(0, spec.opacity ?? 1)),
    blend: spec.blend ?? "normal",
    effects: spec.effects ?? [],
    mask: spec.mask,
  };
}

/**
 * A layer's pixel source. `prepare` runs in the async resolve phase and may raster, decode
 * or fetch; `texture` runs in the synchronous draw phase and must not await anything.
 */
export interface TextureSource {
  prepare(frame: number, key?: string): Promise<void>;
  texture(gl: WebGL2RenderingContext, frame: number, key?: string): WebGLTexture | null;
  /** Natural pixel size when the source knows it; null means "use the layer rect". */
  size(): { w: number; h: number } | null;
  dispose?(): void;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/compositor-graph.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render/native/page/compositor/graph.ts tests/compositor-graph.test.ts
git commit -s -m "feat(compositor): layer graph types and normalizer"
```

---

### Task 2: `layersAt` — backdrop and avatar windows

**Files:**
- Create: `src/render/layers.ts`
- Test: `tests/layers-backdrop.test.ts`

**Interfaces:**
- Consumes: `LayerDraw`, `LayerSpec`, `normalizeLayer` from `compositor/graph.js`.
- Produces: `layersAt(props: KinoProps, frame: number, dims: { width: number; height: number }): LayerDraw[]`. Tasks 3–5 extend this same function.

The port target is the layer order documented at the top of `KinoVideo.tsx`. This task covers layers 1–3: night fill, brand backdrop, avatar windows.

- [ ] **Step 1: Write the failing test**

Create `tests/layers-backdrop.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { layersAt } from "../src/render/layers.js";
import type { KinoProps } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
};
const bg = {
  kind: "glow" as const, image: null, customCode: null, shaderCode: null,
  params: {}, keyframes: [], triggers: [],
};
const DIMS = { width: 1080, height: 1920 };

const base: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: bg, disclosure: "", segments: [],
};

describe("layersAt — backdrop", () => {
  it("always emits the brand backdrop as the bottom layer, full frame", () => {
    const layers = layersAt(base, 0, DIMS);
    expect(layers[0].id).toBe("backdrop");
    expect(layers[0].source.providerId).toBe("backdrop");
    expect(layers[0].rect).toEqual({ x: 0, y: 0, w: 1080, h: 1920 });
    expect(layers[0].opacity).toBe(1);
  });

  it("emits no avatar layer when there is no avatar", () => {
    expect(layersAt(base, 0, DIMS).some((l) => l.id.startsWith("av"))).toBe(false);
  });
});

describe("layersAt — avatar windows", () => {
  const withAvatar: KinoProps = {
    ...base,
    avatar: { src: "avatar.mp4" } as unknown as KinoProps["avatar"],
    avatarWindows: [{ fromSec: 1, toSec: 3, audioStartSec: 0 }],
  };

  it("emits the avatar clip only inside its window", () => {
    expect(layersAt(withAvatar, 0, DIMS).some((l) => l.id === "av0")).toBe(false);   // 0.00s
    expect(layersAt(withAvatar, 45, DIMS).some((l) => l.id === "av0")).toBe(true);   // 1.50s
    expect(layersAt(withAvatar, 95, DIMS).some((l) => l.id === "av0")).toBe(false);  // 3.17s
  });

  it("applies the push-in: scale 1.0 at window start rising to 1.08 at window end", () => {
    const at = (f: number) => layersAt(withAvatar, f, DIMS).find((l) => l.id === "av0")!;
    expect(at(30).transform.scale).toBeCloseTo(1.0, 5);   // window frame 0
    expect(at(89).transform.scale).toBeCloseTo(1.08, 2);  // window frame 59 of 60
  });

  it("sits directly above the backdrop", () => {
    const layers = layersAt(withAvatar, 45, DIMS);
    expect(layers.map((l) => l.id).slice(0, 2)).toEqual(["backdrop", "av0"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/layers-backdrop.test.ts
```

Expected: FAIL — cannot resolve `src/render/layers.js`.

- [ ] **Step 3: Write the implementation**

Create `src/render/layers.ts`:

```ts
// Layer geometry for the WebGL compositor: the composition expressed as an ordered list of
// textured quads instead of a React tree. Pure — same inputs, same list, no DOM and no GL —
// so beat windows, crossfades and camera moves are unit-testable numbers.
//
// Layer order mirrors the stack documented at the top of native/page/KinoVideo.tsx.
import type { KinoProps } from "./props.js";
import { interpolate } from "./interpolate.js";
import { normalizeLayer, type Dims, type LayerDraw, type LayerSpec } from "./native/page/compositor/graph.js";

export type { Dims };

/** The avatar clip's gentle push-in over its window (KinoVideo.tsx AvatarClip). */
const AVATAR_PUSH_IN = 1.08;

export function layersAt(props: KinoProps, frame: number, dims: Dims): LayerDraw[] {
  const { width, height } = dims;
  const full = { x: 0, y: 0, w: width, h: height };
  const f = (sec: number) => Math.round(sec * props.fps);
  const out: LayerSpec[] = [];

  // 1–2. Night fill and brand backdrop are one source: the background provider paints the
  // night colour before it draws, exactly as CanvasBackground does today.
  out.push({ id: "backdrop", source: { providerId: "backdrop" }, rect: full });

  // 3. Avatar windows.
  if (props.avatar) {
    props.avatarWindows.forEach((w, i) => {
      const from = f(w.fromSec);
      const dur = f(w.toSec) - from;
      const local = frame - from;
      if (local < 0 || local >= dur) return;
      const scale = interpolate(local, [0, dur], [1, AVATAR_PUSH_IN], { extrapolateRight: "clamp" });
      out.push({
        id: `av${i}`,
        source: { providerId: `av${i}` },
        rect: full,
        transform: { scale, rotate: 0, translate: [0, 0] },
      });
    });
  }

  return out.map(normalizeLayer);
}
```

- [ ] **Step 4: Extract `interpolate` so node and page share one implementation**

`interpolate` currently lives in `native/page/runtime.tsx`, which imports React and cannot be loaded by a node test. Create `src/render/interpolate.ts` containing the `interpolate` function, `InterpolateOptions`, `Extrapolate` and the `Easing` object copied **verbatim** from `runtime.tsx` (lines beginning at the `--- interpolate ---` banner through the end of the `Easing` object).

Then in `runtime.tsx`, delete those definitions and re-export instead, so there is exactly one implementation:

```tsx
export { interpolate, Easing, type InterpolateOptions } from "../../interpolate.js";
```

Leave `spring` and `springValue` in `runtime.tsx` — nothing in `layers.ts` needs them.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run tests/layers-backdrop.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Verify the extraction broke nothing**

```bash
npx vitest run
```

Expected: the full suite passes. `interpolate` is used throughout `components.tsx` and `KinoVideo.tsx`; if any of those tests fail, the copy was not verbatim.

- [ ] **Step 7: Commit**

```bash
git add src/render/layers.ts src/render/interpolate.ts src/render/native/page/runtime.tsx tests/layers-backdrop.test.ts
git commit -s -m "feat(compositor): layersAt for backdrop and avatar windows"
```

---

### Task 3: `layersAt` — video beats

**Files:**
- Modify: `src/render/layers.ts`
- Test: `tests/layers-video.test.ts`

**Interfaces:**
- Consumes: `layersAt` from Task 2.
- Produces: layer ids `seg<i>` (footage), `frame<i>` (chrome overlay), `kicker<i>`.

Ports the `kind === "video"` branch of `KinoVideo.tsx`, including the chained-cutaway hold: when the next beat is also a video beat, this beat's sequence extends to `next.startSec + 12 frames` instead of ending at its own `endSec`, and the successor fades in over that overlap.

- [ ] **Step 1: Write the failing test**

Create `tests/layers-video.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { layersAt } from "../src/render/layers.js";
import type { KinoProps, KinoSegment } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
};
const bg = { kind: "glow" as const, image: null, customCode: null, shaderCode: null, params: {}, keyframes: [], triggers: [] };
const DIMS = { width: 1080, height: 1920 };

const seg = (over: Partial<KinoSegment>): KinoSegment => ({
  kind: "video", caption: "", startSec: 0, endSec: 2, source: "clip.mp4", ...over,
});

const mk = (segments: KinoSegment[]): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: bg, disclosure: "", segments,
});

describe("layersAt — video beats", () => {
  it("emits the footage layer inside the beat and not outside it", () => {
    const p = mk([seg({ startSec: 1, endSec: 3 })]);
    expect(layersAt(p, 15, DIMS).some((l) => l.id === "seg0")).toBe(false);
    expect(layersAt(p, 45, DIMS).some((l) => l.id === "seg0")).toBe(true);
    expect(layersAt(p, 95, DIMS).some((l) => l.id === "seg0")).toBe(false);
  });

  it("holds a chained clip 12 frames into its successor", () => {
    const p = mk([seg({ startSec: 0, endSec: 2 }), seg({ startSec: 2, endSec: 4 })]);
    // At 2.2s the second beat is live and the first is still held (12-frame overlap from f=60).
    const ids = layersAt(p, 66, DIMS).map((l) => l.id);
    expect(ids).toContain("seg0");
    expect(ids).toContain("seg1");
    // Past the overlap the first is gone.
    expect(layersAt(p, 80, DIMS).map((l) => l.id)).not.toContain("seg0");
  });

  it("fades the successor in over the overlap", () => {
    const p = mk([seg({ startSec: 0, endSec: 2 }), seg({ startSec: 2, endSec: 4 })]);
    const op = (f: number) => layersAt(p, f, DIMS).find((l) => l.id === "seg1")!.opacity;
    expect(op(60)).toBeCloseTo(0, 2);
    expect(op(72)).toBeCloseTo(1, 2);
  });

  it("emits the chrome frame above the footage when the beat has one", () => {
    const p = mk([seg({ frame: { src: "phone.png", inset: { x: 10, y: 12, w: 80, h: 76 } } })]);
    const ids = layersAt(p, 15, DIMS).map((l) => l.id);
    expect(ids.indexOf("frame0")).toBeGreaterThan(ids.indexOf("seg0"));
  });

  it("insets the footage to the chrome window, in frame px", () => {
    const p = mk([seg({ frame: { src: "phone.png", inset: { x: 10, y: 12, w: 80, h: 76 } } })]);
    const rect = layersAt(p, 15, DIMS).find((l) => l.id === "seg0")!.rect;
    expect(rect).toEqual({ x: 108, y: 230.4, w: 864, h: 1459.2 });
  });

  it("emits a kicker layer when the beat has one", () => {
    const p = mk([seg({ kicker: { text: "NEW", color: "#0c8d64", fg: "#fff" } })]);
    expect(layersAt(p, 15, DIMS).some((l) => l.id === "kicker0")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/layers-video.test.ts
```

Expected: FAIL — no `seg0` layer is produced.

- [ ] **Step 3: Implement the video branch**

In `src/render/layers.ts`, add above `layersAt`:

```ts
/** Chained-cutaway hold: a held clip extends this many frames into its successor. */
const CHAIN_HOLD_FRAMES = 12;
```

and inside `layersAt`, after the avatar block:

```ts
  // 4. Video beats: footage, optional chrome frame, optional kicker.
  props.segments.forEach((s, i) => {
    if (s.kind !== "video") return;
    const from = f(s.startSec);
    const next = props.segments[i + 1];
    const chained = next?.kind === "video";
    const seqDur = chained ? f(next.startSec) - from + CHAIN_HOLD_FRAMES : f(s.endSec) - from;
    const local = frame - from;
    if (local < 0 || local >= seqDur) return;

    // A chained successor fades in over the overlap its predecessor is held through.
    const prev = props.segments[i - 1];
    const fadesIn = prev?.kind === "video";
    const opacity = fadesIn
      ? interpolate(local, [0, CHAIN_HOLD_FRAMES], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      : 1;

    const inset = s.frame?.inset;
    const rect = inset
      ? { x: (inset.x / 100) * width, y: (inset.y / 100) * height, w: (inset.w / 100) * width, h: (inset.h / 100) * height }
      : full;

    out.push({ id: `seg${i}`, source: { providerId: `seg${i}` }, rect, opacity });
    if (s.frame) out.push({ id: `frame${i}`, source: { providerId: `frame${i}` }, rect: full, opacity });
    if (s.kicker) out.push({ id: `kicker${i}`, source: { providerId: `kicker${i}` }, rect: full, opacity });
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/layers-video.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render/layers.ts tests/layers-video.test.ts
git commit -s -m "feat(compositor): layersAt for video beats, chrome frames and kickers"
```

---

### Task 4: `layersAt` — motion beats and overlays

**Files:**
- Modify: `src/render/layers.ts`
- Test: `tests/layers-motion.test.ts`

**Interfaces:**
- Consumes: `layersAt` from Task 3, `MOTION_XFADE_FRAMES` from `src/render/motion.js`.
- Produces: layer ids `motion<i>` (full-screen motion beats) and `overlay<i>` (per-beat motion overlays).

- [ ] **Step 1: Write the failing test**

Create `tests/layers-motion.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { layersAt } from "../src/render/layers.js";
import { MOTION_XFADE_FRAMES } from "../src/render/motion.js";
import type { KinoProps, KinoSegment } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
};
const bg = { kind: "glow" as const, image: null, customCode: null, shaderCode: null, params: {}, keyframes: [], triggers: [] };
const DIMS = { width: 1080, height: 1920 };
const motion = { html: "<div></div>", params: {}, keyframes: [], triggers: [] };

const mk = (segments: KinoSegment[]): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: bg, disclosure: "", segments,
});

describe("layersAt — motion beats", () => {
  it("emits a motion layer for a motion beat, inside its window only", () => {
    const p = mk([{ kind: "motion", caption: "", startSec: 1, endSec: 3, motion }]);
    expect(layersAt(p, 15, DIMS).some((l) => l.id === "motion0")).toBe(false);
    expect(layersAt(p, 45, DIMS).some((l) => l.id === "motion0")).toBe(true);
  });

  it("keeps the first motion beat opaque at its start — no loop-seam fade", () => {
    const p = mk([{ kind: "motion", caption: "", startSec: 0, endSec: 2, motion }]);
    expect(layersAt(p, 0, DIMS).find((l) => l.id === "motion0")!.opacity).toBe(1);
  });

  it("dissolves a motion beat that follows another motion beat", () => {
    const p = mk([
      { kind: "motion", caption: "", startSec: 0, endSec: 2, motion },
      { kind: "motion", caption: "", startSec: 2, endSec: 4, motion },
    ]);
    const op = (f: number) => layersAt(p, f, DIMS).find((l) => l.id === "motion1")!.opacity;
    expect(op(60)).toBeCloseTo(0, 2);
    expect(op(60 + MOTION_XFADE_FRAMES)).toBeCloseTo(1, 2);
  });

  it("emits an overlay layer above the beat's own content", () => {
    const p = mk([{ kind: "video", caption: "", startSec: 0, endSec: 2, source: "c.mp4", motionOverlay: motion }]);
    const ids = layersAt(p, 15, DIMS).map((l) => l.id);
    expect(ids.indexOf("overlay0")).toBeGreaterThan(ids.indexOf("seg0"));
  });

  it("passes the beat-local frame as the source key so the raster scrubs per beat", () => {
    const p = mk([{ kind: "motion", caption: "", startSec: 1, endSec: 3, motion }]);
    expect(layersAt(p, 45, DIMS).find((l) => l.id === "motion0")!.source.key).toBe("15");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/layers-motion.test.ts
```

Expected: FAIL — no `motion0` layer.

- [ ] **Step 3: Implement the motion branches**

At the top of `src/render/layers.ts`, add the import:

```ts
import { MOTION_XFADE_FRAMES } from "./motion.js";
```

Inside `layersAt`, after the video block:

```ts
  // 5. Full-screen motion beats. A motion beat that follows another dissolves in over the
  // overlap; the first one stays opaque so a looping open has no seam.
  props.segments.forEach((s, i) => {
    if (s.kind !== "motion" || !s.motion) return;
    const from = f(s.startSec);
    const dur = f(s.endSec) - from;
    const local = frame - from;
    if (local < 0 || local >= dur) return;
    const fadeIn = props.segments[i - 1]?.kind === "motion";
    const opacity = fadeIn
      ? interpolate(local, [0, MOTION_XFADE_FRAMES], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      : 1;
    out.push({
      id: `motion${i}`,
      source: { providerId: `motion${i}`, key: String(local) },
      rect: full,
      opacity,
    });
  });

  // 6. Motion overlays: layered above whatever their beat drew.
  props.segments.forEach((s, i) => {
    if (!s.motionOverlay) return;
    const from = f(s.startSec);
    const dur = f(s.endSec) - from;
    const local = frame - from;
    if (local < 0 || local >= dur) return;
    out.push({
      id: `overlay${i}`,
      source: { providerId: `overlay${i}`, key: String(local) },
      rect: full,
    });
  });
```

The `source.key` is the beat-local frame: the `html` provider uses it as its scrub value and as its cache key, so a `keyed` layer that resolves to the same content reuses one raster.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/layers-motion.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render/layers.ts tests/layers-motion.test.ts
git commit -s -m "feat(compositor): layersAt for motion beats and overlays"
```

---

### Task 5: `layersAt` — text, logo, captions, disclosure, film finish

**Files:**
- Modify: `src/render/layers.ts`
- Test: `tests/layers-captions.test.ts`

**Interfaces:**
- Consumes: `layersAt` from Task 4, `captionBandBottom`, `hasCaptionContent`, `isHeroCaption` from `src/render/captionLayout.js`.
- Produces: layer ids `text<i>_<j>`, `logo`, `caption<i>`, `disclosure`, `film`. This completes `layersAt` — Tasks 6+ consume it unchanged.

This is where the transform hoist earns its keep: the caption's per-word pop becomes `transform`/`opacity` on the quad, and `source.key` is the **active word index**, not the frame. A caption re-rasters once per word.

- [ ] **Step 1: Write the failing test**

Create `tests/layers-captions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { layersAt } from "../src/render/layers.js";
import type { KinoProps, KinoSegment } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
};
const bg = { kind: "glow" as const, image: null, customCode: null, shaderCode: null, params: {}, keyframes: [], triggers: [] };
const DIMS = { width: 1080, height: 1920 };

const mk = (segments: KinoSegment[], over: Partial<KinoProps> = {}): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: bg, disclosure: "", segments, ...over,
});

const wordsBeat: KinoSegment = {
  kind: "scene", caption: "ship it fast", startSec: 0, endSec: 3, captionMode: "words",
  words: [
    { word: "ship", start: 0.0, end: 0.5 },
    { word: "it", start: 0.5, end: 0.9 },
    { word: "fast", start: 0.9, end: 1.6 },
  ],
};

describe("layersAt — captions", () => {
  it("keys the caption by active word index, not by frame", () => {
    const p = mk([wordsBeat]);
    const key = (f: number) => layersAt(p, f, DIMS).find((l) => l.id === "caption0")!.source.key;
    expect(key(3)).toBe("w0");
    expect(key(9)).toBe("w0");   // same word, same key → one raster serves both frames
    expect(key(20)).toBe("w1");
    expect(key(35)).toBe("w2");
  });

  it("emits no caption layer for a beat with no caption content", () => {
    const p = mk([{ kind: "scene", caption: "", startSec: 0, endSec: 2 }]);
    expect(layersAt(p, 15, DIMS).some((l) => l.id === "caption0")).toBe(false);
  });

  it("emits the logo only on presenter-less beats", () => {
    const withLogo = { src: "logo.png", sizePx: 120, x: 60, y: 60, keyframes: [], fromSec: 0 } as unknown as KinoProps["logo"];
    const p = mk([{ kind: "scene", caption: "hi", startSec: 0, endSec: 2 }], { logo: withLogo });
    expect(layersAt(p, 15, DIMS).some((l) => l.id === "logo")).toBe(true);
    const pAvatar = mk([{ kind: "scene", caption: "hi", startSec: 0, endSec: 2 }], {
      logo: withLogo,
      avatar: { src: "a.mp4" } as unknown as KinoProps["avatar"],
      avatarWindows: [{ fromSec: 0, toSec: 2, audioStartSec: 0 }],
    });
    expect(layersAt(pAvatar, 15, DIMS).some((l) => l.id === "logo")).toBe(false);
  });

  it("puts the disclosure and film finish last, in that order", () => {
    const p = mk([{ kind: "scene", caption: "hi", startSec: 0, endSec: 2 }], { disclosure: "AI generated" });
    const ids = layersAt(p, 15, DIMS).map((l) => l.id);
    expect(ids.slice(-2)).toEqual(["disclosure", "film"]);
  });

  it("omits the film finish when theme.film is 0", () => {
    const p = mk([{ kind: "scene", caption: "hi", startSec: 0, endSec: 2 }], { theme: { ...theme, film: 0 } });
    expect(layersAt(p, 15, DIMS).some((l) => l.id === "film")).toBe(false);
  });

  it("emits standalone text overlays keyed per beat and index", () => {
    const p = mk([{
      kind: "scene", caption: "", startSec: 0, endSec: 4,
      texts: [{ text: "one", fromSec: 0, toSec: 2 }, { text: "two", fromSec: 2, toSec: 4 }] as unknown as KinoSegment["texts"],
    }]);
    expect(layersAt(p, 15, DIMS).some((l) => l.id === "text0_0")).toBe(true);
    expect(layersAt(p, 15, DIMS).some((l) => l.id === "text0_1")).toBe(false);
    expect(layersAt(p, 90, DIMS).some((l) => l.id === "text0_1")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/layers-captions.test.ts
```

Expected: FAIL — no `caption0` layer.

- [ ] **Step 3: Implement the remaining layers**

Add to the imports in `src/render/layers.ts`:

```ts
import { hasCaptionContent } from "./captionLayout.js";
```

Inside `layersAt`, after the overlay block:

```ts
  // 7. Standalone text overlays (spec `texts[]`), absolute-timed.
  props.segments.forEach((s, i) => {
    s.texts?.forEach((t, j) => {
      const from = f(t.fromSec);
      const to = f(t.toSec);
      if (frame < from || frame >= to) return;
      out.push({ id: `text${i}_${j}`, source: { providerId: `text${i}_${j}` }, rect: full });
    });
  });

  // 8. Logo — presenter-less beats only (the avatar covers it on camera).
  if (props.logo) {
    const onCamera = props.avatar
      ? props.avatarWindows.some((w) => frame >= f(w.fromSec) && frame < f(w.toSec))
      : false;
    if (!onCamera && frame >= f(props.logo.fromSec)) {
      out.push({ id: "logo", source: { providerId: "logo" }, rect: full });
    }
  }

  // 9. Captions. The raster is keyed by the ACTIVE WORD, not the frame: a words-mode caption
  // re-rasters once per spoken word, and the per-word pop rides the quad instead.
  props.segments.forEach((s, i) => {
    const from = f(s.startSec);
    const dur = f(s.endSec) - from;
    const local = frame - from;
    if (local < 0 || local >= dur) return;
    if (!hasCaptionContent(s)) return;

    let key = "phrase";
    if (s.captionMode === "words" && s.words?.length) {
      const tAbs = frame / props.fps;
      let idx = 0;
      for (let w = 0; w < s.words.length; w++) if (tAbs >= s.words[w].start) idx = w;
      key = `w${idx}`;
    }
    out.push({ id: `caption${i}`, source: { providerId: `caption${i}`, key }, rect: full });
  });

  // 10. AI disclosure.
  if (props.disclosure) {
    out.push({ id: "disclosure", source: { providerId: "disclosure" }, rect: full });
  }

  // 11. Cinematic finish — vignette and grain over everything. `theme.film === 0` disables it.
  if ((props.theme.film ?? 1) > 0) {
    out.push({ id: "film", source: { providerId: "film" }, rect: full, blend: "normal" });
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/layers-captions.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Run the whole layers suite**

```bash
npx vitest run tests/layers-backdrop.test.ts tests/layers-video.test.ts tests/layers-motion.test.ts tests/layers-captions.test.ts
```

Expected: PASS, 22 tests.

- [ ] **Step 6: Commit**

```bash
git add src/render/layers.ts tests/layers-captions.test.ts
git commit -s -m "feat(compositor): layersAt for text, logo, captions, disclosure and film"
```

---

### Task 6: The stage renderer

**Files:**
- Create: `src/render/native/page/compositor/renderer.ts`
- Test: `tests/compositor-renderer.test.ts`

**Interfaces:**
- Consumes: `LayerDraw`, `TextureSource` from `graph.js`.
- Produces: `class StageRenderer` with `constructor(canvas: HTMLCanvasElement, opts: { width: number; height: number; ss: number })`, `draw(layers: LayerDraw[], sources: Map<string, TextureSource>, frame: number): void`, and `dispose(): void`.

- [ ] **Step 1: Write the failing test**

The renderer needs a real GL context, so this test drives it through puppeteer with the same swiftshader flags the engine uses. Create `tests/compositor-renderer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";

async function inPage<T>(fn: (js: string) => Promise<T>): Promise<T> {
  const bundle = await build({
    entryPoints: ["src/render/native/page/compositor/renderer.ts"],
    bundle: true, write: false, format: "iife", globalName: "KinoRenderer",
    platform: "browser", target: "chrome120", logLevel: "silent",
  });
  return fn(bundle.outputFiles[0].text);
}

describe("StageRenderer", () => {
  it("composites two solid layers in order, with alpha, in sRGB", async () => {
    const js = await inPage(async (js) => js);
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 200, height: 200 });
      await page.setContent(`<!doctype html><body style="margin:0"><canvas id="c" width="200" height="200"></canvas></body>`);
      await page.addScriptTag({ content: js });

      const px = await page.evaluate(() => {
        const solid = (color: string) => {
          const c = document.createElement("canvas");
          c.width = 200; c.height = 200;
          const ctx = c.getContext("2d")!;
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 200, 200);
          return c;
        };
        const src = (canvas: HTMLCanvasElement) => {
          let tex: WebGLTexture | null = null;
          return {
            prepare: async () => {},
            size: () => ({ w: 200, h: 200 }),
            texture: (gl: WebGL2RenderingContext) => {
              if (!tex) {
                tex = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
              }
              return tex;
            },
          };
        };
        const canvas = document.getElementById("c") as HTMLCanvasElement;
        const r = new (window as any).KinoRenderer.StageRenderer(canvas, { width: 200, height: 200, ss: 1 });
        const sources = new Map<string, any>([
          ["a", src(solid("#000000"))],
          ["b", src(solid("#ffffff"))],
        ]);
        const layer = (id: string, opacity: number) => ({
          id, source: { providerId: id }, rect: { x: 0, y: 0, w: 200, h: 200 },
          transform: { scale: 1, rotate: 0, translate: [0, 0] }, opacity, blend: "normal", effects: [],
        });
        r.draw([layer("a", 1), layer("b", 0.5)], sources, 0);

        const read = document.createElement("canvas");
        read.width = 200; read.height = 200;
        read.getContext("2d")!.drawImage(canvas, 0, 0);
        const d = read.getContext("2d")!.getImageData(100, 100, 1, 1).data;
        return [d[0], d[1], d[2]];
      });

      // White at 50% over black, blended in sRGB, is 128 — not 188 (which is what
      // linear-space blending would produce).
      expect(px[0]).toBeGreaterThanOrEqual(126);
      expect(px[0]).toBeLessThanOrEqual(130);
    } finally {
      await browser.close();
    }
  }, 120000);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/compositor-renderer.test.ts
```

Expected: FAIL — cannot resolve `compositor/renderer.ts`.

- [ ] **Step 3: Write the renderer**

Create `src/render/native/page/compositor/renderer.ts`:

```ts
// The stage renderer: an ordered list of textured quads drawn into one WebGL2 surface.
// Blending is sRGB with premultiplied alpha, matching CSS compositing semantics — linear
// blending would shift every existing spec.
//
// Everything here runs in the SYNCHRONOUS draw phase. No awaits, no decodes, no layout:
// sources have already been prepared by the time draw() is called.
import type { BlendMode, LayerDraw, TextureSource } from "./graph.js";

const VERT = `#version 300 es
// Unit quad from gl_VertexID, positioned by a 3x3 model matrix in pixel space.
uniform mat3 uModel;
uniform vec2 uRes;
out vec2 vUv;
void main() {
  vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 0.5;  // 0,0 / 1,0 / 0,1
  vec2 quad = vec2(corner.x > 0.5 ? 1.0 : 0.0, corner.y > 0.5 ? 1.0 : 0.0);
  vUv = quad;
  vec3 p = uModel * vec3(quad, 1.0);
  vec2 clip = (p.xy / uRes) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);  // y-down pixel space → clip space
}`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uOpacity;
in vec2 vUv;
out vec4 kino_frag;
void main() {
  vec4 c = texture(uTex, vUv);
  kino_frag = c * uOpacity;   // premultiplied — scaling the whole texel is correct
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`compositor shader failed to compile: ${gl.getShaderInfoLog(sh)}`);
  }
  return sh;
}

/** Blend equations per mode. Sources are premultiplied, so "normal" is ONE / 1-SRC_ALPHA. */
function applyBlend(gl: WebGL2RenderingContext, mode: BlendMode): void {
  gl.enable(gl.BLEND);
  switch (mode) {
    case "add":
      gl.blendFunc(gl.ONE, gl.ONE);
      break;
    case "screen":
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
      break;
    case "multiply":
      gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
      break;
    default:
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
}

/** Column-major 3x3: translate ∘ rotate ∘ scale about the rect center, in pixel space. */
function modelMatrix(layer: LayerDraw): Float32Array {
  const { x, y, w, h } = layer.rect;
  const { scale, rotate, translate } = layer.transform;
  const rad = (rotate * Math.PI) / 180;
  const cos = Math.cos(rad) * scale;
  const sin = Math.sin(rad) * scale;
  const cx = x + w / 2 + translate[0];
  const cy = y + h / 2 + translate[1];
  // unit quad → centered → scaled/rotated → placed
  const a = cos * w, b = sin * w;
  const c = -sin * h, d = cos * h;
  const tx = cx - (a + c) / 2;
  const ty = cy - (b + d) / 2;
  return new Float32Array([a, b, 0, c, d, 0, tx, ty, 1]);
}

export class StageRenderer {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private uModel: WebGLUniformLocation;
  private uRes: WebGLUniformLocation;
  private uOpacity: WebGLUniformLocation;
  private uTex: WebGLUniformLocation;
  readonly width: number;
  readonly height: number;

  constructor(canvas: HTMLCanvasElement, opts: { width: number; height: number; ss: number }) {
    this.width = opts.width;
    this.height = opts.height;
    canvas.width = opts.width;
    canvas.height = opts.height;
    const gl = canvas.getContext("webgl2", {
      preserveDrawingBuffer: true,
      premultipliedAlpha: true,
      antialias: false,
      alpha: false,
    });
    if (!gl) throw new Error("compositor: WebGL2 unavailable");
    this.gl = gl;

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`compositor program failed to link: ${gl.getProgramInfoLog(prog)}`);
    }
    this.prog = prog;
    this.uModel = gl.getUniformLocation(prog, "uModel")!;
    this.uRes = gl.getUniformLocation(prog, "uRes")!;
    this.uOpacity = gl.getUniformLocation(prog, "uOpacity")!;
    this.uTex = gl.getUniformLocation(prog, "uTex")!;
  }

  draw(layers: LayerDraw[], sources: Map<string, TextureSource>, frame: number): void {
    const gl = this.gl;
    // Full state reset every frame — a leaked flag from a provider's own program would make
    // output depend on draw history, which breaks determinism.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.prog);
    gl.uniform2f(this.uRes, this.width, this.height);
    gl.uniform1i(this.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);

    for (const layer of layers) {
      const source = sources.get(layer.source.providerId);
      if (!source) continue;
      const tex = source.texture(gl, frame, layer.source.key);
      if (!tex) continue;
      // A provider may have bound its own program/framebuffer while producing its texture.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(this.prog);
      applyBlend(gl, layer.blend);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniformMatrix3fv(this.uModel, false, modelMatrix(layer));
      gl.uniform1f(this.uOpacity, layer.opacity);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.finish();
  }

  dispose(): void {
    this.gl.deleteProgram(this.prog);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/compositor-renderer.test.ts
```

Expected: PASS. If the sampled pixel reads ~188 instead of ~128, blending is happening in linear space — check that the canvas context was created with `premultipliedAlpha: true` and that the test's texture upload sets `UNPACK_PREMULTIPLY_ALPHA_WEBGL`.

- [ ] **Step 5: Commit**

```bash
git add src/render/native/page/compositor/renderer.ts tests/compositor-renderer.test.ts
git commit -s -m "feat(compositor): stage renderer with sRGB premultiplied blending"
```

---

### Task 7: Direct-upload providers — `image` and `frames`

**Files:**
- Create: `src/render/native/page/compositor/providers/image.ts`
- Create: `src/render/native/page/compositor/providers/frames.ts`
- Create: `src/render/native/page/compositor/providers/upload.ts`
- Test: `tests/compositor-providers-direct.test.ts`

**Interfaces:**
- Consumes: `TextureSource` from `graph.js`; `MediaMap`, `MediaEntry` from `../../media.js`.
- Produces: `uploadCanvasOrImage(gl, tex, src): WebGLTexture` from `upload.ts`; `createImageSource(url: string): TextureSource`; `createFramesSource(entry: MediaEntry): TextureSource`. Tasks 8–11 reuse `uploadCanvasOrImage`.

These are the cheap providers: video stills and static images bind straight to a texture with no raster.

- [ ] **Step 1: Write the failing test**

Create `tests/compositor-providers-direct.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { frameUrlFor } from "../src/render/native/page/compositor/providers/frames.js";
import type { MediaEntry } from "../src/render/native/page/media.js";

const entry: MediaEntry = {
  dir: "seg0",
  byFrame: { 0: "f000.png", 1: "f001.png", 2: "f002.png" },
  maxFrame: 2,
};

describe("frameUrlFor", () => {
  it("maps a local frame to its extracted still", () => {
    expect(frameUrlFor(entry, 1)).toBe("/vframes/seg0/f001.png");
  });

  it("clamps past the end — an overrun holds the last frame", () => {
    expect(frameUrlFor(entry, 99)).toBe("/vframes/seg0/f002.png");
  });

  it("clamps before the start", () => {
    expect(frameUrlFor(entry, -5)).toBe("/vframes/seg0/f000.png");
  });

  it("returns null for a sparse gap", () => {
    expect(frameUrlFor({ ...entry, byFrame: { 0: "f000.png", 2: "f002.png" } }, 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/compositor-providers-direct.test.ts
```

Expected: FAIL — cannot resolve `providers/frames.js`.

- [ ] **Step 3: Write the shared upload helper**

Create `src/render/native/page/compositor/providers/upload.ts`:

```ts
// One texture upload path for every provider — so premultiply, filtering and wrap are set
// identically everywhere. Getting any of these wrong per-provider is how edge artifacts and
// alpha mismatches creep in.
export function uploadCanvasOrImage(
  gl: WebGL2RenderingContext,
  existing: WebGLTexture | null,
  src: CanvasImageSource,
): WebGLTexture {
  const tex = existing ?? gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  return tex;
}

/** Load an <img> to completion. Rejects nothing — a broken asset yields null, matching the
 *  DOM path where a failed <img> is a blank layer rather than a crash. */
export function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
```

- [ ] **Step 4: Write the frames provider**

Create `src/render/native/page/compositor/providers/frames.ts`:

```ts
// Pre-extracted video stills. The node side wrote one image per composition-local frame
// (videoFrames.ts), so there is no <video> and no raster — just an upload.
import type { MediaEntry } from "../../media.js";
import type { TextureSource } from "../graph.js";
import { loadImage, uploadCanvasOrImage } from "./upload.js";

/** The /vframes URL for a local frame, clamped at both ends. Null on a sparse gap. */
export function frameUrlFor(entry: MediaEntry, local: number): string | null {
  const idx = Math.min(Math.max(0, local), entry.maxFrame);
  const file = entry.byFrame[idx];
  return file ? `/vframes/${entry.dir}/${file}` : null;
}

export function createFramesSource(entry: MediaEntry, fromFrame: number): TextureSource {
  const decoded = new Map<string, HTMLImageElement>();
  let tex: WebGLTexture | null = null;
  let current: string | null = null;

  return {
    async prepare(frame: number): Promise<void> {
      const url = frameUrlFor(entry, frame - fromFrame);
      current = url;
      if (!url || decoded.has(url)) return;
      const img = await loadImage(url);
      if (img) decoded.set(url, img);
    },
    texture(gl: WebGL2RenderingContext): WebGLTexture | null {
      if (!current) return null;
      const img = decoded.get(current);
      if (!img) return null;
      tex = uploadCanvasOrImage(gl, tex, img);
      return tex;
    },
    size(): { w: number; h: number } | null {
      const img = current ? decoded.get(current) : undefined;
      return img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
    },
    dispose(): void {
      decoded.clear();
    },
  };
}
```

- [ ] **Step 5: Write the image provider**

Create `src/render/native/page/compositor/providers/image.ts`:

```ts
// A static image — logo, chrome frame, background image. Decoded once, uploaded once.
import type { TextureSource } from "../graph.js";
import { loadImage, uploadCanvasOrImage } from "./upload.js";

export function createImageSource(url: string): TextureSource {
  let img: HTMLImageElement | null = null;
  let tex: WebGLTexture | null = null;
  let loaded = false;

  return {
    async prepare(): Promise<void> {
      if (loaded) return;
      loaded = true;
      img = await loadImage(url);
    },
    texture(gl: WebGL2RenderingContext): WebGLTexture | null {
      if (!img) return null;
      if (!tex) tex = uploadCanvasOrImage(gl, null, img);
      return tex;
    },
    size(): { w: number; h: number } | null {
      return img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
    },
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run tests/compositor-providers-direct.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add src/render/native/page/compositor/providers/ tests/compositor-providers-direct.test.ts
git commit -s -m "feat(compositor): direct-upload providers for images and video stills"
```

---

### Task 8: Raster policy classifier

**Files:**
- Create: `src/render/native/page/compositor/rasterPolicy.ts`
- Test: `tests/compositor-raster-policy.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type RasterCadence = "static" | "keyed" | "dynamic"` and `classifyRaster(html: string, opts: { hasTier2: boolean }): RasterCadence`. Task 10's `html` provider consumes it.

The safety property: misclassifying a `dynamic` layer as `keyed` freezes it on screen, which is a silent wrong render. Misclassifying the other way only costs time. The classifier must err toward `dynamic`, and that property is tested explicitly.

- [ ] **Step 1: Write the failing test**

Create `tests/compositor-raster-policy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyRaster } from "../src/render/native/page/compositor/rasterPolicy.js";

const noTier2 = { hasTier2: false };

describe("classifyRaster", () => {
  it("classifies inert markup as static", () => {
    expect(classifyRaster(`<div style="color:#fff">hi</div>`, noTier2)).toBe("static");
  });

  it("classifies markup reading --frame as dynamic", () => {
    expect(classifyRaster(`<style>.a{opacity:var(--frame)}</style><div class="a"></div>`, noTier2)).toBe("dynamic");
  });

  it("classifies markup reading --t, --progress or --pulse as dynamic", () => {
    expect(classifyRaster(`<style>.a{top:calc(var(--t) * 1px)}</style>`, noTier2)).toBe("dynamic");
    expect(classifyRaster(`<style>.a{transform:scale(var(--progress))}</style>`, noTier2)).toBe("dynamic");
    expect(classifyRaster(`<style>.a{filter:blur(var(--pulse))}</style>`, noTier2)).toBe("dynamic");
  });

  it("classifies Tier-2 markup as dynamic regardless of CSS", () => {
    expect(classifyRaster(`<div>static looking</div>`, { hasTier2: true })).toBe("dynamic");
  });

  it("classifies CSS animations as dynamic — they are scrubbed per frame", () => {
    expect(classifyRaster(`<style>@keyframes k{to{opacity:1}} .a{animation:k 1s}</style>`, noTier2)).toBe("dynamic");
  });

  it("classifies word-bound markup as keyed", () => {
    expect(classifyRaster(`<style>.w{color:var(--word-active)}</style>`, noTier2)).toBe("keyed");
  });

  it("errs toward dynamic on unrecognised custom properties", () => {
    // An unknown var could be frame-driven; freezing it would be a silent wrong render.
    expect(classifyRaster(`<style>.a{left:var(--mystery)}</style>`, noTier2)).toBe("dynamic");
  });

  it("is not fooled by the substring 'frame' in an unrelated identifier", () => {
    expect(classifyRaster(`<div class="phone-frame">hi</div>`, noTier2)).toBe("static");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/compositor-raster-policy.test.ts
```

Expected: FAIL — cannot resolve `rasterPolicy.js`.

- [ ] **Step 3: Write the classifier**

Create `src/render/native/page/compositor/rasterPolicy.ts`:

```ts
// How often does this markup have to be rasterized?
//
//   static  — once for the whole render
//   keyed   — once per distinct content key (active caption word, overlay text, …)
//   dynamic — every frame
//
// Getting this wrong in the `keyed` direction freezes a layer on screen with no error, so
// anything unrecognised resolves to `dynamic`. Cost is recoverable; a silently frozen layer
// in a shipped render is not.
export type RasterCadence = "static" | "keyed" | "dynamic";

/** Frame-driven custom properties set by the motion runtime every frame. */
const FRAME_VARS = /var\(\s*--(frame|t|progress|pulse)\b/;

/** Word-bound properties — these change on word boundaries, not per frame. */
const WORD_VARS = /var\(\s*--word[\w-]*/;

/** Any other author-defined custom property. Could be frame-driven; assume it is. */
const ANY_VAR = /var\(\s*--[\w-]+/;

/** A CSS animation is scrubbed per frame by the negative-delay trick. */
const CSS_ANIMATION = /@keyframes\b|\banimation\s*:/;

export function classifyRaster(html: string, opts: { hasTier2: boolean }): RasterCadence {
  if (opts.hasTier2) return "dynamic";
  if (FRAME_VARS.test(html)) return "dynamic";
  if (CSS_ANIMATION.test(html)) return "dynamic";

  const hasWordVar = WORD_VARS.test(html);
  // Strip the word vars, then ask whether any OTHER custom property remains.
  const withoutWordVars = html.replace(new RegExp(WORD_VARS.source, "g"), "");
  if (ANY_VAR.test(withoutWordVars)) return "dynamic";

  return hasWordVar ? "keyed" : "static";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/compositor-raster-policy.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render/native/page/compositor/rasterPolicy.ts tests/compositor-raster-policy.test.ts
git commit -s -m "feat(compositor): raster cadence classifier"
```

---

### Task 9: External-reference inlining

**Files:**
- Create: `src/render/native/page/compositor/inline.ts`
- Test: `tests/compositor-inline.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `findExternalRefs(html: string): string[]` and `inlineExternalRefs(html: string, fetchAsDataUrl: (url: string) => Promise<string | null>): Promise<string>`. Task 10's `html` provider calls `inlineExternalRefs` before serializing.

`findExternalRefs` graduates from the spike's `scripts/spike/scan-external-refs.mjs` — copy the regexes and the data:/fragment exclusions verbatim so the spike's M4 numbers still describe this code. **Size this task against the spike's M4 finding before starting.**

**Sizing note (M4):** the spike found zero inline external references across the scanned corpus, so
`inline.ts` remains a scoped footnote for this task rather than a sizing driver. Minor: source-file
motion HTML was not measured.

- [ ] **Step 1: Write the failing test**

Create `tests/compositor-inline.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { findExternalRefs, inlineExternalRefs } from "../src/render/native/page/compositor/inline.js";

const fakeFetch = async (url: string) =>
  url === "/public/missing.png" ? null : `data:image/png;base64,AAAA#${url}`;

describe("findExternalRefs", () => {
  it("finds img src and CSS url() references", () => {
    const html = `<img src="/public/a.png"><style>.b{background:url("/public/b.jpg")}</style>`;
    expect(findExternalRefs(html).sort()).toEqual(["/public/a.png", "/public/b.jpg"]);
  });

  it("ignores data: URLs and fragment references", () => {
    expect(findExternalRefs(`<img src="data:image/png;base64,AA"><div style="filter:url(#kino-glow)"></div>`)).toEqual([]);
  });
});

describe("inlineExternalRefs", () => {
  it("rewrites every external reference to a data URL", async () => {
    const out = await inlineExternalRefs(`<img src="/public/a.png">`, fakeFetch);
    expect(out).toContain("data:image/png;base64,AAAA#/public/a.png");
    expect(out).not.toContain("/public/a.png\"");
  });

  it("rewrites references inside CSS url()", async () => {
    const out = await inlineExternalRefs(`<style>.b{background:url(/public/b.jpg)}</style>`, fakeFetch);
    expect(out).toContain("data:image/png;base64,AAAA#/public/b.jpg");
  });

  it("leaves a reference alone when it cannot be fetched", async () => {
    const out = await inlineExternalRefs(`<img src="/public/missing.png">`, fakeFetch);
    expect(out).toContain("/public/missing.png");
  });

  it("fetches each distinct reference once, however many times it appears", async () => {
    const seen: string[] = [];
    const counting = async (url: string) => {
      seen.push(url);
      return `data:image/png;base64,AAAA`;
    };
    await inlineExternalRefs(`<img src="/public/a.png"><img src="/public/a.png">`, counting);
    expect(seen).toEqual(["/public/a.png"]);
  });

  it("returns markup unchanged when there is nothing to inline", async () => {
    const html = `<div style="background:#0b1020">hi</div>`;
    expect(await inlineExternalRefs(html, fakeFetch)).toBe(html);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/compositor-inline.test.ts
```

Expected: FAIL — cannot resolve `compositor/inline.js`.

- [ ] **Step 3: Write the inliner**

Create `src/render/native/page/compositor/inline.ts`:

```ts
// An SVG rasterized as an image runs in a restricted mode: it cannot fetch external
// resources. An <img src="/public/shot.png"> inside motion HTML therefore vanishes from a
// foreignObject raster, silently and with no error. Fonts already dodge this by being
// inlined (bgTextures.fontFaceCss); everything else has to be inlined here.
//
// data: URLs already survive, and in-document fragment references (filter:url(#kino-glow))
// resolve inside the SVG itself — neither is rewritten.

const IMG_SRC = /(<img\b[^>]*?\bsrc\s*=\s*["'])([^"']+)(["'])/gi;
const CSS_URL = /(url\(\s*["']?)([^"')]+)(["']?\s*\))/gi;

function isExternal(ref: string): boolean {
  const r = ref.trim();
  return r.length > 0 && !r.startsWith("data:") && !r.startsWith("#");
}

export function findExternalRefs(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(IMG_SRC)) if (isExternal(m[2])) found.add(m[2].trim());
  for (const m of html.matchAll(CSS_URL)) if (isExternal(m[2])) found.add(m[2].trim());
  return [...found];
}

/**
 * Rewrite every external reference to a data URL. A reference that cannot be fetched is left
 * as-is: it will not render inside the raster, but neither will it break the surrounding
 * markup — the same degradation the DOM path shows for a broken <img>.
 */
export async function inlineExternalRefs(
  html: string,
  fetchAsDataUrl: (url: string) => Promise<string | null>,
): Promise<string> {
  const refs = findExternalRefs(html);
  if (!refs.length) return html;

  const resolved = new Map<string, string>();
  await Promise.all(
    refs.map(async (ref) => {
      const dataUrl = await fetchAsDataUrl(ref);
      if (dataUrl) resolved.set(ref, dataUrl);
    }),
  );

  const swap = (_m: string, pre: string, ref: string, post: string) => {
    const hit = resolved.get(ref.trim());
    return hit ? `${pre}${hit}${post}` : `${pre}${ref}${post}`;
  };
  return html.replace(IMG_SRC, swap).replace(CSS_URL, swap);
}

/** Fetch a same-origin asset as a data URL. Returns null on any failure. */
export async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/compositor-inline.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/render/native/page/compositor/inline.ts tests/compositor-inline.test.ts
git commit -s -m "feat(compositor): inline external references before rasterizing"
```

---

### Task 10: The `html` provider

**Files:**
- Create: `src/render/native/page/compositor/providers/html.ts`
- Test: `tests/compositor-provider-html.test.ts`

**Interfaces:**
- Consumes: `buildTemplate`, `rasterAt`, `scrubCss` from `../../bgTextures.js`; `classifyRaster` from `../rasterPolicy.js`; `inlineExternalRefs`, `fetchAsDataUrl` from `../inline.js`; `uploadCanvasOrImage` from `./upload.js`.
- Produces: `createHtmlSource(opts: { html: string; theme: Theme; size: { w: number; h: number }; fps: number; hasTier2: boolean; scale: number }): TextureSource`.

- [ ] **Step 1: Export the raster helpers**

`buildTemplate`, `rasterAt` and `scrubCss` in `src/render/native/page/bgTextures.ts` are already exported per the spike's Task 3. If any is not, add `export` now — this is the only edit this plan makes to `bgTextures.ts`, and it adds no behavior.

- [ ] **Step 2: Write the failing test**

Create `tests/compositor-provider-html.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cacheKeyFor } from "../src/render/native/page/compositor/providers/html.js";

describe("cacheKeyFor", () => {
  it("keys a static layer by a constant — one raster for the whole render", () => {
    expect(cacheKeyFor("static", 0, undefined)).toBe("static");
    expect(cacheKeyFor("static", 500, "w7")).toBe("static");
  });

  it("keys a keyed layer by the layer's content key", () => {
    expect(cacheKeyFor("keyed", 42, "w3")).toBe("k:w3");
    expect(cacheKeyFor("keyed", 99, "w3")).toBe("k:w3");
  });

  it("falls back to the frame when a keyed layer has no content key", () => {
    expect(cacheKeyFor("keyed", 42, undefined)).toBe("f:42");
  });

  it("keys a dynamic layer by the frame — every frame is its own raster", () => {
    expect(cacheKeyFor("dynamic", 42, "w3")).toBe("f:42");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
npx vitest run tests/compositor-provider-html.test.ts
```

Expected: FAIL — cannot resolve `providers/html.js`.

- [ ] **Step 4: Write the provider**

Create `src/render/native/page/compositor/providers/html.ts`:

```ts
// The expensive provider: sanitized motion markup or styled text, rasterized through
// <svg><foreignObject> and uploaded as a texture. Reuses the raster path that already
// serves background texture channels — fonts inlined, data: URL (never blob, which taints
// the canvas and makes texImage2D throw), LRU cache keyed by scrub value.
import type { Theme } from "../../../props.js";
import { buildTemplate, rasterAt, scrubCss, type HtmlTemplate } from "../../bgTextures.js";
import { classifyRaster, type RasterCadence } from "../rasterPolicy.js";
import { fetchAsDataUrl, inlineExternalRefs } from "../inline.js";
import type { TextureSource } from "../graph.js";
import { uploadCanvasOrImage } from "./upload.js";

const CACHE_MAX = 24;

/** Which raster serves this (frame, key) pair. Static layers collapse to one entry. */
export function cacheKeyFor(cadence: RasterCadence, frame: number, key: string | undefined): string {
  if (cadence === "static") return "static";
  if (cadence === "keyed" && key) return `k:${key}`;
  return `f:${frame}`;
}

export function createHtmlSource(opts: {
  html: string;
  theme: Theme;
  size: { w: number; h: number };
  fps: number;
  hasTier2: boolean;
  scale: number;
}): TextureSource {
  const cadence = classifyRaster(opts.html, { hasTier2: opts.hasTier2 });
  const cache = new Map<string, HTMLCanvasElement>();
  let template: HtmlTemplate | null = null;
  let tex: WebGLTexture | null = null;
  let uploaded: string | null = null;
  let current: string | null = null;

  return {
    async prepare(frame: number, key?: string): Promise<void> {
      if (!template) {
        // Inline once, at template-build time: the markup's external references do not
        // change per frame, and re-fetching them every frame would dominate the cost.
        const inlined = await inlineExternalRefs(opts.html, fetchAsDataUrl);
        template = await buildTemplate(inlined, opts.theme, { size: opts.size, scale: opts.scale });
      }
      const cacheKey = cacheKeyFor(cadence, frame, key);
      current = cacheKey;
      if (cache.has(cacheKey)) return;

      // Static and keyed rasters hold no time; dynamic ones scrub to this frame.
      const css = cadence === "dynamic" ? scrubCss(frame / opts.fps) : "";
      const canvas = await rasterAt(template, cacheKey, css, null);
      if (!canvas) return;
      cache.set(cacheKey, canvas);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    },
    texture(gl: WebGL2RenderingContext): WebGLTexture | null {
      if (!current) return null;
      const canvas = cache.get(current);
      if (!canvas) return null;
      if (uploaded !== current || !tex) {
        tex = uploadCanvasOrImage(gl, tex, canvas);
        uploaded = current;
      }
      return tex;
    },
    size(): { w: number; h: number } | null {
      return template ? { w: template.w, h: template.h } : null;
    },
    dispose(): void {
      cache.clear();
    },
  };
}
```

`rasterAt` is called with a `null` cache and the result cached here instead: this provider's cache key encodes cadence, which `rasterAt`'s own LRU cannot know about.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run tests/compositor-provider-html.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/render/native/page/compositor/providers/html.ts tests/compositor-provider-html.test.ts
git commit -s -m "feat(compositor): html provider with cadence-aware raster caching"
```

---

### Task 11: Background providers — `canvas2d` and `shader`

**Files:**
- Create: `src/render/native/page/compositor/providers/canvas2d.ts`
- Create: `src/render/native/page/compositor/providers/shader.ts`
- Test: `tests/compositor-provider-background.test.ts`

**Interfaces:**
- Consumes: `DrawFn` from `../../../backgrounds/presets.js`; `paramsAt`, `pulseAt` from `../../../bgparams.js`; `assembleShaderSource`, `resolveUniforms` from `../../../shaderSource.js`; `uploadCanvasOrImage` from `./upload.js`.
- Produces: `createCanvas2dSource(...)` and `createShaderSource(...)`, both `TextureSource`.

Both are ports. The behavior that must not change: the canvas2d source paints `theme.night` before running the preset's `draw`, exactly as `CanvasBackground` does, and both register themselves as the glass backdrop.

- [ ] **Step 1: Write the failing test**

Create `tests/compositor-provider-background.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";

describe("canvas2d background source", () => {
  it("paints the night colour before running the preset draw", async () => {
    const bundle = await build({
      entryPoints: ["src/render/native/page/compositor/providers/canvas2d.ts"],
      bundle: true, write: false, format: "iife", globalName: "KinoBg",
      platform: "browser", target: "chrome120", logLevel: "silent",
    });
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"],
    });
    try {
      const page = await browser.newPage();
      await page.setContent("<!doctype html><body></body>");
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const px = await page.evaluate(async () => {
        // A draw that paints nothing: whatever is left is the night fill.
        const src = (window as any).KinoBg.createCanvas2dSource({
          draw: () => {},
          params: {}, keyframes: [], triggers: [],
          theme: { night: "#0b1020" },
          width: 64, height: 64, fps: 30,
        });
        await src.prepare(0);
        const c = src.canvasForTest();
        const d = c.getContext("2d").getImageData(32, 32, 1, 1).data;
        return [d[0], d[1], d[2]];
      });
      expect(px).toEqual([0x0b, 0x10, 0x20]);
    } finally {
      await browser.close();
    }
  }, 120000);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/compositor-provider-background.test.ts
```

Expected: FAIL — cannot resolve `providers/canvas2d.ts`.

- [ ] **Step 3: Write the canvas2d provider**

Create `src/render/native/page/compositor/providers/canvas2d.ts`:

```ts
// Canvas2D background presets. A port of CanvasBackground's per-frame body: reset transform
// and compositing state, clear, paint night, resolve tweened params and the trigger pulse at
// this frame's time, run the preset's draw.
import type { BgKeyframe, BgParamValue, BgTrigger, Theme } from "../../../props.js";
import { paramsAt, pulseAt } from "../../../bgparams.js";
import type { DrawFn } from "../../../backgrounds/presets.js";
import { registerBackdrop } from "../../liquidGlass.js";
import type { TextureSource } from "../graph.js";
import { uploadCanvasOrImage } from "./upload.js";

export function createCanvas2dSource(opts: {
  draw: DrawFn;
  params: Record<string, BgParamValue>;
  keyframes: BgKeyframe[];
  triggers: BgTrigger[];
  theme: Pick<Theme, "night">;
  width: number;
  height: number;
  fps: number;
}): TextureSource & { canvasForTest(): HTMLCanvasElement } {
  const canvas = document.createElement("canvas");
  canvas.width = opts.width;
  canvas.height = opts.height;
  let tex: WebGLTexture | null = null;

  return {
    async prepare(frame: number): Promise<void> {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.filter = "none";
      ctx.clearRect(0, 0, opts.width, opts.height);
      ctx.fillStyle = opts.theme.night;
      ctx.fillRect(0, 0, opts.width, opts.height);
      const t = frame / opts.fps;
      opts.draw(ctx, {
        frame, fps: opts.fps, width: opts.width, height: opts.height,
        params: paramsAt(opts.params, opts.keyframes, t),
        pulse: pulseAt(opts.triggers, t),
      });
      registerBackdrop(canvas, opts.width, opts.height);
    },
    texture(gl: WebGL2RenderingContext): WebGLTexture | null {
      tex = uploadCanvasOrImage(gl, tex, canvas);
      return tex;
    },
    size(): { w: number; h: number } {
      return { w: opts.width, h: opts.height };
    },
    canvasForTest(): HTMLCanvasElement {
      return canvas;
    },
  };
}
```

- [ ] **Step 4: Write the shader provider**

Create `src/render/native/page/compositor/providers/shader.ts`:

```ts
// WebGL2 shader backgrounds. The program, uniform resolution and texture channels are
// unchanged from ShaderBackground; only the destination differs — it renders into its own
// offscreen canvas, which the compositor then samples as a texture.
//
// The SS/FXAA resolve stays here in phase 1 so shader output is byte-identical to today's;
// moving it to the composite is phase 4 work and would change pixels.
import type { BgKeyframe, BgParamValue, BgTrigger } from "../../../props.js";
import { registerBackdrop } from "../../liquidGlass.js";
import type { TextureSource } from "../graph.js";
import { uploadCanvasOrImage } from "./upload.js";

export function createShaderSource(opts: {
  /** Draws this frame into `canvas`. Supplied by the Stage, which owns the compiled program
   *  and the existing SS/FXAA plumbing from ShaderBackground. */
  drawFrame: (canvas: HTMLCanvasElement, frame: number) => void;
  width: number;
  height: number;
  params: Record<string, BgParamValue>;
  keyframes: BgKeyframe[];
  triggers: BgTrigger[];
}): TextureSource {
  const canvas = document.createElement("canvas");
  canvas.width = opts.width;
  canvas.height = opts.height;
  let tex: WebGLTexture | null = null;

  return {
    async prepare(frame: number): Promise<void> {
      opts.drawFrame(canvas, frame);
      registerBackdrop(canvas, opts.width, opts.height);
    },
    texture(gl: WebGL2RenderingContext): WebGLTexture | null {
      tex = uploadCanvasOrImage(gl, tex, canvas);
      return tex;
    },
    size(): { w: number; h: number } {
      return { w: opts.width, h: opts.height };
    },
  };
}
```

Extract the program compilation, uniform resolution and FXAA resolve from `ShaderBackground.tsx` into a `drawFrame` closure the Stage builds in Task 13. Do not edit `ShaderBackground.tsx` — copy what you need. It stays as the DOM path's implementation.

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run tests/compositor-provider-background.test.ts
```

Expected: PASS, 1 test.

- [ ] **Step 6: Commit**

```bash
git add src/render/native/page/compositor/providers/canvas2d.ts src/render/native/page/compositor/providers/shader.ts tests/compositor-provider-background.test.ts
git commit -s -m "feat(compositor): canvas2d and shader background providers"
```

---

### Task 11b: The `region` provider

**Files:**
- Create: `src/render/native/page/compositor/providers/region.ts`
- Test: extend `tests/render-compositor-parity.test.ts` (Task 15) with the `region-shader` row

**Interfaces:**
- Consumes: `RegionShaderProps` from `../../../props.js`; `uploadCanvasOrImage` from `./upload.js`.
- Produces: `createRegionSource(opts: { region: RegionShaderProps; drawFrame: (canvas: HTMLCanvasElement, frame: number) => void; width: number; height: number }): TextureSource`.

Region shaders are the one existing feature that already does per-layer masking, so this port is also the phase-2 dress rehearsal: whatever shape `MaskRef` eventually takes has to be able to express what `RegionShaderProps` expresses today.

- [ ] **Step 1: Write the provider**

Create `src/render/native/page/compositor/providers/region.ts`:

```ts
// Mask-split region shaders. Like the shader provider, the program, mask uploads and SDF
// channel binding are unchanged from RegionShader.tsx — only the destination differs: it
// renders into an offscreen canvas the compositor samples, instead of its own visible one.
//
// RegionShader.tsx is NOT edited. It remains the DOM path's implementation and the parity
// reference; this file copies what it needs.
import type { RegionShaderProps } from "../../../props.js";
import type { TextureSource } from "../graph.js";
import { uploadCanvasOrImage } from "./upload.js";

export function createRegionSource(opts: {
  region: RegionShaderProps;
  /** Renders this frame into `canvas` — the program, uniforms, mask textures and SDF
   *  channels lifted from RegionShader.tsx. Built by Stage.tsx, which owns compilation. */
  drawFrame: (canvas: HTMLCanvasElement, frame: number) => void;
  width: number;
  height: number;
}): TextureSource {
  const canvas = document.createElement("canvas");
  canvas.width = opts.width;
  canvas.height = opts.height;
  let tex: WebGLTexture | null = null;

  return {
    async prepare(frame: number): Promise<void> {
      opts.drawFrame(canvas, frame);
    },
    texture(gl: WebGL2RenderingContext): WebGLTexture | null {
      tex = uploadCanvasOrImage(gl, tex, canvas);
      return tex;
    },
    size(): { w: number; h: number } {
      return { w: opts.width, h: opts.height };
    },
  };
}
```

- [ ] **Step 2: Emit the layer**

In `src/render/layers.ts`, inside the video-beat block from Task 3, a beat carrying `regionShader` replaces its footage draw rather than layering over it — matching `KinoVideo.tsx`, where `RegionShader` is rendered *instead of* the footage. Change the footage push to:

```ts
    const footageProvider = s.regionShader ? `region${i}` : `seg${i}`;
    out.push({ id: `seg${i}`, source: { providerId: footageProvider }, rect, opacity });
```

The layer id stays `seg${i}` so ordering and the kicker/caption layers above it are unaffected; only the provider changes.

- [ ] **Step 3: Register the source**

In `registry.ts`, inside the `s.kind === "video"` branch:

```ts
      if (s.regionShader) {
        sources.set(`region${i}`, createRegionSource({
          region: s.regionShader,
          drawFrame: regionDrawFrame(s, i),   // built by Stage.tsx — see Task 13
          width: dims.width,
          height: dims.height,
        }));
      }
```

- [ ] **Step 4: Verify against the existing region tests**

```bash
npm run build && npx vitest run tests/render-region-params.test.ts tests/render-region-backdrop.test.ts tests/render-maskdist.test.ts
```

Expected: PASS with `KINO_COMPOSITOR` unset — these exercise the DOM path, which must be untouched. They are the reference the parity row will be compared against.

- [ ] **Step 5: Commit**

```bash
git add src/render/native/page/compositor/providers/region.ts src/render/layers.ts src/render/native/page/compositor/registry.ts
git commit -s -m "feat(compositor): region shader provider"
```

---

### Task 11c: Backdrop parity — glow, scrim and Ken-Burns image

**Files:**
- Create: `src/render/backgrounds/glow.ts`
- Test: `tests/compositor-glow.test.ts`

**Interfaces:**
- Consumes: `DrawFn`, `DrawEnv` from `./presets.js`.
- Produces: `glowDraw: DrawFn`, `scrimDraw: DrawFn`, `kenBurnsScale(frame: number): number`. `registry.ts` (Task 13) imports all three.

Three backdrop behaviors have **no canvas implementation today** — they are CSS in `components.tsx`, so `getPreset` cannot supply them:

- `glow` — the zero-config default: a graded base plus three blurred brand-colored radial gradients that drift on `sin`/`cos` of the frame.
- `Scrim` — a radial legibility gradient over canvas and image backdrops, deliberately **not** applied to shader backdrops.
- `ImageBg` — a Ken-Burns push-in from scale 1.05 to 1.13 over 300 frames, clamped.

Skipping any of them makes the most common spec of all — a default-background build — fail parity.

- [ ] **Step 1: Write the failing test**

Create `tests/compositor-glow.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { kenBurnsScale } from "../src/render/backgrounds/glow.js";

describe("kenBurnsScale", () => {
  it("starts at 1.05", () => {
    expect(kenBurnsScale(0)).toBeCloseTo(1.05, 5);
  });

  it("reaches 1.13 at frame 300", () => {
    expect(kenBurnsScale(300)).toBeCloseTo(1.13, 5);
  });

  it("clamps past the end", () => {
    expect(kenBurnsScale(900)).toBeCloseTo(1.13, 5);
  });

  it("is monotonic across the ramp", () => {
    expect(kenBurnsScale(150)).toBeGreaterThan(kenBurnsScale(50));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/compositor-glow.test.ts
```

Expected: FAIL — cannot resolve `backgrounds/glow.js`.

- [ ] **Step 3: Write the ports**

Create `src/render/backgrounds/glow.ts`:

```ts
// Canvas2D ports of the three CSS-only backdrop behaviors in components.tsx. The compositor
// has no CSS in its pixel path, so GlowBg, Scrim and ImageBg's Ken-Burns have to exist as
// draw functions. Geometry and colors are copied from the CSS so parity holds.
import type { DrawFn } from "./presets.js";
import { interpolate } from "../interpolate.js";

/** ImageBg's slow push-in: 1.05 → 1.13 over 300 frames, clamped. */
export function kenBurnsScale(frame: number): number {
  return interpolate(frame, [0, 300], [1.05, 1.13], { extrapolateRight: "clamp" });
}

/** Alpha suffix helper — the CSS writes brand colors with 2-hex-digit alpha. */
const withAlpha = (hex: string, alpha: string) => `${hex}${alpha}`;

/**
 * GlowBg: a 160° graded base plus three blurred brand glows drifting on the frame clock.
 * Blur radii come from the CSS `filter: blur(...)` values; ctx.filter is set and reset around
 * each glow so no blur leaks into the next draw.
 */
export const glowDraw: DrawFn = (ctx, e) => {
  const { width: w, height: h, frame: f } = e;
  const night = String(e.params.night ?? "#0b1020");
  const green = String(e.params.green ?? "#0c8d64");
  const mint = String(e.params.mint ?? "#80e2b4");
  const gold = String(e.params.gold ?? "#d99a20");

  // 160° linear base: night → green at 1e alpha → night.
  const rad = (160 * Math.PI) / 180;
  const base = ctx.createLinearGradient(0, 0, Math.cos(rad) * w, Math.sin(rad) * h);
  base.addColorStop(0, night);
  base.addColorStop(0.55, withAlpha(green, "1e"));
  base.addColorStop(1, night);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  const dx = Math.sin(f / 60) * 6;
  const dy = Math.cos(f / 80) * 8;
  const dx2 = Math.cos(f / 52) * 5;

  const glow = (cx: number, cy: number, size: number, color: string, alpha: string, blur: number, stop: number) => {
    ctx.save();
    ctx.filter = `blur(${blur}px)`;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
    g.addColorStop(0, withAlpha(color, alpha));
    g.addColorStop(stop, withAlpha(color, "00"));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  // Positions mirror the CSS: top/left, bottom/right, and a mid-right accent.
  glow(((10 + dx) / 100) * w + 490, ((16 + dy) / 100) * h + 490, 980, green, "66", 44, 0.62);
  glow(w - ((6 + dx) / 100) * w - 410, h - ((6 - dy) / 100) * h - 410, 820, mint, "3d", 52, 0.62);
  glow(((58 + dx2) / 100) * w + 280, ((52 + dy) / 100) * h + 280, 560, gold, "24", 58, 0.64);
};

/**
 * Scrim: the legibility gradient over canvas and image backdrops. Shader backdrops must NOT
 * get it — the frag owns exposure, and liquid glass samples the raw canvas, so a scrim would
 * darken the scene while the glass stayed bright.
 */
export const scrimDraw: DrawFn = (ctx, e) => {
  const { width: w, height: h } = e;
  const night = String(e.params.night ?? "#0b1020");
  const light = Number(e.params.nightLuminance ?? 0) > 0.5;
  const a0 = light ? "33" : "9c";
  const a1 = light ? "14" : "2e";
  const g = ctx.createRadialGradient(w * 0.5, h * 0.48, 0, w * 0.5, h * 0.48, Math.max(w * 0.76, h * 0.5));
  g.addColorStop(0, withAlpha(night, a0));
  g.addColorStop(0.66, withAlpha(night, a1));
  g.addColorStop(1, withAlpha(night, "00"));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
};
```

The `params.night` / `params.green` reads assume the registry passes the brand palette through `params`. In `registry.ts`, merge the theme colors into the params object handed to `createCanvas2dSource` for the backdrop:

```ts
      params: { ...props.background.params, night: props.theme.night, green: props.theme.green,
                mint: props.theme.mint, gold: props.theme.gold },
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/compositor-glow.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Wire the scrim and image backdrop into the registry**

Canvas and image backdrops need the scrim as a **second layer** above the backdrop, and image backdrops need the Ken-Burns transform. In `layers.ts`, after the backdrop push:

```ts
  // The scrim rides above canvas and image backdrops, never above a shader one.
  const shaderBg = props.background.kind === "custom" && Boolean(props.background.shaderCode);
  if (!shaderBg) out.push({ id: "scrim", source: { providerId: "scrim" }, rect: full });
```

and for an image backdrop, apply `kenBurnsScale(frame)` as the backdrop layer's `transform.scale`.

- [ ] **Step 6: Commit**

```bash
git add src/render/backgrounds/glow.ts src/render/layers.ts src/render/native/page/compositor/registry.ts tests/compositor-glow.test.ts
git commit -s -m "feat(compositor): canvas ports of glow, scrim and Ken-Burns backdrops"
```

---

### Task 12: Lifting nested canvases (Lottie)

**Files:**
- Create: `src/render/native/page/compositor/providers/nested.ts`
- Test: `tests/compositor-nested-canvas.test.ts`

**Interfaces:**
- Consumes: `TextureSource` from `graph.js`; `uploadCanvasOrImage` from `./upload.js`.
- Produces: `findNestedCanvases(root: ParentNode): Array<{ canvas: HTMLCanvasElement; rect: DOMRect }>` and `createNestedCanvasSource(canvas: HTMLCanvasElement): TextureSource`.

This is spec trap 1. `XMLSerializer` emits a `<canvas>` element but not its pixels, so a Lottie layer inside rasterized markup would silently render empty. Nested canvases are lifted into their own layers instead.

- [ ] **Step 1: Write the failing test**

Create `tests/compositor-nested-canvas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";

describe("nested canvas lifting", () => {
  it("proves the trap is real, then that lifting fixes it", async () => {
    const bundle = await build({
      entryPoints: ["src/render/native/page/compositor/providers/nested.ts"],
      bundle: true, write: false, format: "iife", globalName: "KinoNested",
      platform: "browser", target: "chrome120", logLevel: "silent",
    });
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.setContent("<!doctype html><body></body>");
      await page.addScriptTag({ content: bundle.outputFiles[0].text });

      const result = await page.evaluate(async () => {
        const host = document.createElement("div");
        host.style.cssText = "position:absolute;left:0;top:0;width:100px;height:100px";
        const c = document.createElement("canvas");
        c.width = 100; c.height = 100;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = "#ff0000";
        ctx.fillRect(0, 0, 100, 100);
        host.appendChild(c);
        document.body.appendChild(host);

        // The trap: serializing the subtree drops the canvas pixels entirely.
        const xhtml = new XMLSerializer().serializeToString(host);
        const serializedHasPixels = xhtml.includes("data:image") || xhtml.includes("ff0000");

        // The fix: the canvas is found and lifted out as its own source.
        const found = (window as any).KinoNested.findNestedCanvases(host);
        return { serializedHasPixels, liftedCount: found.length, liftedWidth: found[0]?.rect.width };
      });

      expect(result.serializedHasPixels).toBe(false); // the trap, demonstrated
      expect(result.liftedCount).toBe(1);
      expect(result.liftedWidth).toBe(100);
    } finally {
      await browser.close();
    }
  }, 120000);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/compositor-nested-canvas.test.ts
```

Expected: FAIL — cannot resolve `providers/nested.ts`.

- [ ] **Step 3: Write the lifter**

Create `src/render/native/page/compositor/providers/nested.ts`:

```ts
// XMLSerializer emits a <canvas> element, never its pixels — so any canvas inside markup
// bound for a foreignObject raster would render empty, silently. The Lottie player draws
// into exactly such a canvas.
//
// Nested canvases are therefore found in the staging DOM, hidden from the raster, and drawn
// as their own layers positioned by their measured rect.
import type { TextureSource } from "../graph.js";
import { uploadCanvasOrImage } from "./upload.js";

export interface NestedCanvas {
  canvas: HTMLCanvasElement;
  rect: DOMRect;
}

/** Every <canvas> in the subtree, with its position relative to the subtree root. */
export function findNestedCanvases(root: ParentNode): NestedCanvas[] {
  const host = root as unknown as Element;
  const origin = typeof host.getBoundingClientRect === "function"
    ? host.getBoundingClientRect()
    : new DOMRect(0, 0, 0, 0);
  return Array.from(root.querySelectorAll("canvas")).map((canvas) => {
    const r = canvas.getBoundingClientRect();
    return {
      canvas: canvas as HTMLCanvasElement,
      rect: new DOMRect(r.x - origin.x, r.y - origin.y, r.width, r.height),
    };
  });
}

/** Hide lifted canvases from the raster so they are not drawn twice — once empty in the
 *  raster, once for real as their own layer. */
export function hideFromRaster(nested: NestedCanvas[]): void {
  for (const { canvas } of nested) canvas.style.visibility = "hidden";
}

export function createNestedCanvasSource(canvas: HTMLCanvasElement): TextureSource {
  let tex: WebGLTexture | null = null;
  return {
    async prepare(): Promise<void> {
      // The canvas is drawn into by its own player during the staging commit; nothing to await.
    },
    texture(gl: WebGL2RenderingContext): WebGLTexture | null {
      if (!canvas.width || !canvas.height) return null;
      tex = uploadCanvasOrImage(gl, tex, canvas);
      return tex;
    },
    size(): { w: number; h: number } {
      return { w: canvas.width, h: canvas.height };
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/compositor-nested-canvas.test.ts
```

Expected: PASS, 1 test — including `serializedHasPixels === false`, which is the trap demonstrated rather than assumed.

- [ ] **Step 5: Commit**

```bash
git add src/render/native/page/compositor/providers/nested.ts tests/compositor-nested-canvas.test.ts
git commit -s -m "feat(compositor): lift nested canvases out of rasterized markup"
```

---

### Task 13: The Stage — registry, staging DOM, two-phase seek

**Files:**
- Create: `src/render/native/page/compositor/registry.ts`
- Create: `src/render/native/page/compositor/Stage.tsx`
- Modify: `src/render/native/page/index.tsx`
- Test: `tests/compositor-stage.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–12.
- Produces: `buildRegistry(props: KinoProps, dims: Dims, media: MediaMap, scale: number): Map<string, TextureSource>` from `registry.ts`; `<Stage>` from `Stage.tsx`. This is the task that makes `KINO_COMPOSITOR=1` render a real frame.

- [ ] **Step 1: Write the failing test**

Create `tests/compositor-stage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0,
};
// A flat magenta background: unmistakable, and any compositing mistake shows immediately.
const flat = "ctx.fillStyle='#ff00ff';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);";
const bg = {
  kind: "custom" as const, image: null, customCode: flat, shaderCode: null,
  params: {}, keyframes: [], triggers: [],
};

const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: bg, disclosure: "",
  segments: [{ kind: "scene", caption: "", startSec: 0, endSec: 2 }],
};

const meanOf = (png: string, channel: "r" | "g" | "b") =>
  parseFloat(magick([png, "-format", `%[fx:mean.${channel}]`, "info:"]).trim());

describe("compositor stage", () => {
  it("renders the background through the GL stage when KINO_COMPOSITOR=1", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      const outDir = mkdtempSync(join(tmpdir(), "kino-stage-"));
      const [png] = await renderStills({
        props, publicDir: mkdtempSync(join(tmpdir(), "stage-pub-")),
        format: "9:16", frames: [{ frame: 10, name: "stage" }], outDir,
      });
      expect(existsSync(png)).toBe(true);
      // Magenta: red and blue saturated, green empty. A black frame means the stage drew nothing.
      expect(meanOf(png, "r")).toBeGreaterThan(0.95);
      expect(meanOf(png, "b")).toBeGreaterThan(0.95);
      expect(meanOf(png, "g")).toBeLessThan(0.05);
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 180000);

  it("renders the same frame twice identically", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      const outDir = mkdtempSync(join(tmpdir(), "kino-stage-det-"));
      const pngs = await renderStills({
        props, publicDir: mkdtempSync(join(tmpdir(), "stage-det-pub-")),
        format: "9:16", frames: [{ frame: 10, name: "a" }, { frame: 10, name: "b" }], outDir,
      });
      const diff = parseFloat(
        magick([pngs[0], pngs[1], "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim(),
      );
      expect(diff).toBe(0);
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 180000);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/compositor-stage.test.ts
```

Expected: FAIL — `KINO_COMPOSITOR` is not read anywhere, so the DOM path renders and the flat magenta assertion still passes but the determinism one may too. **Before implementing, confirm the failure is real** by checking that no `KINO_COMPOSITOR` string exists in the source:

```bash
grep -rn "KINO_COMPOSITOR" src/ || echo "not implemented yet — test is not yet meaningful"
```

- [ ] **Step 3: Write the registry**

Create `src/render/native/page/compositor/registry.ts`:

```ts
// Builds one TextureSource per layer id that `layersAt` can emit. The ids here and the
// providerIds in layers.ts are the same namespace — a mismatch means a silently missing
// layer, so both sides are exercised by the parity harness.
import type { BackgroundProps, KinoProps } from "../../props.js";
import type { MediaMap } from "../media.js";
import type { Dims, TextureSource } from "./graph.js";
import { createCanvas2dSource } from "./providers/canvas2d.js";
import { createFramesSource } from "./providers/frames.js";
import { createHtmlSource } from "./providers/html.js";
import { createImageSource } from "./providers/image.js";
import { getPreset, type DrawFn } from "../../backgrounds/presets.js";

/**
 * Which draw function paints this background — mirroring FacelessBackdrop's resolution order.
 *
 * TRUST BOUNDARY: `new Function()` executes config-supplied code. Safe ONLY because the source
 * is trusted local project config that has already passed the sanitize + determinism lint
 * (sanitizeMotion.ts, motiongraphic.ts). Never feed untrusted or remote input here.
 */
export function resolveBackgroundDraw(bg: BackgroundProps): DrawFn | undefined {
  if (bg.kind === "custom" && bg.customCode) {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return new Function("ctx", "env", bg.customCode) as DrawFn;
  }
  return getPreset(bg.kind);
}

export function buildRegistry(
  props: KinoProps,
  dims: Dims,
  media: MediaMap,
  scale: number,
): Map<string, TextureSource> {
  const sources = new Map<string, TextureSource>();
  const f = (sec: number) => Math.round(sec * props.fps);

  // Backdrop. Four cases, matching FacelessBackdrop's dispatcher:
  //   custom + shaderCode   → shader source, NO scrim (the frag owns exposure)
  //   image                 → Ken-Burns image source + scrim
  //   preset / custom code  → canvas2d source + scrim
  //   anything else         → the glow default (glowDraw, from Task 11c)
  // `scrimDraw` and `glowDraw` come from Task 11c; both are Canvas2D ports of CSS-only
  // backdrops that have no preset today.
  const draw = resolveBackgroundDraw(props.background) ?? glowDraw;
  sources.set(
    "backdrop",
    createCanvas2dSource({
      draw,
      params: props.background.params,
      keyframes: props.background.keyframes,
      triggers: props.background.triggers,
      theme: props.theme,
      width: dims.width,
      height: dims.height,
      fps: props.fps,
    }),
  );

  props.avatarWindows.forEach((w, i) => {
    const entry = media[`av${i}`];
    if (entry) sources.set(`av${i}`, createFramesSource(entry, f(w.fromSec)));
  });

  props.segments.forEach((s, i) => {
    if (s.kind === "video") {
      const entry = media[`seg${i}`];
      if (entry) sources.set(`seg${i}`, createFramesSource(entry, f(s.startSec)));
      if (s.frame) sources.set(`frame${i}`, createImageSource("/public/" + s.frame.src));
    }
    const html = (kind: "motion" | "overlay", markup: string) =>
      createHtmlSource({
        html: markup,
        theme: props.theme,
        size: { w: dims.width, h: dims.height },
        fps: props.fps,
        // Tier-2 procedural graphics carry their JS in `proc` (MotionGraphicProps.proc).
        hasTier2: kind === "motion" ? Boolean(s.motion?.proc) : Boolean(s.motionOverlay?.proc),
        scale,
      });
    if (s.kind === "motion" && s.motion) sources.set(`motion${i}`, html("motion", s.motion.html));
    if (s.motionOverlay) sources.set(`overlay${i}`, html("overlay", s.motionOverlay.html));
  });

  if (props.logo) sources.set("logo", createImageSource("/public/" + props.logo.src));

  return sources;
}
```

If `MotionGraphicProps` has no `js` field, read whichever field carries Tier-2 code — check `src/render/props.ts` and use the real name. If motion graphics carry no JS at all in this codebase, pass `hasTier2: false` and delete the branch.

Caption, kicker, text, disclosure and film sources are added in Step 5.

- [ ] **Step 4: Write the Stage**

Create `src/render/native/page/compositor/Stage.tsx`:

```tsx
// The compositor stage: one visible canvas, plus a hidden staging DOM that exists only so
// rasterizable layers can be measured and serialized.
//
// The seek contract is two strict phases. Phase A is async — compute the layer list and let
// every source prepare (raster, decode, fetch). Phase B is synchronous — bind, transform,
// blend, present. Nothing in phase B touches CSS, layout or the network, which is where the
// determinism guarantee comes from.
import React, { useLayoutEffect, useRef } from "react";
import type { KinoProps } from "../../props.js";
import type { MediaMap } from "../media.js";
import { layersAt } from "../../../layers.js";
import { StageRenderer } from "./renderer.js";
import { buildRegistry, type Dims } from "./registry.js";
import type { TextureSource } from "./graph.js";

export interface StageHandle {
  seek(frame: number): Promise<void>;
  dispose(): void;
}

export function createStage(
  canvas: HTMLCanvasElement,
  props: KinoProps,
  dims: Dims,
  media: MediaMap,
  scale: number,
): StageHandle {
  const renderer = new StageRenderer(canvas, { width: dims.width, height: dims.height, ss: scale });
  const sources: Map<string, TextureSource> = buildRegistry(props, dims, media, scale);

  return {
    async seek(frame: number): Promise<void> {
      const layers = layersAt(props, frame, dims);
      // Phase A — every source that this frame needs, prepared concurrently.
      await Promise.all(
        layers.map((l) => sources.get(l.source.providerId)?.prepare(frame, l.source.key) ?? Promise.resolve()),
      );
      // Phase B — synchronous.
      renderer.draw(layers, sources, frame);
    },
    dispose(): void {
      for (const s of sources.values()) s.dispose?.();
      renderer.dispose();
    },
  };
}

/** Mounts the visible canvas. The staging DOM lives beside it, off-screen. */
export const Stage: React.FC<{
  props: KinoProps;
  dims: Dims;
  media: MediaMap;
  scale: number;
  onReady: (handle: StageHandle) => void;
}> = ({ props, dims, media, scale, onReady }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stagingRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!canvasRef.current) return;
    const handle = createStage(canvasRef.current, props, dims, media, scale);
    onReady(handle);
    return () => handle.dispose();
  }, [props, dims, media, scale, onReady]);

  return (
    <>
      <canvas
        ref={canvasRef}
        id="kino-stage"
        width={dims.width}
        height={dims.height}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      {/* Staging DOM: laid out for real (so CSS, vw units and fonts resolve) but never
          composited into the frame. */}
      <div
        ref={stagingRef}
        id="kino-staging"
        style={{ position: "absolute", left: -99999, top: 0, width: dims.width, height: dims.height, visibility: "hidden" }}
      />
    </>
  );
};
```

Text sources (`caption<i>`, `kicker<i>`, `text<i>_<j>`, `disclosure`, `film`) are added in Task 13b. Until then those layer ids resolve to no source and the renderer skips them — the frame renders without text, which is the expected intermediate state.

- [ ] **Step 5: Wire the flag into the page boot**

In `src/render/native/page/index.tsx`, read the flag from the render config and choose the path. Add `compositor?: boolean` to the `RenderConfig` interface, then in the boot path:

```tsx
if (config.compositor) {
  root.render(<Stage props={config.props} dims={{ width: config.width, height: config.height }}
                     media={config.media} scale={config.shaderSS ?? 2} onReady={(h) => { stage = h; }} />);
  window.kinoSeek = async (frame: number) => { await stage!.seek(frame); };
} else {
  // existing DOM path, unchanged
}
```

In `src/render/native/engine.ts`, set `compositor: process.env.KINO_COMPOSITOR === "1"` on the render config object written to `/render-config.json`.

- [ ] **Step 6: Rebuild and run the test**

```bash
npm run build && npx vitest run tests/compositor-stage.test.ts
```

Expected: PASS, 2 tests. The determinism test failing while the magenta test passes means something in the draw path is order- or history-dependent — check for a provider leaving GL state bound.

- [ ] **Step 7: Confirm the DOM path still works**

```bash
npx vitest run
```

Expected: the full suite passes with `KINO_COMPOSITOR` unset.

- [ ] **Step 8: Commit**

```bash
git add src/render/native/page/compositor/registry.ts src/render/native/page/compositor/Stage.tsx src/render/native/page/index.tsx src/render/native/engine.ts tests/compositor-stage.test.ts
git commit -s -m "feat(compositor): stage, source registry and two-phase seek behind KINO_COMPOSITOR"
```

---

### Task 13b: Text, caption and finish sources

**Files:**
- Create: `src/render/native/page/compositor/textMarkup.ts`
- Modify: `src/render/native/page/compositor/registry.ts`
- Test: `tests/compositor-text-markup.test.ts`

**Interfaces:**
- Consumes: `Theme`, `KinoSegment`, `ResolvedText` from `../../props.js`; `captionBandBottom`, `isHeroCaption` from `../../captionLayout.js`; `createHtmlSource` from `./providers/html.js`.
- Produces: `captionMarkup`, `kickerMarkup`, `textMarkup`, `disclosureMarkup`, `filmMarkup` — each `(…) => string`. `registry.ts` feeds each into `createHtmlSource`.

Every layer above the footage is text or a finish pass, and each is a React component in `components.tsx` today. The compositor needs the same pixels as HTML strings. `components.tsx` is read-only for this plan, so these are ports, not refactors — read each component and emit markup that produces the same box.

Do these **one layer id at a time**, running Task 15's parity harness after each. Adding five at once makes a mismatch unattributable.

- [ ] **Step 1: Write the failing test**

Create `tests/compositor-text-markup.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { captionMarkup, kickerMarkup, disclosureMarkup } from "../src/render/native/page/compositor/textMarkup.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
};

describe("captionMarkup", () => {
  it("renders the caption text", () => {
    expect(captionMarkup({ text: "ship it", theme, hero: false, activeWord: null })).toContain("ship it");
  });

  it("applies the theme's caption size and stroke", () => {
    const html = captionMarkup({ text: "ship it", theme, hero: false, activeWord: null });
    expect(html).toContain("74px");
    expect(html).toContain("9px");
  });

  it("marks the active word for words-mode reveal", () => {
    const html = captionMarkup({ text: "ship it fast", theme, hero: false, activeWord: 1 });
    expect(html).toMatch(/class="[^"]*kino-word-active/);
  });

  it("escapes markup in caption text so a spec cannot inject elements", () => {
    expect(captionMarkup({ text: `<img src=x onerror=1>`, theme, hero: false, activeWord: null }))
      .not.toContain("<img");
  });
});

describe("kickerMarkup", () => {
  it("uses the kicker's own colors, not the theme's", () => {
    const html = kickerMarkup({ text: "NEW", color: "#ff0000", fg: "#00ff00", theme });
    expect(html).toContain("#ff0000");
    expect(html).toContain("#00ff00");
  });
});

describe("disclosureMarkup", () => {
  it("renders the disclosure text", () => {
    expect(disclosureMarkup({ text: "AI generated", theme })).toContain("AI generated");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/compositor-text-markup.test.ts
```

Expected: FAIL — cannot resolve `compositor/textMarkup.js`.

- [ ] **Step 3: Write the caption markup**

Create `src/render/native/page/compositor/textMarkup.ts`. Start with the caption only — the other four follow in Step 5.

```ts
// HTML-string ports of the text layers in components.tsx. The compositor rasterizes these
// through the html provider, so they must produce the same box the React components do.
//
// components.tsx is the parity reference and is NOT edited: read it, port it, compare.
import type { Theme } from "../../props.js";

/** Spec text reaches the DOM path as React children, which escape by construction. These
 *  markup strings are injected as HTML, so they have to escape explicitly. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function captionMarkup(opts: {
  text: string;
  theme: Theme;
  hero: boolean;
  /** Word index to highlight in words mode, or null for a whole-phrase caption. */
  activeWord: number | null;
}): string {
  const { text, theme, hero, activeWord } = opts;
  const size = hero ? Math.round(theme.captionFontSize * 1.25) : theme.captionFontSize;
  const body =
    activeWord === null
      ? escapeHtml(text)
      : text
          .split(/\s+/)
          .map((w, i) =>
            `<span class="kino-word${i === activeWord ? " kino-word-active" : ""}">${escapeHtml(w)}</span>`,
          )
          .join(" ");
  return (
    `<style>` +
    `.kino-cap{position:absolute;left:6%;right:6%;${hero ? "top:0;bottom:0;display:grid;place-items:center;" : "bottom:12%;"}` +
    `font-family:'${theme.font}',sans-serif;font-weight:800;font-size:${size}px;line-height:1.15;` +
    `color:${theme.white};text-align:center;` +
    `-webkit-text-stroke:${theme.captionStroke}px ${theme.night};paint-order:stroke fill}` +
    `.kino-word-active{color:${theme.mint}}` +
    `</style><div class="kino-cap">${body}</div>`
  );
}
```

`escapeHtml` is not optional politeness: the DOM path passes caption text as React children, which escape by construction. Injecting the same text as an HTML string removes that guarantee, and spec text is author-controlled but not always author-written.

- [ ] **Step 4: Run the caption tests**

```bash
npx vitest run tests/compositor-text-markup.test.ts -t caption
```

Expected: the four `captionMarkup` tests PASS; the kicker and disclosure ones still fail.

- [ ] **Step 5: Port the remaining four, one at a time**

For each of `kickerMarkup`, `textMarkup`, `disclosureMarkup` and `filmMarkup`: read the corresponding component in `components.tsx` (`Kicker`, `TextOverlay`, `Disclosure`, `FilmFinish`), write the markup function, register it in `registry.ts` with `createHtmlSource`, and run the matching parity row from Task 15 before starting the next one.

`filmMarkup` is the one to watch: `FilmFinish` is a vignette plus grain scaled by `theme.film`, and grain must stay frame-deterministic. If the component's grain derives from the frame index, the markup must too; if it derives from a static noise asset, that asset needs inlining (Task 9) or the grain vanishes from the raster.

- [ ] **Step 6: Register all five sources**

In `registry.ts`, for each layer id `layersAt` emits, add a `createHtmlSource` built from the matching markup function — `caption${i}`, `kicker${i}`, `text${i}_${j}`, `disclosure`, `film`. Caption sources pass `hasTier2: false` and rely on the `keyed` cadence from the active-word key.

- [ ] **Step 7: Run the full markup suite**

```bash
npx vitest run tests/compositor-text-markup.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 8: Commit**

```bash
git add src/render/native/page/compositor/textMarkup.ts src/render/native/page/compositor/registry.ts tests/compositor-text-markup.test.ts
git commit -s -m "feat(compositor): html markup ports for caption, kicker, text, disclosure and film"
```

---

### Task 14: Frame cache separation

**Files:**
- Modify: `src/render/native/frameCache.ts`
- Test: `tests/compositor-framecache.test.ts`

**Interfaces:**
- Consumes: `frameSignatures` from `frameCache.js`.
- Produces: `frameSignatures` gains a `compositor?: boolean` option.

Both paths are now reachable on one machine, so a cached DOM-path frame must never be served to a compositor render or the reverse.

- [ ] **Step 1: Write the failing test**

Create `tests/compositor-framecache.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { frameSignatures } from "../src/render/native/frameCache.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
};
const bg = { kind: "glow" as const, image: null, customCode: null, shaderCode: null, params: {}, keyframes: [], triggers: [] };
const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: bg, disclosure: "", segments: [{ kind: "scene", caption: "hi", startSec: 0, endSec: 2 }],
};

const sigs = (compositor: boolean) =>
  frameSignatures({
    props, publicDir: mkdtempSync(join(tmpdir(), "fc-")), pageJsHash: "abc",
    width: 1080, height: 1920, total: 10, fps: 30, mode: "sw", compositor,
  });

describe("frameSignatures — compositor separation", () => {
  it("gives DOM-path and compositor frames different signatures", () => {
    expect(sigs(false)[0]).not.toBe(sigs(true)[0]);
  });

  it("is stable for the same path", () => {
    expect(sigs(true)[0]).toBe(sigs(true)[0]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/compositor-framecache.test.ts
```

Expected: FAIL — the two signatures are equal, because `compositor` is not part of the hash.

- [ ] **Step 3: Add the discriminator**

In `src/render/native/frameCache.ts`:

Bump the version constant:

```ts
const VERSION = 3;
```

Add the option to the `frameSignatures` signature:

```ts
  /** Compositor vs DOM path — different pixels, must never cross-serve. */
  compositor?: boolean;
```

Destructure it with a default and add it to `globalSig`'s payload:

```ts
  const compositor = opts.compositor ?? false;
```

```ts
      v: VERSION,
      compositor,
      width,
```

- [ ] **Step 4: Pass the flag from the engine**

In `src/render/native/engine.ts`, at the `frameSignatures({...})` call site, add:

```ts
    compositor: process.env.KINO_COMPOSITOR === "1",
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run tests/compositor-framecache.test.ts tests/cache.test.ts
```

Expected: PASS. `cache.test.ts` must also pass — the `VERSION` bump invalidates existing caches, which is correct and expected.

- [ ] **Step 6: Commit**

```bash
git add src/render/native/frameCache.ts src/render/native/engine.ts tests/compositor-framecache.test.ts
git commit -s -m "fix(cache): separate compositor and DOM-path frame signatures"
```

---

### Task 15: The parity harness

**Files:**
- Create: `tests/render-compositor-parity.test.ts`

**Interfaces:**
- Consumes: `renderStills` from `src/render/render.js`; `magick` from `tests/magick.js`.
- Produces: the coverage matrix that gates the flag flip. Task 13's Step 5 runs this repeatedly.

- [ ] **Step 1: Write the harness**

Create `tests/render-compositor-parity.test.ts`:

```ts
// Parity gate: every provider, rendered both ways, compared. Byte equality is not achievable —
// GL blending and Chromium's rasterizer disagree on antialiased edges — so the gate is a mean
// absolute difference threshold, per the spec.
import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps, KinoSegment } from "../src/render/props.js";

const PARITY_THRESHOLD = 0.01;

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
};
const canvasBg = {
  kind: "custom" as const, image: null, shaderCode: null,
  customCode: "const w=ctx.canvas.width,h=ctx.canvas.height;const g=ctx.createLinearGradient(0,0,w,h);g.addColorStop(0,'#0b1020');g.addColorStop(1,'#0c8d64');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);",
  params: {}, keyframes: [], triggers: [],
};

const mk = (segments: KinoSegment[], over: Partial<KinoProps> = {}): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: canvasBg, disclosure: "", segments, ...over,
});

const motion = {
  html: `<style>.c{position:absolute;left:10%;right:10%;top:35%;bottom:35%;border-radius:48px;background:#80e2b4}</style><div class="c"></div>`,
  params: {}, keyframes: [], triggers: [],
};

// One entry per provider the compositor must cover.
const MATRIX: Array<{ name: string; props: KinoProps; frame: number }> = [
  { name: "canvas2d-background", props: mk([{ kind: "scene", caption: "", startSec: 0, endSec: 2 }]), frame: 10 },
  { name: "static-motion", props: mk([{ kind: "motion", caption: "", startSec: 0, endSec: 2, motion }]), frame: 15 },
  { name: "motion-overlay", props: mk([{ kind: "scene", caption: "", startSec: 0, endSec: 2, motionOverlay: motion }]), frame: 15 },
  { name: "phrase-caption", props: mk([{ kind: "scene", caption: "deterministic by design", startSec: 0, endSec: 2 }]), frame: 20 },
  {
    name: "words-caption",
    props: mk([{
      kind: "scene", caption: "ship it fast", startSec: 0, endSec: 3, captionMode: "words",
      words: [
        { word: "ship", start: 0.0, end: 0.5 },
        { word: "it", start: 0.5, end: 0.9 },
        { word: "fast", start: 0.9, end: 1.6 },
      ],
    }]),
    frame: 25,
  },
  { name: "disclosure", props: mk([{ kind: "scene", caption: "", startSec: 0, endSec: 2 }], { disclosure: "AI generated" }), frame: 10 },
  { name: "film-finish", props: mk([{ kind: "scene", caption: "", startSec: 0, endSec: 2 }], { theme: { ...theme, film: 1 } }), frame: 10 },
];

async function renderOne(props: KinoProps, frame: number, compositor: boolean): Promise<string> {
  if (compositor) process.env.KINO_COMPOSITOR = "1";
  else delete process.env.KINO_COMPOSITOR;
  const [png] = await renderStills({
    props,
    publicDir: mkdtempSync(join(tmpdir(), "parity-pub-")),
    format: "9:16",
    frames: [{ frame, name: compositor ? "gl" : "dom" }],
    outDir: mkdtempSync(join(tmpdir(), "parity-out-")),
  });
  return png;
}

const meanDiff = (a: string, b: string) =>
  parseFloat(magick([a, b, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim());

describe("compositor parity with the DOM path", () => {
  for (const { name, props, frame } of MATRIX) {
    it(`${name} matches within ${PARITY_THRESHOLD}`, async () => {
      const dom = await renderOne(props, frame, false);
      const gl = await renderOne(props, frame, true);
      const diff = meanDiff(dom, gl);
      // Surface the number even on success — a diff creeping toward the gate is a warning.
      console.log(`parity ${name}: meanDiff=${diff}`);
      expect(diff).toBeLessThanOrEqual(PARITY_THRESHOLD);
    }, 300000);
  }
});

describe("compositor self-determinism", () => {
  it("renders the same frame identically twice", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      const pngs = await renderStills({
        props: MATRIX[1].props,
        publicDir: mkdtempSync(join(tmpdir(), "det-pub-")),
        format: "9:16",
        frames: [{ frame: 15, name: "a" }, { frame: 15, name: "b" }],
        outDir: mkdtempSync(join(tmpdir(), "det-out-")),
      });
      expect(meanDiff(pngs[0], pngs[1])).toBe(0);
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 300000);
});
```

- [ ] **Step 2: Run it and record which rows fail**

```bash
npm run build && npx vitest run tests/render-compositor-parity.test.ts
```

Every row that fails names a provider whose port is incomplete. Work the list top to bottom — the matrix is ordered from the bottom of the layer stack upward, so an early failure usually explains the later ones.

- [ ] **Step 3: Extend the matrix once the base rows pass**

Add rows for the providers the base matrix does not reach: `shader-background` (a spec with `shaderCode`), `video-cutaway` (a beat with a `source` mp4 and a chrome `frame`), `region-shader` (a beat with `regionShader`), `lottie` (a motion beat whose markup embeds a Lottie canvas), `glass` (markup using `kino-glass`), and `logo`. Each needs its own fixture; follow the shape of the existing entries.

- [ ] **Step 4: Commit**

```bash
git add tests/render-compositor-parity.test.ts
git commit -s -m "test(compositor): parity harness across the provider coverage matrix"
```

---

### Task 16: Visual review and the flag decision

**Files:**
- Modify: `docs/superpowers/specs/2026-07-25-gl-compositor-design.md` (status line only)

**Interfaces:**
- Consumes: a green parity harness.
- Produces: the decision on whether `KINO_COMPOSITOR` flips to on by default. Phase 2 (masks and effects) is unblocked either way, but only on a green harness.

- [ ] **Step 1: Build a real spec both ways**

Pick the "typical" spec the spike used for M1 so the comparison is against a known baseline:

```bash
npm run build
npx kino build <typical-spec.json> --draft
KINO_COMPOSITOR=1 npx kino build <typical-spec.json> --draft
```

- [ ] **Step 2: Run the adversarial visual pass**

Invoke the `adversarial-critique` skill on the compositor build's frames. Thresholds do not catch a caption sitting 3px off, a logo at the wrong scale, or a motion graphic missing an image that the inliner failed to resolve — that is what this pass is for.

- [ ] **Step 3: Measure the real per-frame cost**

```bash
KINO_TIMING=1 KINO_CONCURRENCY=1 KINO_COMPOSITOR=1 npx kino build <typical-spec.json> --draft 2> /tmp/kino-compositor.log
```

Compare against the spike's M1 baseline using the same percentile summary from `scripts/spike/percentiles.mjs`. If the spike's projection was wrong by more than 25% in either direction, say so explicitly when reporting — a projection that missed is worth knowing about before phases 2–4 lean on the same method.

- [ ] **Step 4: Decide**

Flip `KINO_COMPOSITOR` to default-on only if all three hold: the parity harness is green across the full matrix, the visual pass found nothing, and per-frame cost meets the spike's proceed criterion on a real build. If any fails, leave the flag off and record what is outstanding — a default-off compositor with a green core is still a successful phase 1, because phase 2 can build on it.

- [ ] **Step 5: Update the spec status and commit**

Change the spec's status line to record the outcome:

```markdown
**Status:** phase 1 implemented — <flag default-on | flag default-off, outstanding: …>
```

```bash
git add docs/superpowers/specs/2026-07-25-gl-compositor-design.md
git commit -s -m "docs(spec): record phase 1 outcome for the GL compositor"
```

- [ ] **Step 6: Hand off to phase 2**

Masks and per-layer effects get their own spec. The seams are already in place: `MaskRef` and `EffectRef` on `LayerDraw`, threaded through `StageRenderer.draw` as no-ops. The first thing phase 2 should cash in is the glass runtime — with every layer a texture, `registerBackdrop` can hand it the true composite beneath the layer instead of whichever background drew last.
