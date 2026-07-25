# Cutout Compositing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a region-shader beat composite its segmented subject over a *different* clip —
`regionShader.backdrop` — with the backdrop genuinely animating under headless capture.

**Architecture:** The backdrop binds to the already-declared-but-unused `uTex1`/`uTexSize1` in the
region header (no new uniform, so no GLSL change for specs that don't use it), is routed through the
per-beat `/vframes` node-side frame pipeline exactly as region-shader video masks are (`rsbd${i}`
job in `planMediaJobs`), and becomes the background region's passthrough (cover-fit) when no
`background` body is given.

**Tech Stack:** TypeScript, zod, React (render page), WebGL2 / GLSL ES 3.00, ffmpeg, vitest,
ImageMagick (`tests/magick.ts`).

Design spec: `docs/superpowers/specs/2026-07-25-cutout-compositing-design.md`.

## Global Constraints

- A spec **without** a backdrop must emit **byte-identical** GLSL and behave exactly as today —
  asserted with `toBe` on assembled source.
- Determinism: motion only from `iTime`, keyframed params, `uPulse`. No wall clock, no unseeded
  randomness.
- Region-shader time comes from the composition fps via `useVideoConfig` — never a hardcoded 30.
- kino runs from compiled `dist/` — `npm run build` after editing source.
- Beat kinds are `scene` / `video` (with `source:`), never `app` / `avatar`.
- `npx vitest run` and `npm run build` green before finishing.
- Every commit uses `git commit -s` (DCO enforced in CI).
- `src/render/native/page/RegionShader.tsx` and `ShaderBackground.tsx` contain a non-UTF8 byte —
  plain `grep -n` reports nothing on them. Use `grep -an` or read them in Python.

---

### Task 1: GLSL — conditional backdrop binding

**Files:**
- Modify: `src/render/shaderSource.ts` (`REGION_PASSTHROUGH` area ~line 192, `assembleRegionShaderSource` ~line 208)
- Test: `tests/segment-regionshader-src.test.ts`

**Interfaces:**
- Produces: `assembleRegionShaderSource(subjectBody, backgroundBody, extraNames?, maskBodies?, hasBackdrop?: boolean)` — fifth arg defaults `false`.

- [ ] **Step 1: Write the failing tests** — append to `tests/segment-regionshader-src.test.ts`:

```ts
describe("backdrop binding", () => {
  it("emits byte-identical GLSL when there is no backdrop", () => {
    expect(assembleRegionShaderSource(SUBJ, BG, [], [], false)).toBe(assembleRegionShaderSource(SUBJ, BG, []));
    expect(assembleRegionShaderSource(SUBJ, null, [], [], false)).toBe(assembleRegionShaderSource(SUBJ, null, []));
    expect(assembleRegionShaderSource(SUBJ, null, ["rim"], [A], false)).toBe(assembleRegionShaderSource(SUBJ, null, ["rim"], [A]));
    // and no trace of the feature leaks into the default program
    expect(assembleRegionShaderSource(SUBJ, null, [])).not.toContain("uBackdrop");
  });

  it("aliases uBackdrop/uBackdropSize onto the free uTex1 slot when there is one", () => {
    const src = assembleRegionShaderSource(SUBJ, BG, [], [], true);
    expect(src).toContain("#define uBackdrop uTex1");
    expect(src).toContain("#define uBackdropSize uTexSize1");
  });

  it("makes a passthrough BACKGROUND the cover-fit backdrop, and leaves the subject on the asset", () => {
    const src = assembleRegionShaderSource(null, null, [], [], true);
    expect(src).toContain("kinoBackdrop(uTex1, uTexSize1, fragCoord)");
    // exactly one body switched: the subject passthrough still reads the beat's own plate
    expect((src.match(/texture\(uTex0, fragCoord \/ iResolution\.xy\)/g) ?? []).length).toBe(1);
  });

  it("leaves an explicit background body alone — it can sample uBackdrop itself", () => {
    const src = assembleRegionShaderSource(SUBJ, BG, [], [], true);
    expect(src).toContain(BG);
    expect(src).not.toContain("kinoBackdrop(uTex1, uTexSize1, fragCoord)");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/segment-regionshader-src.test.ts`
Expected: FAIL — "expected … to contain '#define uBackdrop uTex1'".

- [ ] **Step 3: Implement**

In `src/render/shaderSource.ts`, below `REGION_PASSTHROUGH`, add:

```ts
// Backdrop-side passthrough: the background region shows the OTHER clip, cover-fit. `backdrop` is
// the whole point of the feature — a subject cut onto footage that is not the beat's own plate —
// so with no `background` body this is the sane default. Cover-fit (not the subject side's
// fragCoord/iResolution stretch) because the backdrop is an unrelated clip whose aspect will not
// match the beat's; kinoCoverUV needs uTexSize1, which RegionShader now uploads.
const REGION_BACKDROP_PASSTHROUGH =
  "void mainImage(out vec4 fragColor, in vec2 fragCoord){ fragColor = kinoBackdrop(uTex1, uTexSize1, fragCoord); }";

// Readable names for the backdrop's slot. It rides the ALREADY-DECLARED uTex1/uTexSize1 (region
// shaders bind only uTex0), so no uniform is added and — emitted conditionally, the way
// BG_FORWARD_DECL is — a spec without a backdrop gets byte-identical GLSL.
const BACKDROP_ALIASES = "#define uBackdrop uTex1\n#define uBackdropSize uTexSize1\n";
```

Change the signature and body of `assembleRegionShaderSource`:

```ts
export function assembleRegionShaderSource(
  subjectBody: string | null,
  backgroundBody: string | null,
  extraNames: string[] = [],
  maskBodies: (string | null)[] = [],
  hasBackdrop = false,
): string {
  const aliases = paramAliases(extraNames);
  const subj = subjectBody ?? REGION_PASSTHROUGH;
  const bg = backgroundBody ?? (hasBackdrop ? REGION_BACKDROP_PASSTHROUGH : REGION_PASSTHROUGH);
  const head =
    "#version 300 es\n" +
    "precision highp float;\n\n" +
    REGION_HEADER +
    (aliases ? "\n" + aliases : "") +
    "\n" +
    (hasBackdrop ? BACKDROP_ALIASES : "") +
    GLSL_HELPERS +
    "\nout vec4 kino_fragColor;\n\n";
  ...unchanged...
}
```

Also extend the doc comment above the function with a `hasBackdrop` line.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/segment-regionshader-src.test.ts tests/render/shaderSource.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/shaderSource.ts tests/segment-regionshader-src.test.ts
git commit -s -m "feat(region): bind a backdrop clip to uTex1, cover-fit background passthrough"
```

---

### Task 2: Spec surface — schema, props, build resolution

**Files:**
- Modify: `src/spec/schema.ts:198-243` (the `regionShader` object)
- Modify: `src/render/props.ts:47-62` (`RegionShaderProps`)
- Modify: `src/commands/build.ts:53-95` (`resolveRegionShader`)
- Test: `tests/segment-backdrop-spec.test.ts` (create)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `RegionShaderProps.backdrop?: string` — a **publicDir-relative** staged path (same form
  as `masks[].maskSrc`, e.g. `"pexels/beach.mp4"`); `undefined` when the spec has no backdrop.

- [ ] **Step 1: Write the failing test** — create `tests/segment-backdrop-spec.test.ts`:

```ts
// The spec surface for cutout compositing: `backdrop` parses, and it alone satisfies the
// "needs a shader body" refine — mask + backdrop with no .frag IS the cutout.
import { describe, it, expect } from "vitest";
import { SpecSchema } from "../src/spec/schema.js";

const base = {
  brand: "acme",
  segments: [{ kind: "video", source: "clip.mp4", text: "hi",
               regionShader: { mask: "masks/x", backdrop: "pexels/beach.mp4" } }],
};

describe("regionShader.backdrop", () => {
  it("parses with no shader body at all", () => {
    const r = SpecSchema.safeParse(base);
    expect(r.success).toBe(true);
    expect(r.success && r.data.segments[0].regionShader?.backdrop).toBe("pexels/beach.mp4");
  });

  it("still rejects a regionShader with neither a body nor a backdrop", () => {
    const bad = { ...base, segments: [{ ...base.segments[0], regionShader: { mask: "masks/x" } }] };
    expect(SpecSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown key (the object stays strict)", () => {
    const bad = { ...base, segments: [{ ...base.segments[0], regionShader: { mask: "masks/x", backdropp: "x.mp4" } }] };
    expect(SpecSchema.safeParse(bad).success).toBe(false);
  });
});
```

Check the real export name and the minimal valid spec shape first:
`grep -n "export const SpecSchema\|export const Spec" src/spec/schema.ts` and copy the segment
shape from an existing spec test (`tests/spec*.test.ts` or `tests/plan.test.ts`). Adjust `base` to
whatever the schema actually requires — the three assertions are the point, not the fixture.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/segment-backdrop-spec.test.ts`
Expected: FAIL — unrecognized key `backdrop` (the object is `.strict()`).

- [ ] **Step 3: Implement**

`src/spec/schema.ts`, inside the `regionShader` object, after `background`:

```ts
        // A SECOND source for the background region: the subject stays the beat's own asset, the
        // background shows this clip instead. Virtual greenscreen. Project-relative, image or
        // video; video is routed through the per-beat /vframes pipeline (a <video> seek never
        // advances under headless capture — see docs/segmentation-tracking-todo.md).
        backdrop: z.string().min(1).optional(),
```

and relax the body refine so `mask` + `backdrop` is a complete spec:

```ts
      .refine((v) => v.subject || v.background || v.backdrop || v.masks?.some((m) => m.subject), {
        message: "regionShader needs at least one of subject/background/backdrop (top-level or per-mask)",
      })
```

`src/render/props.ts`, in `RegionShaderProps` after `backgroundCode`:

```ts
  // publicDir-relative second source for the BACKGROUND region (image or video). Bound to uTex1 /
  // uTexSize1 and, when backgroundCode is null, cover-fit as the background passthrough — the
  // cutout. Video backdrops animate via the per-beat /vframes job `rsbd<i>`.
  backdrop?: string;
```

`src/commands/build.ts`, in `resolveRegionShader`: add `backdrop?: string` to the parameter type,
and before the return:

```ts
  // Staged like the mask/asset: the page fetches it from publicDir by this relative path.
  if (rs.backdrop) stageAsset(rs.backdrop);
```

then `backdrop: rs.backdrop,` in the returned object.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/segment-backdrop-spec.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/spec/schema.ts src/render/props.ts src/commands/build.ts tests/segment-backdrop-spec.test.ts
git commit -s -m "feat(region): regionShader.backdrop spec surface"
```

---

### Task 3: Route the backdrop through /vframes

**Files:**
- Modify: `src/render/native/videoFrames.ts:65-86` (`planMediaJobs`)
- Test: `tests/segment-backdrop-job.test.ts` (create)

**Interfaces:**
- Consumes: `RegionShaderProps.backdrop` from Task 2.
- Produces: a `MediaJob` with `key === "rsbd<segmentIndex>"`, `startSec: 0`, `stepSec: 1/fps`,
  `effFrame: n => n`. Consumed by `KinoVideo.tsx` in Task 4 as `backdropMediaKey`.

- [ ] **Step 1: Write the failing test** — create `tests/segment-backdrop-job.test.ts`:

```ts
// The backdrop must get its OWN /vframes job, on its OWN clock. The beat's clipFrom/speed/pauseAt
// describe the beat's source and are meaningless on an unrelated clip, so the backdrop plays from
// its own frame 0 at the beat's start, one frame per composition frame (see the design spec's
// Timing section). This pins that rule and that an image backdrop is NOT extracted.
import { describe, it, expect } from "vitest";
import { planMediaJobs } from "../src/render/native/videoFrames.js";
import type { KinoProps } from "../src/render/props.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0 };
const bg = { kind: "custom" as const, image: null, shaderCode: null, customCode: "", params: {}, keyframes: [], triggers: [] };

const propsWith = (backdrop: string): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "",
  segments: [{
    kind: "video", source: "asset.png", caption: "", startSec: 1, endSec: 3,
    clipFrom: 5, speed: 2,
    regionShader: {
      masks: [{ maskSrc: "mask.png", maskKind: "image" as const, channel: "gray" as const }],
      subjectCode: null, backgroundCode: null, backdrop,
    },
  }],
});

describe("backdrop media job", () => {
  it("registers rsbd<i> on its own clock, ignoring the beat's clipFrom/speed", () => {
    const job = planMediaJobs(propsWith("beach.mp4"), 30).find((j) => j.key === "rsbd0");
    expect(job).toBeDefined();
    expect(job!.assetRel).toBe("beach.mp4");
    expect(job!.fromFrame).toBe(30);        // beat starts at 1s
    expect(job!.seqDurFrames).toBe(60);     // 2s beat
    expect(job!.startSec).toBe(0);          // NOT the beat's clipFrom of 5s
    expect(job!.stepSec).toBeCloseTo(1 / 30, 9); // NOT the beat's speed of 2
    expect(job!.effFrame(17)).toBe(17);
    expect(job!.maxEffFrame).toBe(59);
  });

  it("does not extract an image backdrop", () => {
    expect(planMediaJobs(propsWith("beach.png"), 30).find((j) => j.key === "rsbd0")).toBeUndefined();
  });

  it("registers nothing when there is no backdrop", () => {
    const p = propsWith("beach.mp4");
    delete p.segments[0].regionShader!.backdrop;
    expect(planMediaJobs(p, 30).some((j) => j.key.startsWith("rsbd"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/segment-backdrop-job.test.ts`
Expected: FAIL — `expect(job).toBeDefined()` receives `undefined`.

- [ ] **Step 3: Implement**

In `src/render/native/videoFrames.ts`, inside `planMediaJobs`'s `if (rs) { … }` block, after the
`rs.masks.forEach` loop:

```ts
      // Region-shader BACKDROP (uTex1): a second, unrelated clip behind the cutout subject. Its own
      // clock on purpose — the beat's clipFrom/speed/pauseAt describe the beat's OWN source, and
      // seeking a different file to the same second is arbitrary rather than useful. So: the
      // backdrop's frame 0 at the beat's start, one backdrop frame per composition frame (extraction
      // holds the last frame if the beat outlasts the clip). /vframes rather than a <video> seek for
      // the same reason the masks are: <video> never advances under headless capture.
      if (rs.backdrop && /\.(mp4|mov)$/i.test(rs.backdrop)) {
        const seqDur = appSeqDurFrames(props.segments, i, fps);
        if (seqDur > 0) {
          jobs.push({
            key: `rsbd${i}`,
            assetRel: rs.backdrop,
            fromFrame: f(s.startSec, fps),
            seqDurFrames: seqDur,
            startSec: 0,
            stepSec: 1 / fps,
            effFrame: (n) => n,
            maxEffFrame: seqDur - 1,
          });
        }
      }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/segment-backdrop-job.test.ts tests/appMedia.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/native/videoFrames.ts tests/segment-backdrop-job.test.ts
git commit -s -m "feat(region): per-beat /vframes job for the backdrop clip"
```

---

### Task 4: Page wiring + the render proof

**Files:**
- Modify: `src/render/native/page/RegionShader.tsx` (uniform names ~line 220, `initGL` ~line 226, `drawFrame` ~line 259, component props ~line 311)
- Modify: `src/render/native/page/KinoVideo.tsx:76-87`
- Test: `tests/render-region-backdrop.test.ts` (create)

**Interfaces:**
- Consumes: `assembleRegionShaderSource(..., hasBackdrop)` (Task 1), `RegionShaderProps.backdrop`
  (Task 2), the `rsbd<i>` job key (Task 3).
- Produces: nothing downstream.

**Read the file in Python, not with grep** — it carries a non-UTF8 byte:
`python3 -c "print(open('src/render/native/page/RegionShader.tsx','rb').read().decode('utf-8','replace'))"`

- [ ] **Step 1: Write the failing test** — create `tests/render-region-backdrop.test.ts`:

```ts
// Cutout compositing through a REAL render: the subject region shows the BEAT's clip, the
// background region shows a DIFFERENT clip, and — the assertion this file exists for — BOTH
// ANIMATE. The capability was missing precisely because the generic video-texture path renders
// frame 0 forever and looks entirely plausible, so a test that only checked "those pixels came
// from the other clip" would pass against exactly that bug.
//
// Both sources are frame-indexed ffmpeg ramps in DISJOINT channels, so a crop's colour says which
// clip it came from and its value says which FRAME:
//   asset    R = 40 + 7N, G = B = 0
//   backdrop B = 40 + 7N, R = G = 0, plus a green stripe at source x in [0.55, 0.60]
// The stripe pins the FIT: the backdrop is 16:9 in a 9:16 frame, so cover-fit shows only the middle
// 31.6% of its width and puts u = 0.575 at x = 796; a naive stretch would put it at 621.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderStills } from "../src/render/render.js";
import { FFMPEG_PATH } from "../src/media/binPaths.js";
import { magick } from "./magick.js";
import type { KinoProps } from "../src/render/props.js";

const W = 1080, H = 1920;      // composition
const BW = 1280, BH = 720;     // backdrop — deliberately a different aspect
const F0 = 0, F1 = 20;
const lvl = (n: number) => (40 + 7 * n) / 255;

// film: 0 kills the vignette+grain pass and disclosure "" the corner text — both would paint over
// the probe crops and skew a flat-colour mean.
const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0 };
const bg = {
  kind: "custom" as const, image: null, shaderCode: null,
  customCode: "ctx.fillStyle='#000';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);",
  params: {}, keyframes: [], triggers: [],
};

const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "",
  segments: [{
    kind: "video", source: "asset.mp4", caption: "", startSec: 0, endSec: 2,
    // No subject/background body at all: mask + backdrop IS the cutout spec.
    regionShader: {
      masks: [{ maskSrc: "mask.png", maskKind: "image" as const, channel: "gray" as const, subjectCode: null }],
      subjectCode: null, backgroundCode: null, backdrop: "backdrop.mp4",
    },
  }],
};

const cropRgb = (p: string, w: number, h: number, x: number, y: number): number[] =>
  magick([p, "-crop", `${w}x${h}+${x}+${y}`, "+repage", "-format", "%[fx:mean.r] %[fx:mean.g] %[fx:mean.b]", "info:"])
    .trim().split(/\s+/).map(Number);
const meanDiff = (a: string, b: string) =>
  parseFloat(magick([a, b, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim());

describe("cutout compositing", () => {
  it("puts a different, ANIMATING clip behind the masked subject, cover-fit", async () => {
    const pub = mkdtempSync(join(tmpdir(), "kino-backdrop-"));

    // Beat asset: red ramp, frame-indexed by N. Composition-sized so no fit question arises here.
    execFileSync(FFMPEG_PATH, ["-y", "-loglevel", "error",
      "-f", "lavfi", "-i", `color=black:s=${W}x${H}:r=30:d=2`,
      "-vf", "format=gbrp,geq=r='40+7*N':g='0':b='0'",
      "-c:v", "libx264", "-pix_fmt", "yuv444p", "-crf", "12", join(pub, "asset.mp4")]);

    // Backdrop: blue ramp + a green stripe at source x in [0.55, 0.60]. 16:9 on purpose.
    execFileSync(FFMPEG_PATH, ["-y", "-loglevel", "error",
      "-f", "lavfi", "-i", `color=black:s=${BW}x${BH}:r=30:d=2`,
      "-vf", `format=gbrp,geq=r='0':g='if(between(X,${Math.round(0.55 * BW)},${Math.round(0.60 * BW)}),255,0)':b='40+7*N'`,
      "-c:v", "libx264", "-pix_fmt", "yuv444p", "-crf", "12", join(pub, "backdrop.mp4")]);

    // Static mask: one rectangle. Static so the crops below are fixed and any change over time is
    // the SOURCES moving, never the mask.
    magick(["-size", `${W}x${H}`, "xc:black", "-fill", "white",
            "-draw", "rectangle 240,600 840,1320", join(pub, "mask.png")]);

    const out = await renderStills({
      props, publicDir: pub, format: "9:16",
      frames: [{ frame: F0, name: "a" }, { frame: F1, name: "b" }, { frame: F0, name: "a2" }],
      outDir: mkdtempSync(join(tmpdir(), "kino-backdrop-out-")),
    });

    // Crops: 200x200 well clear of every seam. Subject sits inside the mask rectangle; background
    // sits top-left, outside the mask AND clear of the stripe (which cover-fit puts at x≈711..881).
    const subj = (p: string) => cropRgb(p, 200, 200, 440, 860);
    const back = (p: string) => cropRgb(p, 200, 200, 100, 100);
    const s0 = subj(out[0]), s1 = subj(out[1]), b0 = back(out[0]), b1 = back(out[1]);
    console.log(`subject f${F0}=${s0} f${F1}=${s1} | background f${F0}=${b0} f${F1}=${b1}`);

    // 1. The subject region is the BEAT's clip (red), and it animates.
    expect(Math.abs(s0[0] - lvl(F0))).toBeLessThan(0.035);
    expect(Math.abs(s1[0] - lvl(F1))).toBeLessThan(0.035);
    expect(s0[2]).toBeLessThan(0.06);   // no blue — not the backdrop
    expect(s1[2]).toBeLessThan(0.06);

    // 2. The background region is the OTHER clip (blue), not the beat's asset.
    expect(b0[0]).toBeLessThan(0.06);   // no red — not the asset
    expect(b1[0]).toBeLessThan(0.06);

    // 3. THE ASSERTION THIS FILE EXISTS FOR. The backdrop ADVANCES: a frozen-at-frame-0 backdrop
    //    (the bug this feature routes around) reads lvl(0) at both times and collapses this to 0.
    expect(Math.abs(b0[2] - lvl(F0))).toBeLessThan(0.035);
    expect(Math.abs(b1[2] - lvl(F1))).toBeLessThan(0.035);
    expect(b1[2] - b0[2]).toBeGreaterThan(0.45);   // expected 140/255 = 0.549
    expect(b1[2] - b0[2]).toBeLessThan(0.65);

    // 4. And the subject advanced too, by the same amount — both regions moved, not just one.
    expect(s1[0] - s0[0]).toBeGreaterThan(0.45);
    expect(s1[0] - s0[0]).toBeLessThan(0.65);

    // 5. FIT. Cover-fit of 1280x720 into 1080x1920 scales u by ra/ta = 0.5625/1.7778 = 0.3164, so
    //    source u = 0.575 lands at 0.5 + (0.075 / 0.3164) = 0.737 of the width = x 796. A stretch
    //    would put it at 0.575 * 1080 = 621. Measured on the green channel in the top band, which
    //    is entirely background region.
    const sb = magick([out[1], "-crop", `${W}x400+0+0`, "+repage", "-channel", "G", "-separate",
                       "-threshold", "50%", "-format", "%@", "info:"]).trim();
    const [, sw, , sx] = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(sb)!.map(Number);
    console.log(`stripe bbox ${sb} centre ${sx + sw / 2} (cover-fit expects ~796, stretch would be 621)`);
    expect(Math.abs(sx + sw / 2 - 796)).toBeLessThan(25);

    // Determinism: two seeks to the same frame index are byte-identical.
    expect(meanDiff(out[0], out[2])).toBe(0);
  }, 300000);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/render-region-backdrop.test.ts`
Expected: FAIL — the background region reads the beat's red asset (`b0[0]` ≈ 0.157, not < 0.06),
because nothing binds `uTex1` yet.

- [ ] **Step 3: Implement — `RegionShader.tsx`**

3a. Pass the flag into the assembler in `initGL` (which needs the new arg on its own signature):

```ts
async function initGL(
  canvas: HTMLCanvasElement,
  assetSrc: Src,
  maskSrcs: Src[],
  region: RegionShaderProps,
  backdropSrc: Src | null,
): Promise<GLState | null> {
```

and inside:

```ts
    const fragSrc = assembleRegionShaderSource(
      region.subjectCode,
      region.backgroundCode,
      regionExtras(region),
      region.masks.map((m) => m.subjectCode ?? null),
      !!backdropSrc,
    );
```

3b. Add the two uniform names to the `names` array (after `"uTex0"`): `"uTex1", "uTexSize1",`.

3c. After the mask slot loop in `initGL`, build the backdrop slot on the unit past the masks and
upload its natural size — the cover-fit helpers are dead without it:

```ts
    // Backdrop on the unit past the masks (0 = asset, 1..MAX_REGION_MASKS = masks). uTexSize1 is
    // the FIRST uTexSize this component has ever uploaded: kinoCoverUV/kinoBackdrop read it, and
    // with (0,0) they fall back to "no reframe", which would stretch an unrelated clip's aspect.
    // uTexSize0 is deliberately left unset — uploading it would silently switch existing specs that
    // call kinoBackdrop(uTex0, uTexSize0, ...) from stretch to cover-fit.
    let backdrop: Slot | null = null;
    if (backdropSrc) {
      backdrop = await makeSlot(gl, MAX_REGION_MASKS + 1, backdropSrc, loc.uTex1);
      gl.uniform2f(loc.uTexSize1, backdrop.size[0], backdrop.size[1]);
    }
    return { gl, prog, loc, asset: assetSlot, masks, backdrop };
```

3d. `Slot` must carry the source's pixel size for that upload, and `GLState` the new slot:

```ts
interface Slot {
  handle: WebGLTexture;
  unit: number;
  size: [number, number]; // source pixels; (0,0) until a real image lands (cover-fit reads this)
  frameVideo?: { lastUrl: string };
}
```

In `makeSlot`, capture it — replace the two `uploadTex(...)` call sites and the placeholder branch
so every return sets `size`:

```ts
  let slot: Slot;
  if (src.frameVideo) {
    if (src.frameUrl) {
      const img = await loadImage(src.frameUrl);
      uploadTex(gl, unit, handle, img);
      slot = { handle, unit, size: [img.naturalWidth, img.naturalHeight], frameVideo: { lastUrl: src.frameUrl } };
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      slot = { handle, unit, size: [0, 0], frameVideo: { lastUrl: "" } };
    }
  } else {
    const img = await loadImage(src.staticUrl);
    uploadTex(gl, unit, handle, img);
    slot = { handle, unit, size: [img.naturalWidth, img.naturalHeight] };
  }
```

and in `makePlaceholderSlot` return `{ handle, unit, size: [0, 0] }`.

3e. `GLState` gains `backdrop: Slot | null;`. `disposeGL` deletes it:

```ts
  if (st.backdrop) st.gl.deleteTexture(st.backdrop.handle);
```

3f. `drawFrame` takes `backdropSrc: Src | null`, passes it to `initGL`, and re-uploads the
backdrop's frame alongside the masks. A sparse still can start with `size` at (0,0) (no frame
extracted at init), so refresh `uTexSize1` after the upload:

```ts
    await updateFrameSlot(gl, st.asset, assetSrc.frameUrl);
    await Promise.all(maskSrcs.map((src, i) => updateFrameSlot(gl, st.masks[i], src.frameUrl)));
    if (st.backdrop && backdropSrc) {
      await updateFrameSlot(gl, st.backdrop, backdropSrc.frameUrl);
      gl.uniform2f(loc.uTexSize1, st.backdrop.size[0], st.backdrop.size[1]);
    }
```

`updateFrameSlot` must keep `size` current:

```ts
async function updateFrameSlot(gl: WebGL2RenderingContext, slot: Slot, url: string | null): Promise<void> {
  if (!slot.frameVideo || !url || url === slot.frameVideo.lastUrl) return;
  const img = await loadImage(url);
  uploadTex(gl, slot.unit, slot.handle, img);
  slot.size = [img.naturalWidth, img.naturalHeight];
  slot.frameVideo.lastUrl = url;
}
```

Note `gl.useProgram(prog)` already runs before these uniform writes in `drawFrame`; keep the
`uniform2f` after it.

3g. Component: new prop and the `Src`. `useFrameImageUrl` is a hook, so call it unconditionally.

```ts
  backdropMediaKey?: string; // /vframes key when the backdrop is a video (else it is a static image)
}> = ({ asset, region, t, assetMediaKey, maskMediaKeys, backdropMediaKey }) => {
```

```ts
  const backdropFrameUrl = useFrameImageUrl(backdropMediaKey);
  const backdropSrc: Src | null = region.backdrop
    ? { frameVideo: !!backdropMediaKey, staticUrl: staticFile(region.backdrop), frameUrl: backdropFrameUrl }
    : null;
```

Add to `glKey` (the program bakes in whether the backdrop aliases were emitted, and the slot is
built once at init):

```ts
    `${backdropSrc?.frameVideo}|${backdropSrc?.staticUrl}`,
```

and pass `backdropSrc` through the `drawFrame` call in the effect.

- [ ] **Step 4: Implement — `KinoVideo.tsx`**

Add one prop to the `<RegionShader>` element (after `maskMediaKeys`):

```tsx
                backdropMediaKey={
                  s.regionShader.backdrop && /\.(mp4|mov)$/i.test(s.regionShader.backdrop) ? `rsbd${i}` : undefined
                }
```

- [ ] **Step 5: Build and run the render test**

Run: `npm run build && npx vitest run tests/render-region-backdrop.test.ts`
Expected: PASS, with the logged subject/background/stripe numbers matching the comments.

- [ ] **Step 6: Prove the assertions bite**

Make each break, run the test, record the failure, revert:

1. **Frozen backdrop** — in `drawFrame`, skip the backdrop's `updateFrameSlot`. Assertion 3 must
   fail (`b1[2] - b0[2]` → ~0). This is the exact bug the feature exists to avoid.
2. **Wrong source** — in `assembleRegionShaderSource`, make the backdrop passthrough read `uTex0`.
   Assertion 2 must fail (`b0[0]` → ~0.157).
3. **No fit** — pass `0, 0` to `gl.uniform2f(loc.uTexSize1, …)`. Assertion 5 must fail (stripe
   centre → ~621).

- [ ] **Step 7: Full suite**

Run: `npx vitest run && npm run build`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add src/render/native/page/RegionShader.tsx src/render/native/page/KinoVideo.tsx tests/render-region-backdrop.test.ts
git commit -s -m "feat(region): upload the backdrop texture + uTexSize, cover-fit cutout render"
```

---

### Task 5: A real cutout, docs, and the report

**Files:**
- Create: `examples/segmentation/cutout.json` + a short `README` note in `examples/segmentation/README.md`
- Modify: `docs/segmentation.md` (a `#### A different background: cutout compositing` subsection under "Region shaders — the main event")
- Modify: `docs/segmentation-tracking-todo.md` (note that the page-global `backgroundTextures` video channel is still frozen and this feature did NOT fix it)
- Create: `docs/superpowers/specs/2026-07-25-cutout-compositing-REPORT.md`
- Create: `out/cutout-demo.mp4` (or wherever `kino build` lands it) — a real render

- [ ] **Step 1: Render a real cutout**

Use the in-tree 2-object CoreML mask and its clip:
`projects/segtest/assets/masks/zebco` (mask.mp4, objects r/g) over `projects/segtest/assets/frag/zebras.mp4`,
with a Pexels clip from another project as the backdrop (e.g. `projects/lunara/assets/pexels/…`).
Copy both into a scratch project's `assets/`, write a spec with
`"regionShader": { "masks": [{"mask":"masks/zebco","object":0},{"mask":"masks/zebco","object":1}], "backdrop": "pexels/<id>.mp4" }`,
and build it. Save the mp4 under the worktree and note its path in the report.

- [ ] **Step 2: Look at the silhouette honestly**

Extract a still and zoom the mask boundary. The composite mixes with a fixed
`smoothstep(0.4, 0.6, m)` and real footage bleeds its original background into the edge. Record what
you actually see. If it fringes, note that `kinoMaskDist` makes a slight erode expressible from a
subject body (`step(-2.0, d)`) — **do not change the compositing default**, which every existing
spec shares.

- [ ] **Step 3: Write the docs and the report**

Docs subsection covers: the `backdrop` key, that the background passthrough is now the backdrop
cover-fit, that `kinoBackground` therefore refracts the backdrop, the timing rule, and the edge
caveat. Report covers: surface, routing, fit (including the `uTexSize0` asymmetry), passthrough
semantics, edge quality with the honest look, cost, the tests and their bite proof from Task 4
Step 6, and anything unresolved.

- [ ] **Step 4: Commit**

```bash
git add docs examples
git commit -s -m "docs(segment): cutout compositing — backdrop clip behind a segmented subject"
```
