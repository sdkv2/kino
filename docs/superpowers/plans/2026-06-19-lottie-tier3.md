# Tier 3: Embedded Lottie Motion Graphics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let kino embed designer-authored Lottie (`.json` / Bodymovin) animations as a third motion-graphics tier, rendered deterministically via `@remotion/lottie`, in all three motion slots (`kind:"motion"` segments + avatar/app `motionOverlay`).

**Architecture:** Lottie rides the existing `MotionGraphicRef`. `resolveMotionGraphic` dispatches on a (lowercased, allowlisted) file extension: `.json` → a new Tier-3 branch that parses + lints the Lottie and returns `MotionGraphicProps.lottie`. `MotionGraphic.tsx` renders `<Lottie>` (driven by `useCurrentFrame()`, so deterministic) when `data.lottie` is set, scaling playback with a pure `lottiePlaybackRate()` helper. A new fs-free `src/render/lottie.ts` owns parse/lint/warn/rate; `build.ts`/`KinoVideo.tsx` are essentially untouched.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Zod, React + Remotion 4.x, `@remotion/lottie`, Vitest, ImageMagick (`magick`) for pixel assertions.

**Spec:** [docs/superpowers/specs/2026-06-19-lottie-tier3-design.md](../specs/2026-06-19-lottie-tier3-design.md). Read it for rationale; this plan is the build order.

**Conventions to match (existing code):**
- ESM imports use `.js` specifiers even for `.ts` files (e.g. `import ... from "./lottie.js"`).
- Lint functions return `string[]` of human-readable violations (empty = clean), matching `lintMotionHtml`/`lintMotionJs`.
- `resolveMotionGraphic` throws `Motion graphic assets/<source>: <violations joined with "; ">` on lint failure.
- Tests are Vitest; render tests use `renderStills(...)` with a 180000 ms timeout.

---

### Task 1: Add the `@remotion/lottie` dependency

**Files:**
- Modify: `package.json` (dependencies block, near the other `@remotion/*` entries)

- [ ] **Step 1: Add the dependency at the sibling caret range**

In `package.json`, add to `"dependencies"` (keep alphabetical-ish near `@remotion/bundler`):

```json
"@remotion/lottie": "^4.0.0",
```

It must use the **same caret range** (`^4.0.0`) as `@remotion/bundler` / `@remotion/renderer` / `remotion` so it resolves in lockstep. Do **not** hard-pin a version.

- [ ] **Step 2: Install**

Run: `npm install`
Expected: installs `@remotion/lottie` and its `lottie-web` transitive dep; `package-lock.json` updates; no peer-dep errors.

- [ ] **Step 3: Smoke-check the import resolves**

Run: `node -e "import('@remotion/lottie').then(m=>console.log(typeof m.Lottie, typeof m.getLottieMetadata))"`
Expected: prints `function function` (both `Lottie` and `getLottieMetadata` are exported).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add @remotion/lottie dependency (Tier-3 Lottie)"
```

---

### Task 2: Types — `MotionGraphicProps.lottie`/`loop` and schema `loop`

**Files:**
- Modify: `src/render/props.ts` (the `MotionGraphicProps` interface, ~line 70)
- Modify: `src/spec/schema.ts` (the `motionFields` object, ~line 20)
- Test: `tests/lottie.test.ts` (Create)

- [ ] **Step 1: Write the failing schema test**

Create `tests/lottie.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SpecSchema } from "../src/spec/schema.js";

describe("SpecSchema loop field", () => {
  it("accepts loop:true on a motionOverlay", () => {
    const spec = SpecSchema.parse({
      title: "t",
      segments: [
        { kind: "app", asset: "screens/x.png", text: "look", caption: "c",
          motionOverlay: { source: "motion/sparkle.json", loop: true } },
      ],
    });
    expect((spec.segments[0] as any).motionOverlay.loop).toBe(true);
  });

  it("accepts loop on a kind:motion segment and defaults it to undefined when omitted", () => {
    const spec = SpecSchema.parse({
      title: "t",
      segments: [{ kind: "motion", source: "motion/confetti.json", text: "hi", loop: false }],
    });
    expect((spec.segments[0] as any).loop).toBe(false);
    const spec2 = SpecSchema.parse({
      title: "t",
      segments: [{ kind: "motion", source: "motion/confetti.json", text: "hi" }],
    });
    expect((spec2.segments[0] as any).loop).toBeUndefined();
  });

  it("rejects a non-boolean loop", () => {
    expect(() =>
      SpecSchema.parse({ title: "t", segments: [{ kind: "motion", source: "m/x.json", text: "h", loop: 1 }] }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lottie.test.ts -t "loop field"`
Expected: FAIL — `loop` is stripped/unknown, so `.loop` is `undefined` (first two assertions fail) and `loop:1` does not throw.

- [ ] **Step 3: Add `loop` to `motionFields`**

In `src/spec/schema.ts`, change `motionFields` (lines 20-25) to add `loop`:

```ts
const motionFields = {
  source: z.string().min(1),
  params: z.record(z.union([z.number(), z.string()])).optional(),
  keyframes: z.array(BgKeyframe).optional(),
  triggers: z.array(BgTrigger).optional(),
  loop: z.boolean().optional(), // Tier-3 Lottie playback; inert for html/proc graphics
};
```

(Because `motionFields` is spread into the `motion` segment and reused by `MotionGraphicRef` for both overlay slots, this one change covers all three slots.)

- [ ] **Step 4: Add `lottie`/`loop` to `MotionGraphicProps`**

In `src/render/props.ts`, add a `LottieData` type just above `MotionGraphicProps` and two fields inside it:

```ts
// A parsed Lottie (Bodymovin) animation document. Structurally JSON, so it serializes cleanly
// through Remotion inputProps. Validated + linted at resolve time (src/render/lottie.ts).
export type LottieData = Record<string, unknown>;

export interface MotionGraphicProps {
  html: string; // sanitized static markup (Tier 1); "" for procedural AND lottie graphics
  proc?: string; // Tier 2: linted JS source
  lottie?: LottieData; // Tier 3: parsed animationData
  loop?: boolean; // Tier 3 playback (inert for html/proc); default false
  params: Record<string, BgParamValue>;
  keyframes: BgKeyframe[];
  triggers: BgTrigger[];
}
```

- [ ] **Step 5: Run the test to verify it passes + typecheck**

Run: `npx vitest run tests/lottie.test.ts -t "loop field"`
Expected: PASS (3 tests).
Run: `npm run build`
Expected: `tsc` succeeds (no type errors from the new optional fields).

- [ ] **Step 6: Commit**

```bash
git add src/render/props.ts src/spec/schema.ts tests/lottie.test.ts
git commit -m "feat(motion): add loop schema field + lottie/loop props (Tier-3 types)"
```

---

### Task 3: `parseLottie` — JSON + shape + duration validation

**Files:**
- Create: `src/render/lottie.ts`
- Test: `tests/lottie.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/lottie.test.ts`:

```ts
import { parseLottie } from "../src/render/lottie.js";

const minimalLottie = () => ({
  v: "5.7.4", fr: 30, ip: 0, op: 60, w: 1080, h: 1920, layers: [],
});

describe("parseLottie", () => {
  it("parses a minimal valid Lottie", () => {
    const { data } = parseLottie(JSON.stringify(minimalLottie()));
    expect(data.w).toBe(1080);
    expect(data.layers).toEqual([]);
  });
  it("throws on malformed JSON", () => {
    expect(() => parseLottie("{not json")).toThrow(/not valid JSON/i);
  });
  it("throws when core Bodymovin fields are missing", () => {
    const bad = JSON.stringify({ v: "5", w: 10, h: 10 }); // no fr/ip/op/layers
    expect(() => parseLottie(bad)).toThrow(/not a Lottie animation/i);
  });
  it("throws when duration is indeterminable (op <= ip or fr <= 0)", () => {
    const noDur = JSON.stringify({ ...minimalLottie(), op: 0, ip: 0 });
    expect(() => parseLottie(noDur)).toThrow(/determinable duration/i);
    const noFr = JSON.stringify({ ...minimalLottie(), fr: 0 });
    expect(() => parseLottie(noFr)).toThrow(/determinable duration/i);
  });
  it("throws when the top level is not a JSON object", () => {
    expect(() => parseLottie("[1,2,3]")).toThrow(/Lottie/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lottie.test.ts -t "parseLottie"`
Expected: FAIL with "Cannot find module '../src/render/lottie.js'" (file not created yet).

- [ ] **Step 3: Create `src/render/lottie.ts` with `parseLottie`**

```ts
// Tier-3 Lottie support: parse + validate + lint + playback math for embedded Bodymovin (.json)
// animations. fs-free and pure (deterministic) so it runs node-side (resolveMotionGraphic) AND in the
// Remotion bundle (MotionGraphic.tsx). See docs/superpowers/specs/2026-06-19-lottie-tier3-design.md.

export type LottieData = Record<string, unknown>;

export const LOTTIE_MAX_BYTES = 3 * 1024 * 1024; // 3 MB; the JSON ships inline in Remotion inputProps

// Parse a Lottie JSON string and validate it is a Bodymovin doc with a determinable duration.
// Throws friendly errors (caught by resolveMotionGraphic and surfaced to the agent).
export function parseLottie(raw: string): { data: LottieData } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("not valid JSON");
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("not a Lottie animation (expected a JSON object)");
  }
  const d = data as Record<string, unknown>;
  const ok =
    typeof d.v === "string" &&
    typeof d.w === "number" &&
    typeof d.h === "number" &&
    typeof d.fr === "number" &&
    typeof d.ip === "number" &&
    typeof d.op === "number" &&
    Array.isArray(d.layers);
  if (!ok) {
    throw new Error("not a Lottie animation (expected Bodymovin JSON with v/w/h/fr/ip/op/layers)");
  }
  if (!((d.op as number) > (d.ip as number)) || !((d.fr as number) > 0)) {
    throw new Error("Lottie has no determinable duration (op must exceed ip, fr must be > 0)");
  }
  return { data: d };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/lottie.test.ts -t "parseLottie"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/lottie.ts tests/lottie.test.ts
git commit -m "feat(motion): parseLottie — Bodymovin JSON + duration validation"
```

---

### Task 4: `lintLottie` — determinism + safety denylist

**Files:**
- Modify: `src/render/lottie.ts` (add `lintLottie`)
- Test: `tests/lottie.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/lottie.test.ts`:

```ts
import { lintLottie } from "../src/render/lottie.js";

const base = () => ({ v: "5.7.4", fr: 30, ip: 0, op: 60, w: 1080, h: 1920, layers: [] as any[] });

describe("lintLottie", () => {
  it("passes a clean expression-free animation", () => {
    expect(lintLottie(base())).toEqual([]);
  });

  it("allows split-dimension positions (x as an OBJECT, not an expression)", () => {
    const d: any = base();
    d.layers = [{ ty: 4, ks: { p: { s: true, x: { a: 0, k: 540, ix: 3 }, y: { a: 0, k: 960, ix: 4 } } } }];
    expect(lintLottie(d)).toEqual([]);
  });

  it("rejects an AE expression (x is a STRING) anywhere, incl. nested precomp + effect value", () => {
    const expr: any = base();
    expr.layers = [{ ty: 4, ks: { o: { a: 0, k: 100, x: "$bm_rt = time*100;" } } }];
    expect(lintLottie(expr).some((m) => /expression/i.test(m))).toBe(true);

    const nested: any = base();
    nested.assets = [{ id: "comp_0", layers: [{ ty: 4, ks: { o: { a: 0, k: 50, x: "$bm_rt=1" } } }] }];
    expect(lintLottie(nested).some((m) => /expression/i.test(m))).toBe(true);

    const effect: any = base();
    effect.layers = [{ ty: 4, ef: [{ ef: [{ v: { a: 0, k: 1, x: "$bm_rt=0" } }] }] }];
    expect(lintLottie(effect).some((m) => /expression/i.test(m))).toBe(true);
  });

  it("rejects external/system fonts but allows an embedded (data:) font", () => {
    const sys: any = base();
    sys.fonts = { list: [{ fName: "Arial", fFamily: "Arial", fStyle: "Regular", origin: 0 }] };
    expect(lintLottie(sys).some((m) => /font/i.test(m))).toBe(true);

    const embedded: any = base();
    embedded.fonts = { list: [{ fName: "Inter", fPath: "data:font/ttf;base64,AA==" }] };
    expect(lintLottie(embedded).some((m) => /font/i.test(m))).toBe(false);
  });

  it("rejects external image assets and allows an embedded base64 image", () => {
    const ext: any = base();
    ext.assets = [{ id: "img_0", w: 10, h: 10, e: 0, u: "images/", p: "cat.png" }];
    expect(lintLottie(ext).some((m) => /external asset/i.test(m))).toBe(true);

    const emb: any = base();
    emb.assets = [{ id: "img_0", w: 10, h: 10, e: 1, u: "", p: "data:image/png;base64,AA==" }];
    expect(lintLottie(emb).some((m) => /external asset/i.test(m))).toBe(false);
  });

  it("rejects an embedded SVG image payload", () => {
    const svg: any = base();
    svg.assets = [{ id: "img_0", w: 10, h: 10, e: 1, u: "", p: "data:image/svg+xml;base64,AA==" }];
    expect(lintLottie(svg).some((m) => /svg/i.test(m))).toBe(true);
  });

  it("rejects data-driven slots", () => {
    const slots: any = base();
    slots.slots = { someKey: { p: 1 } };
    expect(lintLottie(slots).some((m) => /slot/i.test(m))).toBe(true);

    const sid: any = base();
    sid.layers = [{ ty: 4, ks: { o: { a: 0, k: 100, sid: "opacity_slot" } } }];
    expect(lintLottie(sid).some((m) => /slot/i.test(m))).toBe(true);
  });

  it("rejects an oversized document", () => {
    const big: any = base();
    big.layers = [{ ty: 4, nm: "x".repeat(3 * 1024 * 1024) }];
    expect(lintLottie(big).some((m) => /too large/i.test(m))).toBe(true);
  });

  it("emits each violation at most once", () => {
    const two: any = base();
    two.assets = [
      { id: "a", e: 0, u: "i/", p: "a.png" },
      { id: "b", e: 0, u: "i/", p: "b.png" },
    ];
    expect(lintLottie(two).filter((m) => /external asset/i.test(m))).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lottie.test.ts -t "lintLottie"`
Expected: FAIL — `lintLottie` is not exported yet.

- [ ] **Step 3: Implement `lintLottie` in `src/render/lottie.ts`**

Append to `src/render/lottie.ts`:

```ts
// Full recursive walk: collect determinism/safety flags from every object/array node so we reach
// ks/transforms, effect values, text animators, masks, time-remap, and nested precomp layers.
function scan(node: unknown, flags: { expression: boolean; slotRef: boolean }): void {
  if (Array.isArray(node)) {
    for (const item of node) scan(item, flags);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    // An AE expression stores the JS source as a STRING in `x`. A split-dimension channel or mask
    // feather also uses key `x`, but its value is an object/array — so gate on typeof === "string".
    if (typeof obj.x === "string") flags.expression = true;
    if ("sid" in obj) flags.slotRef = true;
    for (const value of Object.values(obj)) scan(value, flags);
  }
}

// Determinism + safety violations (empty = clean). Same contract as lintMotionHtml/lintMotionJs.
export function lintLottie(data: LottieData): string[] {
  const v: string[] = [];
  const flags = { expression: false, slotRef: false };
  scan(data, flags);

  if (flags.expression) {
    v.push(
      "After Effects expressions aren't allowed — they evaluate JS at render time (non-deterministic + an eval surface). Re-export with expressions baked/removed.",
    );
  }
  if ("slots" in data || flags.slotRef) {
    v.push("Lottie slots (data-driven theming indirection) aren't supported — flatten the values into the animation.");
  }

  // Fonts: anything not embedded as a data: font is a host-dependent fallback risk.
  const fonts = (data as Record<string, unknown>).fonts as { list?: unknown[] } | undefined;
  if (fonts && Array.isArray(fonts.list) && fonts.list.length > 0) {
    const anyExternal = fonts.list.some((f) => {
      const fPath = (f as Record<string, unknown>)?.fPath;
      return !(typeof fPath === "string" && fPath.startsWith("data:"));
    });
    if (anyExternal) {
      v.push(
        "external/system fonts aren't allowed — headless Chromium has no guaranteed fonts, so text would render with a host-dependent fallback (non-deterministic). Outline text to shapes, or embed the font.",
      );
    }
  }

  // Image assets: an image asset has `p` (filename or data URI) and no `layers` (which would make it a precomp).
  const assets = (data as Record<string, unknown>).assets;
  if (Array.isArray(assets)) {
    let pushedExternal = false;
    let pushedSvg = false;
    for (const a of assets) {
      if (!a || typeof a !== "object") continue;
      const entry = a as Record<string, unknown>;
      if ("layers" in entry) continue; // precomp, not an image
      if (!("p" in entry)) continue; // not an image asset
      const p = String(entry.p ?? "");
      const embedded = entry.e === 1 && p.startsWith("data:");
      if (!embedded && !pushedExternal) {
        v.push("external asset refs don't resolve during render — embed images in the export (base64 data: URI), or remove them.");
        pushedExternal = true;
      } else if (embedded && /^data:image\/svg\+xml/i.test(p) && !pushedSvg) {
        v.push("embedded SVG image payloads aren't allowed — they bypass HTML sanitization and can carry script. Rasterize to PNG/JPEG, or remove.");
        pushedSvg = true;
      }
    }
  }

  if (Buffer.byteLength(JSON.stringify(data), "utf8") > LOTTIE_MAX_BYTES) {
    const mb = (Buffer.byteLength(JSON.stringify(data), "utf8") / (1024 * 1024)).toFixed(1);
    v.push(`Lottie is too large (${mb} MB > 3 MB) — it ships inline in the render inputProps. Simplify or split the animation.`);
  }

  return v;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/lottie.test.ts -t "lintLottie"`
Expected: PASS (all `lintLottie` cases).

> Note: `Buffer` is a Node global available in this fs-free module (used at resolve time). It is also available in the Remotion bundle context, but `lintLottie` only runs node-side; the render path never calls it.

- [ ] **Step 5: Commit**

```bash
git add src/render/lottie.ts tests/lottie.test.ts
git commit -m "feat(motion): lintLottie — expressions/fonts/assets/svg/slots/size denylist"
```

---

### Task 5: `warnLottie` (opaque background) + `lottiePlaybackRate` (stretch math)

**Files:**
- Modify: `src/render/lottie.ts`
- Test: `tests/lottie.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/lottie.test.ts`:

```ts
import { warnLottie, lottiePlaybackRate } from "../src/render/lottie.js";

describe("warnLottie", () => {
  it("warns about a full-frame opaque solid (overlay occlusion)", () => {
    const d: any = { v: "5", fr: 30, ip: 0, op: 60, w: 1080, h: 1920,
      layers: [{ ty: 1, sc: "#000000", sw: 1080, sh: 1920, ks: { o: { a: 0, k: 100 } } }] };
    expect(warnLottie(d).some((m) => /opaque background/i.test(m))).toBe(true);
  });
  it("does not warn when there is no full-frame opaque solid", () => {
    const d: any = { v: "5", fr: 30, ip: 0, op: 60, w: 1080, h: 1920,
      layers: [{ ty: 4, shapes: [] }] };
    expect(warnLottie(d)).toEqual([]);
  });
});

describe("lottiePlaybackRate", () => {
  // Direction: docs say "higher = faster"; to play once across a LONGER beat, slow down (rate < 1).
  it("stretches a 2s asset across a 3s beat (90 frames @30fps) → 2/3", () => {
    expect(lottiePlaybackRate(2, 90, 30, false)).toBeCloseTo(2 / 3, 5);
  });
  it("normalizes fps via seconds, not raw frames (2s asset, 2s beat → 1)", () => {
    expect(lottiePlaybackRate(2, 60, 30, false)).toBeCloseTo(1, 5);
  });
  it("speeds up when the beat is shorter than the asset (2s asset, 1s beat → 2)", () => {
    expect(lottiePlaybackRate(2, 30, 30, false)).toBeCloseTo(2, 5);
  });
  it("returns 1 when looping", () => {
    expect(lottiePlaybackRate(2, 90, 30, true)).toBe(1);
  });
  it("returns 1 for degenerate inputs (no stretch possible)", () => {
    expect(lottiePlaybackRate(2, 0, 30, false)).toBe(1);
    expect(lottiePlaybackRate(0, 90, 30, false)).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lottie.test.ts -t "warnLottie"` and `npx vitest run tests/lottie.test.ts -t "lottiePlaybackRate"`
Expected: FAIL — neither function is exported yet.

- [ ] **Step 3: Implement both in `src/render/lottie.ts`**

Append:

```ts
// Non-fatal warnings (logged, not thrown). A full-frame opaque solid is fine for a kind:"motion" beat
// but occludes the avatar/app when the same graphic is used as a motionOverlay.
export function warnLottie(data: LottieData): string[] {
  const w: string[] = [];
  const W = Number((data as Record<string, unknown>).w);
  const H = Number((data as Record<string, unknown>).h);
  const layers = (data as Record<string, unknown>).layers;
  if (Array.isArray(layers)) {
    const opaqueFullFrameSolid = layers.some((l) => {
      if (!l || typeof l !== "object") return false;
      const layer = l as Record<string, any>;
      if (layer.ty !== 1) return false; // solid layer
      const full = Number(layer.sw) >= W && Number(layer.sh) >= H;
      const o = layer.ks?.o;
      // Static full opacity: { a:0, k:100 } (or k:[100]); animated opacity → don't warn (best-effort).
      const opaque = o && o.a === 0 && (o.k === 100 || (Array.isArray(o.k) && o.k[0] === 100));
      return full && opaque;
    });
    if (opaqueFullFrameSolid) {
      w.push(
        'opaque background detected — fine for kind:"motion", but as a motionOverlay this will hide the underlying video. Use a transparent-background export.',
      );
    }
  }
  return w;
}

// playbackRate to stretch a Lottie's full duration across the beat exactly once.
// Docs (remotion.dev/docs/lottie/lottie): playbackRate is "the speed of the animation; a higher number
// is faster". So rate = naturalSeconds / beatSeconds (slow down for a longer beat). Computed in SECONDS
// so a non-composition-fps asset isn't mis-scaled. Returns 1 when looping or when inputs are degenerate.
export function lottiePlaybackRate(
  durationInSeconds: number,
  beatFrames: number,
  fps: number,
  loop: boolean,
): number {
  if (loop) return 1;
  const beatSeconds = beatFrames / fps;
  if (!(durationInSeconds > 0) || !(beatSeconds > 0)) return 1;
  return durationInSeconds / beatSeconds;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/lottie.test.ts`
Expected: PASS (all `tests/lottie.test.ts` describe blocks so far).

- [ ] **Step 5: Commit**

```bash
git add src/render/lottie.ts tests/lottie.test.ts
git commit -m "feat(motion): warnLottie (opaque bg) + lottiePlaybackRate (fps-normalized stretch)"
```

---

### Task 6: `resolveMotionGraphic` — required extension allowlist + `.json` dispatch + `loop`

**Files:**
- Modify: `src/render/motiongraphic.ts` (the `MotionGraphicRefInput` interface ~line 60, and `resolveMotionGraphic` ~line 69)
- Test: `tests/lottie.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/lottie.test.ts`:

```ts
import { resolveMotionGraphic } from "../src/render/motiongraphic.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function projWith(file: string, contents: string) {
  const root = mkdtempSync(join(tmpdir(), "kino-lot-"));
  const abs = join(root, file);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, contents);
  return { assetPath: (rel: string) => join(root, rel) };
}

describe("resolveMotionGraphic — Lottie (.json) dispatch", () => {
  const okLottie = JSON.stringify({ v: "5.7.4", fr: 30, ip: 0, op: 60, w: 1080, h: 1920, layers: [] });

  it("routes a .json source to a lottie prop with empty html and forwards loop", () => {
    const project = projWith("motion/anim.json", okLottie);
    const props = resolveMotionGraphic({ source: "motion/anim.json", loop: true }, project);
    expect(props.html).toBe("");
    expect(props.proc).toBeUndefined();
    expect(props.lottie).toMatchObject({ w: 1080 });
    expect(props.loop).toBe(true);
  });

  it("dispatches case-insensitively (.JSON)", () => {
    const project = projWith("motion/anim.JSON", okLottie);
    const props = resolveMotionGraphic({ source: "motion/anim.JSON" }, project);
    expect(props.lottie).toBeDefined();
  });

  it("throws listing the lint violation for a Lottie with an expression", () => {
    const bad = JSON.stringify({ v: "5", fr: 30, ip: 0, op: 60, w: 10, h: 10,
      layers: [{ ty: 4, ks: { o: { a: 0, k: 1, x: "$bm_rt=1" } } }] });
    const project = projWith("motion/bad.json", bad);
    expect(() => resolveMotionGraphic({ source: "motion/bad.json" }, project)).toThrow(/expression/i);
  });

  it("throws a friendly parse error for non-Lottie JSON", () => {
    const project = projWith("motion/x.json", JSON.stringify({ hello: "world" }));
    expect(() => resolveMotionGraphic({ source: "motion/x.json" }, project)).toThrow(/not a Lottie animation/i);
  });

  it("rejects an unknown extension instead of silently treating it as HTML", () => {
    const project = projWith("motion/x.png", "not markup");
    expect(() => resolveMotionGraphic({ source: "motion/x.png" }, project)).toThrow(/must be \.html, \.js, or \.json/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lottie.test.ts -t "Lottie \(.json\) dispatch"`
Expected: FAIL — `.json` currently falls into the Tier-1 HTML branch (lint/sanitize), so `props.lottie` is undefined and `.png` does not throw the allowlist error.

- [ ] **Step 3: Update `MotionGraphicRefInput` and `resolveMotionGraphic`**

In `src/render/motiongraphic.ts`:

(a) Add the import at the top (near the existing `sanitizeMotionHtml` import):

```ts
import { parseLottie, lintLottie, warnLottie } from "./lottie.js";
```

(b) Add `loop` to `MotionGraphicRefInput` (lines 60-65):

```ts
export interface MotionGraphicRefInput {
  source: string;
  params?: Record<string, BgParamValue>;
  keyframes?: BgKeyframe[];
  triggers?: BgTrigger[];
  loop?: boolean;
}
```

(c) Replace the body of `resolveMotionGraphic` (lines 69-87) with the lowercased allowlist + `.json` branch. The new function:

```ts
export function resolveMotionGraphic(
  ref: MotionGraphicRefInput,
  project: { assetPath(rel: string): string },
): MotionGraphicProps {
  const abs = project.assetPath(ref.source);
  if (!existsSync(abs)) throw new Error(`Missing motion graphic file: assets/${ref.source}`);
  const raw = readFileSync(abs, "utf8");
  const base = {
    params: ref.params ?? {},
    keyframes: ref.keyframes ?? [],
    triggers: ref.triggers ?? [],
    loop: ref.loop,
  };
  const ext = ref.source.toLowerCase();
  if (ext.endsWith(".js")) {
    // Tier 2: procedural source. Lint for determinism/safety; bake the JS verbatim (not sanitized —
    // it's code, not markup; its per-frame output is trusted like the custom-background draw fn).
    const violations = lintMotionJs(raw);
    if (violations.length) throw new Error(`Motion graphic assets/${ref.source}: ${violations.join("; ")}`);
    return { html: "", proc: raw, ...base };
  }
  if (ext.endsWith(".json")) {
    // Tier 3: Lottie. Parse + validate + lint (throw), then warn (non-fatal).
    const { data } = parseLottie(raw); // throws friendly parse/shape/duration errors
    const violations = lintLottie(data);
    if (violations.length) throw new Error(`Motion graphic assets/${ref.source}: ${violations.join("; ")}`);
    for (const w of warnLottie(data)) console.warn(`Motion graphic assets/${ref.source}: ${w}`);
    return { html: "", lottie: data, ...base };
  }
  if (ext.endsWith(".html")) {
    const violations = lintMotionHtml(raw);
    if (violations.length) throw new Error(`Motion graphic assets/${ref.source}: ${violations.join("; ")}`);
    return { html: sanitizeMotionHtml(raw), ...base };
  }
  throw new Error(`Motion graphic assets/${ref.source}: motion source must be .html, .js, or .json`);
}
```

> Note: this also fixes the pre-existing case-sensitive `.js` match (now `.JS` works) and closes the silent "unknown extension → treated as HTML" fallback. `base` now always carries `loop` (inert for html/proc).

- [ ] **Step 4: Run the new tests + the existing motiongraphic suite (no regressions)**

Run: `npx vitest run tests/lottie.test.ts tests/motiongraphic.test.ts`
Expected: PASS — new Lottie dispatch tests pass; all existing `resolveMotionGraphic`/`assertMotionGraphics` tests still pass (the `.html` and `.js` behavior is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/render/motiongraphic.ts tests/lottie.test.ts
git commit -m "feat(motion): resolve .json as Tier-3 Lottie (allowlist + lint + loop)"
```

---

### Task 7: Forward `loop` from the `kind:"motion"` build call site

**Files:**
- Modify: `src/commands/build.ts:256` (the `motion:` resolve call)

- [ ] **Step 1: Inspect the call site**

Run: `sed -n '252,258p' src/commands/build.ts` (or open it). You will see the `kind:"motion"` branch building the ref by hand:

```ts
motion: resolveMotionGraphic({ source: seg.source, params: seg.params, keyframes: seg.keyframes, triggers: seg.triggers }, project),
```

The two `motionOverlay` call sites (lines 243, 250) pass `seg.motionOverlay` whole, so `loop` already flows there — only this hand-built ref needs it.

- [ ] **Step 2: Add `loop: seg.loop`**

Edit line 256 so the ref includes `loop`:

```ts
motion: resolveMotionGraphic({ source: seg.source, params: seg.params, keyframes: seg.keyframes, triggers: seg.triggers, loop: seg.loop }, project),
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: `tsc` succeeds. (`seg` is the `kind:"motion"` segment, which now has the optional `loop` from Task 2's schema change; `MotionGraphicRefInput` accepts `loop` from Task 6.)

- [ ] **Step 4: Commit**

```bash
git add src/commands/build.ts
git commit -m "feat(motion): forward loop to the kind:motion Lottie resolve"
```

---

### Task 8: Render `<Lottie>` in `MotionGraphic.tsx` + demo asset + render test

**Files:**
- Modify: `src/render/remotion/MotionGraphic.tsx`
- Create: `examples/motion-lottie/fade.json` (demo + render-test fixture)
- Test: `tests/render-lottie.test.ts` (Create)

- [ ] **Step 1: Create the demo Lottie fixture**

Create `examples/motion-lottie/fade.json` — a full-frame rectangle whose fill animates **black → green** across the timeline (native **60 fps**, 2 s, so the test exercises fps-normalization against the 30 fps composition). The center pixel's green channel reads playback progress, like the existing scrub/proc render tests.

```json
{
  "v": "5.7.4", "fr": 60, "ip": 0, "op": 120, "w": 1080, "h": 1920, "nm": "fade", "ddd": 0,
  "assets": [],
  "layers": [
    {
      "ddd": 0, "ind": 1, "ty": 4, "nm": "bg", "sr": 1,
      "ks": {
        "o": { "a": 0, "k": 100 },
        "r": { "a": 0, "k": 0 },
        "p": { "a": 0, "k": [540, 960, 0] },
        "a": { "a": 0, "k": [0, 0, 0] },
        "s": { "a": 0, "k": [100, 100, 100] }
      },
      "ao": 0,
      "shapes": [
        {
          "ty": "gr",
          "it": [
            { "ty": "rc", "d": 1, "s": { "a": 0, "k": [1080, 1920] }, "p": { "a": 0, "k": [0, 0] }, "r": { "a": 0, "k": 0 } },
            { "ty": "fl", "o": { "a": 0, "k": 100 }, "r": 1,
              "c": { "a": 1, "k": [
                { "t": 0, "s": [0, 0, 0, 1], "e": [0, 1, 0, 1], "i": { "x": [0.5], "y": [0.5] }, "o": { "x": [0.5], "y": [0.5] } },
                { "t": 120, "s": [0, 1, 0, 1] }
              ] } },
            { "ty": "tr", "p": { "a": 0, "k": [540, 960] }, "a": { "a": 0, "k": [0, 0] }, "s": { "a": 0, "k": [100, 100] }, "r": { "a": 0, "k": 0 }, "o": { "a": 0, "k": 100 } }
          ]
        }
      ],
      "ip": 0, "op": 120, "st": 0, "bm": 0
    }
  ]
}
```

> The color keyframe's easing `i`/`o` keys here are objects/arrays (Bezier handles), **not** strings — so `lintLottie` does not flag them as expressions. Verify this in Step 4.

- [ ] **Step 2: Write the failing render test**

Create `tests/render-lottie.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { execSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9 };
const bg = { kind: "glow" as const, image: null, customCode: null, params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 }, keyframes: [], triggers: [] };
const sampleCenter = (png: string) => execSync(`magick "${png}" -format "%[pixel:p{540,960}]" info:`).toString().trim();
const greenOf = (s: string) => {
  const m = s.match(/srgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) throw new Error(`Unexpected pixel format: ${s}`);
  return Number(m[2]);
};
const fade = JSON.parse(readFileSync(join(__dirname, "../examples/motion-lottie/fade.json"), "utf8"));

// Beat: 0..3s = 90 frames @30fps. Asset is 2s @60fps. lottiePlaybackRate = 2/3, so the fade plays once
// stretched across the whole beat → center green is ~linear in beat progress.
const mkProps = (loop = false): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "test",
  segments: [{ kind: "motion", caption: "", startSec: 0, endSec: 3,
    motion: { html: "", lottie: fade, loop, params: {}, keyframes: [], triggers: [] } }],
});

describe("Tier-3 Lottie render", () => {
  it("stretches the fade across the beat: mid-beat ~50%, deterministic, not frozen at the end", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-lottie-"));
    // 90-frame beat: frame 9 ≈10%, frame 45 ≈50% (mid), frame 81 ≈90%.
    const outs = await renderStills({
      props: mkProps(false), publicDir: mkdtempSync(join(tmpdir(), "lottie-pub-")), format: "9:16",
      frames: [{ frame: 9, name: "early" }, { frame: 45, name: "mid" }, { frame: 45, name: "mid2" }, { frame: 81, name: "late" }],
      outDir,
    });
    const early = greenOf(sampleCenter(outs[0]));
    const mid = greenOf(sampleCenter(outs[1]));
    const mid2 = greenOf(sampleCenter(outs[2]));
    const late = greenOf(sampleCenter(outs[3]));

    expect(sampleCenter(outs[1])).toBe(sampleCenter(outs[2])); // determinism: same frame twice → identical
    expect(early).toBeLessThan(90);     // ~10% into the black→green fade
    expect(mid).toBeGreaterThan(90);    // mid-beat is genuinely mid-fade…
    expect(mid).toBeLessThan(190);      // …NOT frozen at the end (catches an inverted/too-fast rate)
    expect(late).toBeGreaterThan(190);  // ~90% into the fade
    expect(early).toBeLessThan(mid);
    expect(mid).toBeLessThan(late);
  }, 180000);

  it("renders a looping Lottie without crashing", async () => {
    const outs = await renderStills({
      props: mkProps(true), publicDir: mkdtempSync(join(tmpdir(), "lottie-loop-")), format: "9:16",
      frames: [{ frame: 20, name: "loop" }], outDir: mkdtempSync(join(tmpdir(), "kino-lottie-loop-")),
    });
    expect(existsSync(outs[0])).toBe(true);
  }, 180000);

  it("renders a Lottie motionOverlay on an avatar beat", async () => {
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "test",
      segments: [{ kind: "avatar", caption: "hook", startSec: 0, endSec: 2,
        motionOverlay: { html: "", lottie: fade, loop: false, params: {}, keyframes: [], triggers: [] } }],
    };
    const outs = await renderStills({ props, publicDir: mkdtempSync(join(tmpdir(), "lottie-ov-")), format: "9:16", frames: [{ frame: 20, name: "ov" }], outDir: mkdtempSync(join(tmpdir(), "kino-lottie-ov-")) });
    expect(existsSync(outs[0])).toBe(true);
  }, 180000);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/render-lottie.test.ts`
Expected: FAIL — `MotionGraphic.tsx` ignores `data.lottie` today, so it renders nothing (center pixel is the glow background, not a black→green fade), and the green-channel assertions fail.

- [ ] **Step 4: Implement the `<Lottie>` render path**

In `src/render/remotion/MotionGraphic.tsx`:

(a) Add imports at the top:

```tsx
import { Lottie, getLottieMetadata } from "@remotion/lottie";
import { lottiePlaybackRate } from "../lottie";
```

> Import specifier note: inside the Remotion bundle, sibling modules are imported **without** the `.js` suffix (match the existing `import { buildMotionVars } from "../motionVars"` style at the top of this file). Use `"../lottie"`, not `"../lottie.js"`.

(b) Add the Lottie branch **after all existing hooks have run** — i.e. after `useVideoConfig()` (line 59) and after the `procFn` `useMemo` (lines 69-79), but before/instead of building HTML. Also short-circuit `procFn` so an empty `Function` isn't compiled for a Lottie graphic. Concretely:

- Change the `procFn` `useMemo` guard from `data.proc ? ... : null` to `data.proc && !data.lottie ? ... : null`.
- Immediately before the existing `return (<AbsoluteFill><ShadowHtml .../></AbsoluteFill>)`, insert:

```tsx
  if (data.lottie) {
    const loop = data.loop ?? false;
    const meta = getLottieMetadata(data.lottie);
    if (!meta && frame === 0) console.warn("Lottie metadata unavailable — playing at native speed");
    const playbackRate = meta ? lottiePlaybackRate(meta.durationInSeconds, durationFrames, fps, loop) : 1;
    return (
      <AbsoluteFill>
        <Lottie
          animationData={data.lottie}
          loop={loop}
          playbackRate={playbackRate}
          preserveAspectRatio="xMidYMid meet"
          style={{ width: "100%", height: "100%" }}
        />
      </AbsoluteFill>
    );
  }
```

(`frame`, `fps`, and `durationFrames` are already in scope: `frame` from `useCurrentFrame()`, `fps` from `useVideoConfig()` at line 59, `durationFrames` from props.)

- [ ] **Step 5: Verify the fixture lints clean (catch a malformed demo asset early)**

Run: `node --input-type=module -e "import {parseLottie,lintLottie} from './dist/render/lottie.js'; import {readFileSync} from 'node:fs'; const {data}=parseLottie(readFileSync('examples/motion-lottie/fade.json','utf8')); console.log('violations:', lintLottie(data));"`
(Run `npm run build` first so `dist/` exists.)
Expected: `violations: []`. If it lists an "expression" violation, the fixture's easing handles are malformed (a string where an object/array belongs) — fix the JSON.

- [ ] **Step 6: Run the render test to verify it passes**

Run: `npx vitest run tests/render-lottie.test.ts`
Expected: PASS (3 tests).
If the `mid`/`early`/`late` green thresholds are slightly off (lottie-web color interpolation isn't perfectly linear), first confirm the **shape** is right by logging the three values; they must be strictly increasing with `mid` clearly between the extremes. Nudge the numeric bounds only if the ordering/mid-band intent still holds (mirrors how the existing scrub test tuned `<80`/`>200`).

- [ ] **Step 7: Run the full render-motion suite (no regressions)**

Run: `npx vitest run tests/render-motion.test.ts`
Expected: PASS — the HTML/proc render paths are unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/render/remotion/MotionGraphic.tsx examples/motion-lottie/fade.json tests/render-lottie.test.ts
git commit -m "feat(motion): render embedded Lottie (Tier 3) deterministically in Remotion"
```

---

### Task 9: Docs, SKILL, and `kino motion` help text

**Files:**
- Modify: `src/commands/motion.ts` (the `motionHelpText()` lines array)
- Modify: `docs/motion-graphics.md`, `docs/spec-reference.md`
- Modify: `skills/video-production/SKILL.md` (+ `skills/video-production/reference.md` if it enumerates motion tiers)
- Test: `tests/motiongraphic.test.ts` (extend the existing `kino motion help` test)

- [ ] **Step 1: Write the failing help-text test**

In `tests/motiongraphic.test.ts`, inside the existing `describe("kino motion help", ...)` block (after line 226), add assertions:

```ts
  it("documents the Tier-3 Lottie option and its rules", () => {
    const t = motionHelpText();
    expect(t).toMatch(/lottie/i);
    expect(t).toMatch(/\.json/);
    expect(t).toMatch(/loop/);
    expect(t).toMatch(/transparent/i); // overlay-background rule
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/motiongraphic.test.ts -t "kino motion help"`
Expected: FAIL — `motionHelpText()` says nothing about Lottie yet.

- [ ] **Step 3: Add the Tier-3 section to `motionHelpText()`**

In `src/commands/motion.ts`, append lines to the returned array (after the procedural `.js` section, before the function returns/joins). Use the existing style (plain strings joined by newlines):

```ts
    "",
    "Lottie graphics (.json, Tier 3) — embed a designer-made Bodymovin/LottieFiles animation by",
    'pointing source at a .json file: { "kind": "motion", "source": "motion/confetti.json", "text": "..." }.',
    "It plays once stretched across the beat; add \"loop\": true (sibling of source) to loop at native speed.",
    "Rules: assets must embed images (base64 data: URIs) and outline/embed fonts (no system fonts);",
    "After Effects expressions are rejected. For a motionOverlay, use a TRANSPARENT-background export —",
    "an opaque background hides the avatar/app underneath. Keep focal content clear of the lower-third caption.",
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/motiongraphic.test.ts -t "kino motion help"`
Expected: PASS.

- [ ] **Step 5: Document Tier 3 in the user docs**

In `docs/motion-graphics.md`, add a "Tier 3: Embedded Lottie (`.json`)" section covering: how to reference a `.json` (same `source` field, all three slots), the `loop` field, play-once-stretched default, and the authoring rules (embedded images, embedded/outlined fonts, no expressions, transparent background for overlays, caption-safe focal area, 3 MB cap, `.lottie`/recoloring are future work). Keep the prose consistent with the existing Tier-1/Tier-2 sections.

In `docs/spec-reference.md`, find where `motionOverlay` / `kind:"motion"` fields are listed and add the `loop?: boolean` field with a one-line description ("Tier-3 Lottie: loop at native speed instead of stretching once across the beat").

- [ ] **Step 6: Note Tier 3 in the SKILL**

In `skills/video-production/SKILL.md` (and `reference.md` if it enumerates the motion tiers), add a brief Tier-3 Lottie bullet so the agent knows the option exists and its key rule (transparent background for overlays; designer-authored, not agent-authored). Match the surrounding format.

- [ ] **Step 7: Build + full test sweep**

Run: `npm run build && npx vitest run`
Expected: `tsc` clean; entire suite green (existing + `tests/lottie.test.ts` + `tests/render-lottie.test.ts` + the new help assertions).

- [ ] **Step 8: Commit**

```bash
git add src/commands/motion.ts docs/motion-graphics.md docs/spec-reference.md skills/video-production/SKILL.md skills/video-production/reference.md tests/motiongraphic.test.ts
git commit -m "docs(motion): document Tier-3 Lottie (help text, docs, SKILL)"
```

---

## Self-Review

**Spec coverage** (each spec section → task):
- §3/§3.1 architecture + module split → Tasks 3-6 (lottie.ts), 8 (MotionGraphic).
- §4 required lowercased extension allowlist + `.json` dispatch + `loop` return → Task 6.
- §5 lint (expressions string-typed `x`, fonts, images, embedded-SVG, slots, size) + full recursive walk → Task 4.
- §5.1 opaque-background warning → Task 5 (`warnLottie`), surfaced in Task 6.
- §6 props (`lottie`, `loop`, `LottieData`) → Task 2.
- §7 render path, hook ordering, `procFn` short-circuit, sizing, null-metadata fallback → Task 8.
- §7.1 pinned fps-normalized stretch formula → Task 5 (`lottiePlaybackRate`) + Task 8 (wired) + Task 8 render test (mid-beat).
- §7.2 `getLottieMetadata` null contract → Task 8 Step 4 (`meta ? ... : 1` + warn).
- §8 dependency (caret range) → Task 1.
- §9 schema `loop` field + authoring rules → Task 2 (schema) + Task 9 (docs).
- §10 tests → Tasks 3-6 (unit), 8 (render incl. mid-beat + non-30fps asset + determinism + overlay + loop).
- §13 files-touched → covered (incl. the one-line `build.ts` change in Task 7; `KinoVideo.tsx` correctly untouched).

**Placeholder scan:** No "TBD"/"handle edge cases"/"write tests for the above" — every code/test step shows full content. The two empirical knobs (render-test green thresholds; demo-asset fade correctness) have explicit verification steps (Task 8 Steps 5-6), not hand-waves.

**Type consistency:** `LottieData` defined once (Task 2 in props.ts; re-declared/exported from lottie.ts in Task 3 — both are `Record<string, unknown>`; if the executing agent prefers a single source, import it from `props` into `lottie.ts`, but the duplicate alias is harmless and keeps `lottie.ts` fs-free/standalone). Function names are stable across tasks: `parseLottie`, `lintLottie`, `warnLottie`, `lottiePlaybackRate`, `resolveMotionGraphic`. `MotionGraphicProps.lottie`/`loop` and `MotionGraphicRefInput.loop` names match their uses in Tasks 6-8. Beat/asset numbers in the render test (2 s @60 fps asset, 3 s/90-frame beat, rate 2/3) are internally consistent with the `lottiePlaybackRate` unit tests in Task 5.
