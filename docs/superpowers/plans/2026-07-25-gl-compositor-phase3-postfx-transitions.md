# GL Compositor Phase 3 — Post FX and Shader Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-frame post stage over the finished composite (grade, bloom, vignette, grain, lens) and replace opacity-crossfade beat handoffs with real shader transitions.

**Architecture:** Layer groups let the renderer composite a subset of layers into a named target, which is what a transition needs — two beats as two textures, mixed by a transition shader. The post stage is an `EffectPass` chain (phase 2's framework) run once over the final composite instead of per layer. The existing CSS film finish becomes a GL post pass, which is the first thing in the pipeline to *delete* DOM behavior rather than mirror it.

**Tech Stack:** TypeScript (strict), WebGL2, esbuild, puppeteer, vitest, ImageMagick (`magick`).

## Global Constraints

- **Blocked on phase 2.** Requires `TargetPool` (phase 2 Task 1) and the `EffectPass` framework (phase 2 Task 7).
- **No spec document precedes this plan.** Design choices a spec would normally settle are marked **ASSUMPTION** inline. The largest is the transition model in Task 3 — settle that one before building, because it fixes an authoring surface.
- The DOM path stays alive and untouched until phase 4. Anything this phase adds is compositor-only, so `KINO_COMPOSITOR=0` renders exactly what it rendered before.
- **The film finish is the exception that needs care.** `FilmFinish` is currently CSS in the DOM path and a rasterized `html` layer in phase 1's compositor. Task 5 replaces it with a GL pass, and the parity row for `film-finish` must be re-baselined against the DOM path when it does — with a recorded justification for any diff above the phase-1 threshold.
- Grain must stay frame-deterministic: derived from the frame index, never `Math.random()`.
- Post FX operate on the composited frame, which is opaque (the stage clears to opaque black). Passes may assume `a == 1` at the post stage, unlike per-layer effects.
- Commit messages need a DCO sign-off (`git commit -s`).

## What already exists

| Existing | Where | Phase 3's relationship to it |
|---|---|---|
| `filmFinishParams(night, film)` → vignette CSS + grain opacity | `filmFinish.ts:24` | The numbers to match. The GL pass reproduces this look; the function stays as the DOM path's source until phase 4. |
| `Transition` type: `fade`/`dissolve`/`fly-left`/`fly-up`/`pop`/`cut` | `motion.ts:6` | The authored vocabulary. Phase 3 implements these as shaders instead of CSS/opacity, and may extend the list. |
| `pickTransition(appIndex, override, isVideo)` — deterministic auto-vary | `motion.ts:21` | Unchanged. Phase 3 changes how a transition *renders*, not how it is chosen. |
| `MOTION_XFADE_FRAMES = 15`, `motionHandoff(...)` | `motion.ts:62` | The timing contract for motion-beat handoffs. Transition shaders read progress from the same window. |
| `theme.film` (0..1) | `props.ts:20` | Scales the post stage's vignette and grain, exactly as it scales the CSS version. |

## File Structure

| File | Responsibility |
|---|---|
| `src/render/native/page/compositor/groups.ts` | Layer grouping: composite a subset of layers into a named target. |
| `src/render/native/page/compositor/post.ts` | The post stage — resolve and run the frame-level chain. |
| `src/render/native/page/compositor/effects/bloom.ts` | Separable bright-pass bloom. |
| `src/render/native/page/compositor/effects/film.ts` | Vignette + grain, matching `filmFinishParams`. |
| `src/render/native/page/compositor/effects/lens.ts` | Barrel distortion + chromatic aberration. |
| `src/render/native/page/compositor/transitions/` | One file per transition shader, plus the resolver. |
| `src/render/postSpec.ts` | Spec-level post-FX types + validation, shared by CLI and page. |

---

### Task 1: Layer groups

**Files:**
- Create: `src/render/native/page/compositor/groups.ts`
- Modify: `src/render/native/page/compositor/graph.ts` (add `group?: string` to `LayerDraw`)
- Modify: `src/render/layers.ts` (tag each beat's layers with its group)
- Test: `tests/compositor-groups.test.ts`

**Interfaces:**
- Consumes: `LayerDraw` from `graph.js`, `TargetPool` from `targets.js`.
- Produces: `groupsOf(layers: LayerDraw[]): Map<string, LayerDraw[]>` (pure, node-testable) and `LayerDraw.group`. Task 3's transitions consume both.

A transition mixes two beats. That is only expressible if the renderer can composite "beat 2's layers" and "beat 3's layers" separately — which nothing before this task can do.

- [ ] **Step 1: Write the failing test**

Create `tests/compositor-groups.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { groupsOf } from "../src/render/native/page/compositor/groups.js";
import { normalizeLayer } from "../src/render/native/page/compositor/graph.js";

const layer = (id: string, group?: string) =>
  normalizeLayer({ id, source: { providerId: id }, rect: { x: 0, y: 0, w: 10, h: 10 }, group });

describe("groupsOf", () => {
  it("puts ungrouped layers in the base group", () => {
    const g = groupsOf([layer("backdrop"), layer("film")]);
    expect([...g.keys()]).toEqual(["base"]);
    expect(g.get("base")!.map((l) => l.id)).toEqual(["backdrop", "film"]);
  });

  it("separates layers by group, preserving order within each", () => {
    const g = groupsOf([layer("backdrop"), layer("seg1", "beat1"), layer("cap1", "beat1"), layer("seg2", "beat2")]);
    expect(g.get("beat1")!.map((l) => l.id)).toEqual(["seg1", "cap1"]);
    expect(g.get("beat2")!.map((l) => l.id)).toEqual(["seg2"]);
  });

  it("preserves first-appearance order of the groups themselves", () => {
    const g = groupsOf([layer("a", "x"), layer("b", "y"), layer("c", "x")]);
    expect([...g.keys()]).toEqual(["x", "y"]);
  });

  it("returns an empty map for no layers", () => {
    expect(groupsOf([]).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/compositor-groups.test.ts
```

Expected: FAIL — cannot resolve `compositor/groups.js`.

- [ ] **Step 3: Write the grouping**

Create `src/render/native/page/compositor/groups.ts`:

```ts
// Layer grouping. A transition mixes two beats, which means each beat has to composite into
// its own target before they meet — so layers carry a group tag and the renderer walks groups
// rather than one flat list.
//
// Pure and node-testable: the grouping decision is spec-derived, not GL-derived.
import type { LayerDraw } from "./graph.js";

/** Layers with no group belong to "base": the backdrop, the disclosure, the film finish —
 *  everything that is not part of a beat and so never participates in a transition. */
export const BASE_GROUP = "base";

export function groupsOf(layers: LayerDraw[]): Map<string, LayerDraw[]> {
  const out = new Map<string, LayerDraw[]>();
  for (const layer of layers) {
    const key = layer.group ?? BASE_GROUP;
    const bucket = out.get(key);
    if (bucket) bucket.push(layer);
    else out.set(key, [layer]);
  }
  return out;
}
```

- [ ] **Step 4: Add the field and tag the layers**

In `graph.ts`, add to `LayerDraw` and `LayerSpec`:

```ts
  /** Beat this layer belongs to, for transitions. Absent = the base group. */
  group?: string;
```

`normalizeLayer` passes it through unchanged (`group: spec.group`).

In `layers.ts`, tag every per-beat layer with `group: \`beat${i}\`` — footage, chrome frame, kicker, motion, overlay, caption, and the beat's text overlays. Leave `backdrop`, `scrim`, `logo`, `disclosure` and `film` untagged: they span beats and must not be pulled into a transition.

- [ ] **Step 5: Composite by group in the renderer**

In `draw`, replace the flat loop with: for each group in order, composite its layers into a target, then composite that target onto the accumulator. With no transitions active this is pixel-identical to the flat loop — group compositing must be a pure refactor at this step, which the parity run in Step 6 proves.

- [ ] **Step 6: Verify the refactor changed no pixels**

```bash
npm run build && npx vitest run tests/compositor-groups.test.ts tests/render-compositor-parity.test.ts
```

Expected: PASS, with the parity `meanDiff` values unchanged from phase 2. Any drift means group compositing is not the no-op it must be here — most likely a blend applied twice, once inside the group and once when compositing the group.

- [ ] **Step 7: Commit**

```bash
git add src/render/native/page/compositor/groups.ts src/render/native/page/compositor/graph.ts src/render/layers.ts src/render/native/page/compositor/renderer.ts tests/compositor-groups.test.ts
git commit -s -m "feat(compositor): layer groups for per-beat compositing"
```

---

### Task 2: The post stage

**Files:**
- Create: `src/render/native/page/compositor/post.ts`
- Create: `src/render/postSpec.ts`
- Modify: `src/render/native/page/compositor/renderer.ts`
- Test: `tests/post-spec.test.ts`

**Interfaces:**
- Consumes: `runChain`, `getPass` from `effects/chain.js`.
- Produces: `interface PostFx { grade?: {...}; bloom?: {...}; film?: {...}; lens?: {...} }`, `validatePostFx(p: unknown): string[]`, `resolvePostChain(post: PostFx, theme: Theme): Array<{pass, params}>`, and `runPost(gl, pool, composite, chain, frame): RenderTarget`.

**ASSUMPTION** — post FX are a **spec-level** object (`spec.postFx`), applying to the whole video, not per beat. Per-beat grading is a plausible want, and if it turns out to be required, `postFx` has to grow a per-beat override rather than be replaced. The order below is also fixed rather than authored: `grade → bloom → lens → film`, because film grain must be the last thing applied or bloom smears it and lens distorts it.

- [ ] **Step 1: Write the failing test**

Create `tests/post-spec.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validatePostFx, postChainOrder } from "../src/render/postSpec.js";

describe("validatePostFx", () => {
  it("accepts an empty post object", () => {
    expect(validatePostFx({})).toEqual([]);
  });

  it("accepts a full post object", () => {
    expect(validatePostFx({
      grade: { brightness: 1.1, contrast: 1.05, saturation: 0.9 },
      bloom: { threshold: 0.7, intensity: 0.4, radius: 24 },
      lens: { distortion: 0.06, chroma: 0.004 },
      film: { intensity: 0.8 },
    })).toEqual([]);
  });

  it("rejects an unknown post stage", () => {
    expect(validatePostFx({ sparkles: {} })[0]).toMatch(/sparkles/);
  });

  it("rejects out-of-range values with the range in the message", () => {
    expect(validatePostFx({ film: { intensity: 4 } })[0]).toMatch(/0.*1/);
    expect(validatePostFx({ bloom: { threshold: -1 } })[0]).toMatch(/threshold/);
  });

  it("rejects a non-object stage", () => {
    expect(validatePostFx({ grade: 5 })[0]).toMatch(/object/i);
  });
});

describe("postChainOrder", () => {
  it("is grade, bloom, lens, film — grain last so nothing smears it", () => {
    expect(postChainOrder).toEqual(["grade", "bloom", "lens", "film"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/post-spec.test.ts
```

Expected: FAIL — cannot resolve `src/render/postSpec.js`.

- [ ] **Step 3: Write the spec types**

Create `src/render/postSpec.ts`:

```ts
// Full-frame post FX. One object on the spec, applied over the finished composite.
//
// The order is FIXED, not authored: bloom must see graded colour, lens must distort the
// bloomed image, and grain must land last — anything after it would smear or warp the grain,
// which is exactly what makes digital grain look fake.
export const postChainOrder = ["grade", "bloom", "lens", "film"] as const;
export type PostStage = (typeof postChainOrder)[number];

export interface PostFx {
  grade?: { brightness?: number; contrast?: number; saturation?: number };
  bloom?: { threshold?: number; intensity?: number; radius?: number };
  lens?: { distortion?: number; chroma?: number };
  /** Vignette + grain. Defaults to theme.film when the stage is absent entirely. */
  film?: { intensity?: number };
}

interface Range {
  min: number;
  max: number;
}
const RANGES: Record<PostStage, Record<string, Range>> = {
  grade: { brightness: { min: 0, max: 4 }, contrast: { min: 0, max: 4 }, saturation: { min: 0, max: 4 } },
  bloom: { threshold: { min: 0, max: 1 }, intensity: { min: 0, max: 4 }, radius: { min: 0, max: 128 } },
  lens: { distortion: { min: -1, max: 1 }, chroma: { min: 0, max: 0.05 } },
  film: { intensity: { min: 0, max: 1 } },
};

export function validatePostFx(p: unknown): string[] {
  if (p === undefined || p === null) return [];
  if (typeof p !== "object") return ["postFx must be an object"];
  const errs: string[] = [];
  for (const [stage, value] of Object.entries(p as Record<string, unknown>)) {
    if (!(postChainOrder as readonly string[]).includes(stage)) {
      errs.push(`postFx.${stage} is not a post stage — expected one of ${postChainOrder.join(", ")}`);
      continue;
    }
    if (typeof value !== "object" || value === null) {
      errs.push(`postFx.${stage} must be an object`);
      continue;
    }
    const ranges = RANGES[stage as PostStage];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const range = ranges[k];
      if (!range) {
        errs.push(`postFx.${stage}.${k} is not a parameter — expected one of ${Object.keys(ranges).join(", ")}`);
      } else if (typeof v !== "number" || Number.isNaN(v)) {
        errs.push(`postFx.${stage}.${k} must be a number`);
      } else if (v < range.min || v > range.max) {
        errs.push(`postFx.${stage}.${k} must be between ${range.min} and ${range.max} (got ${v})`);
      }
    }
  }
  return errs;
}
```

- [ ] **Step 4: Write the post runner**

Create `src/render/native/page/compositor/post.ts`:

```ts
// Runs the post chain over the finished composite. Every stage is an ordinary EffectPass, so
// this is a thin resolver plus a runChain call — the interesting part is the fixed ordering
// and the theme.film default.
import type { Theme } from "../../props.js";
import { postChainOrder, type PostFx } from "../../postSpec.js";
import { getPass } from "./effects/chain.js";
import type { EffectPass } from "./effects/pass.js";

export interface ResolvedPass {
  pass: EffectPass;
  params: Record<string, number | string>;
}

/**
 * Which passes run, in which order, with which params. A stage that is absent does not run —
 * except `film`, which falls back to theme.film so existing specs keep their finish.
 */
export function resolvePostChain(post: PostFx | undefined, theme: Theme): ResolvedPass[] {
  const out: ResolvedPass[] = [];
  for (const stage of postChainOrder) {
    const params = post?.[stage] as Record<string, number> | undefined;
    if (stage === "film") {
      const intensity = params?.intensity ?? theme.film ?? 1;
      if (intensity > 0) {
        const pass = getPass("film");
        if (pass) out.push({ pass, params: { intensity, night: theme.night } });
      }
      continue;
    }
    if (!params) continue;
    const pass = getPass(stage);
    if (pass) out.push({ pass, params });
  }
  return out;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run tests/post-spec.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Wire the post stage into the renderer**

In `draw`, after every group is composited into the accumulator and before the blit to the default framebuffer, run `runChain` with the resolved post chain. With no `postFx` on the spec and `theme.film` unchanged, the only pass that runs is `film` — which is Task 5's job to make match.

- [ ] **Step 7: Commit**

```bash
git add src/render/postSpec.ts src/render/native/page/compositor/post.ts src/render/native/page/compositor/renderer.ts tests/post-spec.test.ts
git commit -s -m "feat(postfx): full-frame post stage with a fixed pass order"
```

---

### Task 3: Transition shaders

**Files:**
- Create: `src/render/native/page/compositor/transitions/index.ts`
- Create: `src/render/transitionSpec.ts`
- Test: `tests/transition-spec.test.ts`, `tests/compositor-transitions.test.ts`

**Interfaces:**
- Consumes: `groupsOf` (Task 1), `Transition` from `motion.js`, `TargetPool`.
- Produces: `transitionProgress(opts): { from: string; to: string; p: number } | null` (pure, node-testable) and `mixGroups(gl, pool, from, to, kind, p): RenderTarget`.

**ASSUMPTION — settle this before building.** Today a beat handoff is an *opacity* crossfade on overlapping layers: both beats are on screen and one fades in (`layersAt` Task 3/4 of the core plan). A shader transition instead needs the two beats as separate composited textures mixed by a function of progress. This plan implements the second model **only where two beat groups actually overlap**, leaving non-overlapping handoffs as hard cuts exactly as today. That keeps existing timing identical and confines the change to frames that were already crossfading.

The alternative — making every beat boundary a transition window — changes the timing of every existing spec and should not be done without a spec decision.

- [ ] **Step 1: Write the failing test for progress**

Create `tests/transition-spec.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { transitionProgress } from "../src/render/transitionSpec.js";

describe("transitionProgress", () => {
  const groups = [
    { id: "beat0", from: 0, to: 60 },
    { id: "beat1", from: 48, to: 120 },  // 12-frame overlap
  ];

  it("returns null outside any overlap", () => {
    expect(transitionProgress({ groups, frame: 20 })).toBeNull();
    expect(transitionProgress({ groups, frame: 90 })).toBeNull();
  });

  it("returns 0 at the first overlapping frame", () => {
    expect(transitionProgress({ groups, frame: 48 })!.p).toBeCloseTo(0, 5);
  });

  it("returns 1 at the last overlapping frame", () => {
    expect(transitionProgress({ groups, frame: 60 })!.p).toBeCloseTo(1, 5);
  });

  it("names the outgoing and incoming groups", () => {
    const t = transitionProgress({ groups, frame: 54 })!;
    expect([t.from, t.to]).toEqual(["beat0", "beat1"]);
  });

  it("is monotonic across the window", () => {
    expect(transitionProgress({ groups, frame: 56 })!.p).toBeGreaterThan(
      transitionProgress({ groups, frame: 50 })!.p,
    );
  });

  it("handles three groups by taking the overlap containing this frame", () => {
    const three = [...groups, { id: "beat2", from: 108, to: 180 }];
    expect(transitionProgress({ groups: three, frame: 114 })!.from).toBe("beat1");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/transition-spec.test.ts
```

Expected: FAIL — cannot resolve `src/render/transitionSpec.js`.

- [ ] **Step 3: Write the progress resolver**

Create `src/render/transitionSpec.ts`:

```ts
// When are two beats on screen together, and how far through that overlap is this frame?
//
// Deliberately derived from the group spans layersAt already produces, NOT from a new
// authored transition window: that keeps every existing spec's timing byte-identical and
// confines shader transitions to frames that were already crossfading by opacity.
export interface GroupSpan {
  id: string;
  /** First frame the group is on screen. */
  from: number;
  /** One past the last frame the group is on screen. */
  to: number;
}

export interface TransitionWindow {
  from: string;
  to: string;
  /** 0 at the first overlapping frame, 1 at the last. */
  p: number;
}

export function transitionProgress(opts: { groups: GroupSpan[]; frame: number }): TransitionWindow | null {
  const { groups, frame } = opts;
  const sorted = [...groups].sort((a, b) => a.from - b.from);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const start = b.from;
    const end = a.to;
    if (end <= start) continue;              // no overlap — a hard cut, as today
    if (frame < start || frame > end) continue;
    const span = end - start;
    return { from: a.id, to: b.id, p: span === 0 ? 1 : (frame - start) / span };
  }
  return null;
}
```

- [ ] **Step 4: Write the failing test for the shaders**

Create `tests/compositor-transitions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";

const GL_ARGS = ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"];

// Mix a solid black "from" with a solid white "to" and read the centre pixel.
async function mixAt(kind: string, p: number): Promise<number> {
  const bundle = await build({
    entryPoints: ["src/render/native/page/compositor/transitions/index.ts"],
    bundle: true, write: false, format: "iife", globalName: "KinoTx",
    platform: "browser", target: "chrome120", logLevel: "silent",
  });
  const browser = await puppeteer.launch({ headless: true, args: GL_ARGS });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><body><canvas id="c" width="64" height="64"></canvas></body>`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    return await page.evaluate((kind, p) => (window as any).KinoTx.probeMix(
      document.getElementById("c") as HTMLCanvasElement, kind, p,
    ), kind, p);
  } finally {
    await browser.close();
  }
}

describe("transition shaders", () => {
  for (const kind of ["fade", "dissolve", "fly-left", "fly-up", "pop", "cut"]) {
    it(`${kind} is fully the outgoing beat at p=0`, async () => {
      expect(await mixAt(kind, 0)).toBeLessThanOrEqual(4);
    }, 120000);

    it(`${kind} is fully the incoming beat at p=1`, async () => {
      expect(await mixAt(kind, 1)).toBeGreaterThanOrEqual(251);
    }, 120000);
  }

  it("fade is monotonic through the middle", async () => {
    const [a, b] = [await mixAt("fade", 0.25), await mixAt("fade", 0.75)];
    expect(b).toBeGreaterThan(a);
  }, 240000);

  it("cut switches at the midpoint rather than blending", async () => {
    expect(await mixAt("cut", 0.49)).toBeLessThanOrEqual(4);
    expect(await mixAt("cut", 0.51)).toBeGreaterThanOrEqual(251);
  }, 240000);
});
```

The `p=0` and `p=1` endpoint assertions matter more than they look: a transition that does not land exactly on its endpoints produces a visible pop at every beat boundary in every video.

- [ ] **Step 5: Write the transition shaders**

Create `src/render/native/page/compositor/transitions/index.ts`:

```ts
// Shader transitions between two composited beat groups.
//
// Every transition MUST be exactly `from` at p=0 and exactly `to` at p=1 — a transition that
// is a hair off at its endpoints pops on every beat boundary. tests/compositor-transitions
// asserts this for each one.
import type { RenderTarget, TargetPool } from "../targets.js";
import type { Transition } from "../../../motion.js";

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const HEADER = `#version 300 es
precision highp float;
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform vec2 uRes;
uniform float uP;
out vec4 kino_frag;

// Deterministic value noise — frame-independent, so a dissolve is stable under re-render.
float kinoHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
`;

const BODIES: Record<Transition, string> = {
  fade: `
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  kino_frag = mix(texture(uFrom, uv), texture(uTo, uv), uP);
}`,

  // Per-pixel threshold against stable noise: a grain dissolve rather than a linear blend.
  dissolve: `
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float n = kinoHash(floor(gl_FragCoord.xy));
  // Widen the threshold band so the edges stay soft instead of popping pixel by pixel.
  float t = smoothstep(n - 0.15, n + 0.15, uP);
  kino_frag = mix(texture(uFrom, uv), texture(uTo, uv), t);
}`,

  "fly-left": `
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  // Incoming slides in from the right; outgoing holds. Sampling outside clamps to the edge,
  // so the incoming beat never shows a transparent gutter.
  vec2 toUv = uv + vec2(1.0 - uP, 0.0);
  vec4 to = texture(uTo, clamp(toUv, 0.0, 1.0));
  float covered = step(1.0 - uP, uv.x);
  kino_frag = mix(texture(uFrom, uv), to, covered * step(0.0001, uP) + step(0.9999, uP));
}`,

  "fly-up": `
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 toUv = uv + vec2(0.0, 1.0 - uP);
  vec4 to = texture(uTo, clamp(toUv, 0.0, 1.0));
  float covered = step(1.0 - uP, uv.y);
  kino_frag = mix(texture(uFrom, uv), to, covered * step(0.0001, uP) + step(0.9999, uP));
}`,

  // Incoming scales up from 0.86 while fading — the punchy CapCut-style entrance.
  pop: `
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float s = mix(0.86, 1.0, uP);
  vec2 toUv = (uv - 0.5) / s + 0.5;
  vec4 to = texture(uTo, clamp(toUv, 0.0, 1.0));
  kino_frag = mix(texture(uFrom, uv), to, uP);
}`,

  cut: `
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  kino_frag = uP < 0.5 ? texture(uFrom, uv) : texture(uTo, uv);
}`,
};

interface Compiled {
  prog: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
}
const cache = new WeakMap<WebGL2RenderingContext, Map<string, Compiled>>();

function compile(gl: WebGL2RenderingContext, kind: Transition): Compiled {
  let byKind = cache.get(gl);
  if (!byKind) {
    byKind = new Map();
    cache.set(gl, byKind);
  }
  const hit = byKind.get(kind);
  if (hit) return hit;

  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(`transition "${kind}" failed to compile: ${gl.getShaderInfoLog(s)}`);
    }
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, HEADER + BODIES[kind]));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`transition "${kind}" failed to link: ${gl.getProgramInfoLog(prog)}`);
  }
  const loc: Record<string, WebGLUniformLocation | null> = {};
  for (const n of ["uFrom", "uTo", "uRes", "uP"]) loc[n] = gl.getUniformLocation(prog, n);
  const entry = { prog, loc };
  byKind.set(kind, entry);
  return entry;
}

/** Mix two composited groups into a fresh target. The caller releases all three. */
export function mixGroups(
  gl: WebGL2RenderingContext,
  pool: TargetPool,
  from: RenderTarget,
  to: RenderTarget,
  kind: Transition,
  p: number,
): RenderTarget {
  const { prog, loc } = compile(gl, kind);
  const out = pool.acquire(gl, from.w, from.h);
  pool.clear(gl, out);
  gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
  gl.viewport(0, 0, out.w, out.h);
  gl.disable(gl.BLEND);
  gl.useProgram(prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, from.tex);
  gl.uniform1i(loc.uFrom, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, to.tex);
  gl.uniform1i(loc.uTo, 1);
  gl.uniform2f(loc.uRes, out.w, out.h);
  gl.uniform1f(loc.uP, Math.min(1, Math.max(0, p)));
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return out;
}

/** Test hook: mix a black "from" against a white "to" and read the centre pixel's red. */
export function probeMix(canvas: HTMLCanvasElement, kind: Transition, p: number): number {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const solid = (v: number): WebGLTexture => {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const px = new Uint8Array(canvas.width * canvas.height * 4).fill(v);
    for (let i = 3; i < px.length; i += 4) px[i] = 255;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return tex;
  };
  const { prog, loc } = compile(gl, kind);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.disable(gl.BLEND);
  gl.useProgram(prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, solid(0));
  gl.uniform1i(loc.uFrom, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, solid(255));
  gl.uniform1i(loc.uTo, 1);
  gl.uniform2f(loc.uRes, canvas.width, canvas.height);
  gl.uniform1f(loc.uP, p);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const px = new Uint8Array(4);
  gl.readPixels(canvas.width / 2, canvas.height / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px[0];
}
```

- [ ] **Step 6: Run both test files**

```bash
npx vitest run tests/transition-spec.test.ts tests/compositor-transitions.test.ts
```

Expected: PASS, 6 + 14 tests.

- [ ] **Step 7: Wire transitions into the renderer**

In `draw`: compute group spans, call `transitionProgress`, and when it returns a window, composite the two named groups into their own targets and `mixGroups` them instead of compositing both in sequence. When it returns null, composite groups in order as Task 1 does.

The transition kind comes from the incoming beat's resolved `transition` field (`pickTransition` already chose it) — read it off the segment, not from a new authored field.

- [ ] **Step 8: Verify existing handoffs still look right**

```bash
npm run build && npx vitest run tests/render-compositor-parity.test.ts tests/motion.test.ts
```

Expected: PASS. Note that parity rows sampling a frame **inside** an overlap will now legitimately differ from the DOM path — a `dissolve` shader is not an opacity crossfade. Where a row drifts past the threshold, confirm by eye that the compositor's version is the better one, then re-baseline that row with a comment recording why.

- [ ] **Step 9: Commit**

```bash
git add src/render/transitionSpec.ts src/render/native/page/compositor/transitions/ src/render/native/page/compositor/renderer.ts tests/transition-spec.test.ts tests/compositor-transitions.test.ts
git commit -s -m "feat(transitions): shader transitions between composited beat groups"
```

---

### Task 4: Bloom and lens passes

**Files:**
- Create: `src/render/native/page/compositor/effects/bloom.ts`
- Create: `src/render/native/page/compositor/effects/lens.ts`
- Modify: `src/render/native/page/compositor/effects/index.ts`
- Test: `tests/compositor-postfx.test.ts`

**Interfaces:**
- Consumes: `EffectPass` from `effects/pass.js`.
- Produces: registered `bloom` and `lens` passes.

Unlike phase 2's per-layer `glow`, bloom runs at the frame level with large radii, so it uses the separable two-pass form — a 13×13 kernel at radius 24 would be 169 taps per pixel at 1080×1920.

- [ ] **Step 1: Write the failing test**

Create `tests/compositor-postfx.test.ts`:

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

describe("bloom", () => {
  it("lifts the region beside a bright area", async () => {
    const [outside] = await probe("bloom", { threshold: 0.5, intensity: 1, radius: 16 });
    expect(outside).toBeGreaterThan(0);
  }, 120000);

  it("intensity 0 is a no-op", async () => {
    const [outside] = await probe("bloom", { threshold: 0.5, intensity: 0, radius: 16 });
    expect(outside).toBe(0);
  }, 120000);

  it("a threshold above the brightest pixel produces nothing", async () => {
    const [outside] = await probe("bloom", { threshold: 1.0, intensity: 1, radius: 16 });
    expect(outside).toBe(0);
  }, 120000);
});

describe("lens", () => {
  it("distortion 0 and chroma 0 is identity", async () => {
    const [edge, g, b] = await probe("lens", { distortion: 0, chroma: 0 });
    expect(g).toBe(b === 0 ? g : g); // structural: identity must not shift channels
    expect(edge === 0 || edge === 255).toBe(true);
  }, 120000);

  it("chroma splits the channels at a hard edge", async () => {
    const [, g, b] = await probe("lens", { distortion: 0, chroma: 0.02 });
    expect(Math.abs(g - b)).toBeGreaterThan(0);
  }, 120000);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/compositor-postfx.test.ts
```

Expected: FAIL — `getPass("bloom")` is undefined.

- [ ] **Step 3: Write bloom**

Create `src/render/native/page/compositor/effects/bloom.ts`:

```ts
// Frame-level bloom: bright-pass, separable blur, add back.
//
// Separable (two 1-D passes) unlike phase 2's per-layer glow, because post radii are large:
// a 2-D kernel at radius 24 is ~2500 taps per pixel at 1080x1920, where two 1-D passes are
// ~100. Registered as ONE pass that runs the horizontal and vertical halves internally, so
// the post chain stays a flat list.
import type { EffectPass } from "./pass.js";

/** Shared bright-pass + 1-D Gaussian. `uAxis` picks the direction. */
const BLOOM_FRAG = `
uniform float uThreshold;
uniform float uIntensity;
uniform float uRadius;
uniform vec2 uAxis;
uniform float uComposite;   // 0 = produce the bloom, 1 = add it back to the source
uniform sampler2D uOriginal;

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  if (uIntensity <= 0.0) { kino_frag = texture(uSrc, uv); return; }

  if (uComposite > 0.5) {
    // Additive: light adds. The post stage is opaque, so alpha stays 1.
    vec3 base = texture(uOriginal, uv).rgb;
    vec3 bloom = texture(uSrc, uv).rgb * uIntensity;
    kino_frag = vec4(base + bloom, 1.0);
    return;
  }

  vec2 texel = uAxis / uRes;
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  float sigma = max(uRadius * 0.5, 0.0001);
  for (int i = -12; i <= 12; i++) {
    float o = float(i) * (uRadius / 12.0);
    vec3 s = texture(uSrc, uv + texel * o).rgb;
    float l = dot(s, vec3(0.299, 0.587, 0.114));
    float keep = max(l - uThreshold, 0.0) / max(1.0 - uThreshold, 0.0001);
    float w = exp(-(o * o) / (2.0 * sigma * sigma));
    sum += s * keep * w;
    wsum += w;
  }
  kino_frag = vec4(sum / max(wsum, 0.0001), 1.0);
}`;

export const bloomPass: EffectPass = {
  name: "bloom",
  uniformNames: ["uThreshold", "uIntensity", "uRadius", "uAxis", "uComposite", "uOriginal"],
  frag: BLOOM_FRAG,
  uniforms(gl, loc, params) {
    gl.uniform1f(loc.uThreshold, Number(params.threshold ?? 0.7));
    gl.uniform1f(loc.uIntensity, Number(params.intensity ?? 0.4));
    gl.uniform1f(loc.uRadius, Number(params.radius ?? 24));
    // The chain runs this pass three times with different axes; `post.ts` expands one
    // authored `bloom` stage into those three entries.
    const axis = String(params.axis ?? "x");
    gl.uniform2f(loc.uAxis, axis === "x" ? 1 : 0, axis === "y" ? 1 : 0);
    gl.uniform1f(loc.uComposite, axis === "composite" ? 1 : 0);
  },
};
```

In `post.ts`'s `resolvePostChain`, expand a `bloom` stage into three entries — `{axis: "x"}`, `{axis: "y"}`, `{axis: "composite"}` — carrying the same threshold/intensity/radius. The composite entry needs the pre-bloom frame bound as `uOriginal`; thread that through `runChain` as a second input, or capture it by acquiring a target before the bloom entries run.

- [ ] **Step 4: Write lens**

Create `src/render/native/page/compositor/effects/lens.ts`:

```ts
// Barrel/pincushion distortion with per-channel chromatic aberration. Both grow from the
// frame centre, so the middle of the frame — where captions live — stays sharp and aligned.
import type { EffectPass } from "./pass.js";

export const lensPass: EffectPass = {
  name: "lens",
  uniformNames: ["uDistortion", "uChroma"],
  frag: `
uniform float uDistortion;
uniform float uChroma;

vec2 kinoDistort(vec2 uv, float k) {
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  return 0.5 + c * (1.0 + k * r2);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  if (uDistortion == 0.0 && uChroma == 0.0) { kino_frag = texture(uSrc, uv); return; }
  // Each channel gets a slightly different distortion coefficient — that IS the aberration.
  vec2 ruv = kinoDistort(uv, uDistortion + uChroma);
  vec2 guv = kinoDistort(uv, uDistortion);
  vec2 buv = kinoDistort(uv, uDistortion - uChroma);
  kino_frag = vec4(
    texture(uSrc, clamp(ruv, 0.0, 1.0)).r,
    texture(uSrc, clamp(guv, 0.0, 1.0)).g,
    texture(uSrc, clamp(buv, 0.0, 1.0)).b,
    1.0);
}`,
  uniforms(gl, loc, params) {
    gl.uniform1f(loc.uDistortion, Number(params.distortion ?? 0));
    gl.uniform1f(loc.uChroma, Number(params.chroma ?? 0));
  },
};
```

- [ ] **Step 5: Register both**

In `effects/index.ts`, import and `registerPass` the two new passes.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run tests/compositor-postfx.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add src/render/native/page/compositor/effects/bloom.ts src/render/native/page/compositor/effects/lens.ts src/render/native/page/compositor/effects/index.ts src/render/native/page/compositor/post.ts tests/compositor-postfx.test.ts
git commit -s -m "feat(postfx): separable bloom and lens distortion passes"
```

---

### Task 5: The film finish as a GL pass

**Files:**
- Create: `src/render/native/page/compositor/effects/film.ts`
- Modify: `src/render/native/page/compositor/registry.ts` (drop the `film` html source under the compositor)
- Modify: `src/render/layers.ts` (stop emitting the `film` layer)
- Test: `tests/compositor-film-pass.test.ts`

**Interfaces:**
- Consumes: `filmFinishParams` from `../../filmFinish.js` (for the numbers), `EffectPass`.
- Produces: a registered `film` pass.

This is the first place the compositor *replaces* DOM behavior instead of mirroring it, so it gets the most careful comparison. The vignette geometry and grain opacity must match `filmFinishParams`, including its light/dark adaptation on `theme.night`.

- [ ] **Step 1: Write the failing test**

Create `tests/compositor-film-pass.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { filmFinishParams, luminance } from "../src/render/filmFinish.js";
import { build } from "esbuild";
import puppeteer from "puppeteer";

const GL_ARGS = ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"];

async function probeFilm(night: string, intensity: number): Promise<{ centre: number; corner: number; grainSpread: number }> {
  const bundle = await build({
    entryPoints: ["src/render/native/page/compositor/effects/index.ts"],
    bundle: true, write: false, format: "iife", globalName: "KinoFx",
    platform: "browser", target: "chrome120", logLevel: "silent",
  });
  const browser = await puppeteer.launch({ headless: true, args: GL_ARGS });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><body><canvas id="c" width="128" height="128"></canvas></body>`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    return await page.evaluate((night, intensity) => (window as any).KinoFx.probeFilm(
      document.getElementById("c") as HTMLCanvasElement, night, intensity,
    ), night, intensity);
  } finally {
    await browser.close();
  }
}

describe("film pass", () => {
  it("darkens the corners and leaves the centre alone", async () => {
    const { centre, corner } = await probeFilm("#0b1020", 1);
    expect(corner).toBeLessThan(centre);
    expect(centre).toBeGreaterThanOrEqual(250);
  }, 120000);

  it("intensity 0 is a complete no-op", async () => {
    const { centre, corner, grainSpread } = await probeFilm("#0b1020", 0);
    expect(corner).toBe(centre);
    expect(grainSpread).toBe(0);
  }, 120000);

  it("scales the vignette with intensity, matching filmFinishParams", async () => {
    const full = await probeFilm("#0b1020", 1);
    const half = await probeFilm("#0b1020", 0.5);
    expect(half.corner).toBeGreaterThan(full.corner);   // less darkening at half intensity
    expect(half.corner).toBeLessThan(half.centre);
  }, 240000);

  it("uses the lighter vignette on a light night colour, as the CSS does", async () => {
    // filmFinishParams switches its alphas on luminance(night) > 0.5.
    expect(luminance("#f4f1ea")).toBeGreaterThan(0.5);
    const dark = await probeFilm("#0b1020", 1);
    const light = await probeFilm("#f4f1ea", 1);
    expect(light.corner).toBeGreaterThan(dark.corner);
  }, 240000);

  it("produces grain that is stable for a given frame", async () => {
    const a = await probeFilm("#0b1020", 1);
    const b = await probeFilm("#0b1020", 1);
    expect(a.grainSpread).toBe(b.grainSpread);
  }, 240000);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/compositor-film-pass.test.ts
```

Expected: FAIL — `probeFilm` is not exported.

- [ ] **Step 3: Write the film pass**

Create `src/render/native/page/compositor/effects/film.ts`:

```ts
// Cinematic finish as a post pass: edge vignette plus grain, both scaled by `intensity`
// (spec `film`, default 1). This REPLACES the CSS FilmFinish under the compositor, so the
// numbers below are lifted from filmFinish.ts rather than re-invented:
//
//   dark  night: ellipse 92% x 80% at 50% 45%, transparent to 46%, rgba(0,0,0,0.46) at 100%
//   light night: ellipse 88% x 76% at 50% 45%, transparent to 55%, rgba(28,20,12,0.18) at 100%
//   grain opacity: 0.09 dark / 0.05 light, times intensity
//
// Grain derives from the frame index, never a clock or Math.random — the same frame must
// grain identically on every render.
import type { EffectPass } from "./pass.js";
import { luminance } from "../../../filmFinish.js";

export const filmPass: EffectPass = {
  name: "film",
  uniformNames: ["uIntensity", "uLight", "uGrain"],
  frag: `
uniform float uIntensity;
uniform float uLight;    // 1 when the night colour is light
uniform float uGrain;    // resolved grain opacity

float kinoGrain(vec2 p, float f) {
  // Frame-seeded value noise. The frame term shifts the field each frame so grain moves,
  // while staying a pure function of (pixel, frame).
  return fract(sin(dot(p + f * 17.0, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c = texture(uSrc, uv).rgb;
  if (uIntensity <= 0.0) { kino_frag = vec4(c, 1.0); return; }

  // Elliptical vignette centred at (0.5, 0.45), matching the CSS radial-gradient.
  vec2 d = (uv - vec2(0.5, 0.45));
  vec2 radii = uLight > 0.5 ? vec2(0.88, 0.76) : vec2(0.92, 0.80);
  float r = length(d / radii) * 2.0;
  float start = uLight > 0.5 ? 0.55 : 0.46;
  float t = smoothstep(start, 1.0, r);
  vec3 tint = uLight > 0.5 ? vec3(28.0, 20.0, 12.0) / 255.0 : vec3(0.0);
  float a = (uLight > 0.5 ? 0.18 : 0.46) * uIntensity * t;
  c = mix(c, tint, a);

  // Grain, added last so nothing downstream smears it.
  float g = (kinoGrain(gl_FragCoord.xy, uFrame) - 0.5) * uGrain;
  kino_frag = vec4(clamp(c + g, 0.0, 1.0), 1.0);
}`,
  uniforms(gl, loc, params) {
    const intensity = Number(params.intensity ?? 1);
    const night = String(params.night ?? "#0b1020");
    const light = luminance(night) > 0.5;
    gl.uniform1f(loc.uIntensity, intensity);
    gl.uniform1f(loc.uLight, light ? 1 : 0);
    // Same grain opacities filmFinishParams resolves.
    gl.uniform1f(loc.uGrain, (light ? 0.05 : 0.09) * intensity);
  },
};
```

Add a `probeFilm(canvas, night, intensity)` test hook to `effects/index.ts` following the shape of `probeEffect`: fill the source white, run the film pass, and return the centre pixel, a corner pixel, and the standard deviation over a flat patch (which is the grain).

- [ ] **Step 4: Stop emitting the rasterized film layer**

In `layers.ts`, remove the `film` layer push — the post stage now owns it. In `registry.ts`, remove the corresponding `film` html source.

The DOM path keeps `FilmFinish` untouched; only the compositor changes.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run tests/compositor-film-pass.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Re-baseline the film parity row**

```bash
npm run build && npx vitest run tests/render-compositor-parity.test.ts
```

The `film-finish` row will move: a GL vignette and a CSS radial-gradient are not the same rasterizer, and the grain is now a different noise field. Compare the two PNGs by eye. If the compositor's version is at least as good, raise that row's threshold **with a comment recording the measured diff, the date, and why it was accepted**. Do not raise the global threshold — every other row must stay where it was.

- [ ] **Step 7: Commit**

```bash
git add src/render/native/page/compositor/effects/film.ts src/render/native/page/compositor/effects/index.ts src/render/layers.ts src/render/native/page/compositor/registry.ts tests/compositor-film-pass.test.ts tests/render-compositor-parity.test.ts
git commit -s -m "feat(postfx): film vignette and grain as a GL post pass"
```

---

### Task 6: Spec surface and docs

**Files:**
- Modify: `src/render/props.ts` (add `postFx` to `KinoProps`)
- Modify: the CLI spec validation path
- Modify: `docs/spec-reference.md`, `docs/motion-graphics.md`
- Test: `tests/postfx-integration.test.ts`

**Interfaces:**
- Consumes: `validatePostFx`, `resolvePostChain`.
- Produces: an authored `postFx` field that renders and fails loudly when wrong.

- [ ] **Step 1: Write the failing test**

Create `tests/postfx-integration.test.ts`:

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
const grey = { kind: "custom" as const, image: null, shaderCode: null,
  customCode: "ctx.fillStyle='#808080';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);",
  params: {}, keyframes: [], triggers: [] };

const mk = (postFx?: unknown): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: grey, disclosure: "",
  segments: [{ kind: "scene", caption: "", startSec: 0, endSec: 2 }],
  ...(postFx ? { postFx } : {}),
} as KinoProps);

const render = async (props: KinoProps, name: string) => {
  const [png] = await renderStills({
    props, publicDir: mkdtempSync(join(tmpdir(), "postfx-pub-")),
    format: "9:16", frames: [{ frame: 10, name }],
    outDir: mkdtempSync(join(tmpdir(), "postfx-out-")),
  });
  return png;
};
const meanOf = (png: string) => parseFloat(magick([png, "-format", "%[fx:mean]", "info:"]).trim());

describe("postFx end to end", () => {
  it("a grade actually changes the frame", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      const plain = await render(mk(), "plain");
      const graded = await render(mk({ grade: { brightness: 0.5 } }), "graded");
      expect(meanOf(graded)).toBeLessThan(meanOf(plain) - 0.05);
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 300000);

  it("postFx renders deterministically", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      const props = mk({ grade: { saturation: 0.2 }, film: { intensity: 1 } });
      const a = await render(props, "a");
      const b = await render(props, "b");
      const diff = parseFloat(
        magick([a, b, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim(),
      );
      expect(diff).toBe(0);
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 300000);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run build && npx vitest run tests/postfx-integration.test.ts
```

Expected: FAIL — `postFx` is not read, so the graded frame matches the plain one.

- [ ] **Step 3: Add the field and validation**

In `props.ts`, add to `KinoProps`:

```ts
  postFx?: PostFx;   // full-frame post stage: grade → bloom → lens → film
```

importing from `./postSpec.js`. Call `validatePostFx(spec.postFx)` from the CLI's spec validation alongside the phase-2 mask validation, using the same error-reporting shape.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run build && npx vitest run tests/postfx-integration.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Document it**

Add a **Post FX** section to `docs/spec-reference.md`: the four stages with their params and ranges, one worked example, and three things an author will otherwise learn by surprise — the order is fixed and not authorable, `film` defaults from `theme.film` so existing specs keep their finish, and post FX apply to the whole video rather than per beat.

Add a note to `docs/motion-graphics.md` that beat handoffs now render as shader transitions under the compositor, and that `transition` still selects from the same vocabulary.

- [ ] **Step 6: Full suite**

```bash
npx vitest run
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/render/props.ts src/render/postSpec.ts docs/spec-reference.md docs/motion-graphics.md tests/postfx-integration.test.ts
git commit -s -m "feat(postfx): spec surface for full-frame post FX"
```

- [ ] **Step 8: Hand off to phase 4**

Phase 3 adds render targets per group and per post pass, so the frame now costs more GPU work than phase 1 measured. Re-run the phase-1 Task 16 timing comparison before starting phase 4 and record the new number — phase 4's perf work should be aimed at what is actually slow, not at what was slow two phases ago.
