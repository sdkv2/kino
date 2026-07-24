# Multi-object mask chroma fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `kinoMaskDist` usable on R/G/B-packed multi-object masks by taking the mask out of
subsampled chroma and out of lossy re-extraction.

**Architecture:** Two edits on the mask's path, both required (measurements in
`docs/superpowers/specs/2026-07-24-multi-object-chroma.md` show either alone is insufficient):
the mask encode becomes lossless 4:4:4, and mask frame extraction writes PNG. Extraction is shared
with ordinary footage, so the PNG branch is gated on the `rsmask` job-key prefix and footage is
untouched.

**Tech Stack:** TypeScript, vitest, ffmpeg (ffmpeg-static), Python (SAM runners), GLSL.

## Global Constraints

- Determinism: no wall clock, no unseeded randomness in tests or fixtures.
- Do not change `kinoMaskDist`'s signature or its two-regime structure.
- `MAX_REGION_MASKS = 4`. h264 has no alpha at any pixel format — a 4th object still needs its own
  file. Do not imply otherwise in code or docs.
- Footage must keep its JPEG path and its current cost.
- Masks already on disk (yuv420p) must still render.
- `npx vitest run` and `npm run build` green before finishing.

---

### Task 1: PNG extraction for mask jobs only

**Files:**
- Modify: `src/render/native/videoFrames.ts:181-248` (`extractIndices`)
- Test: `tests/render-maskdist-multiobject.test.ts` (created in Task 3, which is what proves this)

**Interfaces:**
- Consumes: `MediaJob.key`, already `rsmask${i}_${j}` for mask jobs (`videoFrames.ts:80`).
- Produces: no signature change. `MediaEntryNode.byFrame` values gain `.png` names for mask jobs.

- [ ] **Step 1: Add the mask-job predicate and switch the output extension**

In `extractIndices`, replace the hardcoded `-q:v 2` / `x%06d.jpg` output with a per-job choice.
Masks are the only asset that needs exactness; footage does not.

```ts
  // Masks are the ONLY asset that needs exact pixels: kinoMaskDist reads a coverage gradient, and
  // JPEG's DCT quantization alone puts ~25k px/frame of a packed multi-object mask over the
  // analytic-branch gate (measured — see docs/superpowers/specs/2026-07-24-multi-object-chroma.md).
  // PNG is also SMALLER than JPEG for binary masks (0.33MB vs 1.12MB per 24 frames @1080x1920), so
  // this costs no disk. Footage keeps JPEG q2 — visually lossless and far cheaper on real photos.
  const isMask = job.key.startsWith("rsmask");
  const ext = isMask ? "png" : "jpg";
  const quality = isMask ? [] : ["-q:v", "2"];
```

Then in the ffmpeg args replace `"-q:v", "2",` with `...quality,` and
`join(dir, "x%06d.jpg")` with `join(dir, \`x%06d.${ext}\`)`.

- [ ] **Step 2: Fix the readback filter, which also hardcodes `.jpg`**

```ts
  const files = readdirSync(dir).filter((x) => x.startsWith("x") && x.endsWith(`.${ext}`)).sort();
```

This line is easy to miss and fails silently — a stale filter returns zero files and every frame
clamps to "hold last frame", so the render succeeds with a frozen mask.

- [ ] **Step 3: Verify the server already serves PNG**

Run: `grep -n '"\.png"' src/render/native/server.ts`
Expected: `".png": "image/png",` is already in the MIME map — no change needed.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/render/native/videoFrames.ts
git commit -m "fix(segment): extract mask frames as PNG, footage keeps JPEG"
```

---

### Task 2: Lossless 4:4:4 mask encode

**Files:**
- Modify: `scripts/sam_runner_cuda.py:662`
- Modify: `scripts/sam_runner.py:298` and `scripts/sam_runner.py:490`
- Modify: `src/segment/mock.ts:43`

**Interfaces:**
- Consumes: nothing new.
- Produces: `mask.mp4` in H.264 High 4:4:4 Predictive, `yuv444p`, `-qp 0`. Manifest unchanged.

- [ ] **Step 1: Change all three Python encode sites**

Each is the identical 5-line block. Replace `"-pix_fmt", "yuv420p", "-crf", "16",` with:

```python
             # Lossless 4:4:4. Multi-object masks pack one object per R/G/B channel, and 4:2:0
             # subsampling puts two of them at half resolution — one object's boundary rings into
             # another's channel. Measured: flat-region coverage gradient reaches 0.85 under
             # yuv420p/crf16 against a 0.05 analytic-branch gate, and 0.0055 here. Lossy 4:4:4 is
             # NOT enough on its own (0.62). Costs nothing: binary masks code losslessly at ~half
             # the size of crf 16. See docs/superpowers/specs/2026-07-24-multi-object-chroma.md.
             "-c:v", "libx264", "-pix_fmt", "yuv444p", "-qp", "0",
```

- [ ] **Step 2: Change the mock backend encode**

In `src/segment/mock.ts`, replace `"-pix_fmt", "yuv420p", "-c:v", "libx264",` with
`"-pix_fmt", "yuv444p", "-c:v", "libx264", "-qp", "0",` and a one-line comment pointing at the spec.

- [ ] **Step 3: Run the mock/segment tests**

Run: `npx vitest run tests/segment-mock.test.ts tests/segment-cmd.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/sam_runner.py scripts/sam_runner_cuda.py src/segment/mock.ts
git commit -m "fix(segment): encode masks lossless 4:4:4, not yuv420p crf16"
```

---

### Task 3: Render-level test on a packed multi-object mask

**Files:**
- Create: `tests/render-maskdist-multiobject.test.ts`

**Interfaces:**
- Consumes: `renderStills` from `src/render/render.js`, `writeManifest` from
  `src/segment/manifest.js`, `FFMPEG_PATH` from `src/media/binPaths.js`, `magick` from
  `./magick.js` — all exactly as `tests/render-maskdist-video.test.ts` uses them.

This is the test that proves the fix. It follows `tests/render-maskdist-video.test.ts` (compressed
video mask, real render, isoline measurement) but packs three objects and rims **object 1, the G
channel** — the channel the feature's most natural use needs and the one that was broken.

- [ ] **Step 1: Write the failing test**

```ts
// kinoMaskDist on a PACKED MULTI-OBJECT mask — three objects in R/G/B, which is what both SAM
// runners write for --objects > 1. tests/render-maskdist-video.test.ts covers the single-object
// grayscale case only, where coverage rides luma and 4:2:0 never touches it. The packed case was
// measurably broken: flat-region coverage gradient reached 0.85 against a 0.05 gate, so thousands
// of interior pixels per frame took the analytic branch and answered 0.5/g instead of -radius.
// See docs/superpowers/specs/2026-07-24-multi-object-chroma.md.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderStills } from "../src/render/render.js";
import { writeManifest } from "../src/segment/manifest.js";
import { FFMPEG_PATH } from "../src/media/binPaths.js";
import { magick } from "./magick.js";
import type { KinoProps } from "../src/render/props.js";

const W = 1080, H = 1920, DISC_R = 300;
// Object 1 (G) is the disc under test. It MOVES: a static clip codes as near-free P-frames and
// understates residual ringing. Frame-indexed, so the fixture is deterministic.
const cx = (n: number) => 540 + n * 3;
const cy = (n: number) => 960 + n * 2;
const FRAME = 10;
const RADIUS = 64;

// Same probe as the single-object test: green = |d| normalised over the radius, so green >= 0.5 IS
// the |d| = radius/2 isoline. Reads uMask0 with uChannel0, which the manifest binds to G.
const body =
  "void mainImage(out vec4 c, in vec2 f){\n" +
  `  float d = kinoMaskDist(uMask0, uChannel0, f, ${RADIUS.toFixed(1)});\n` +
  `  c = vec4(1.0 - smoothstep(0.0, 3.0, -d), clamp(-d / ${RADIUS.toFixed(1)}, 0.0, 1.0), 0.0, 1.0);\n}`;

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0 };
const bg = {
  kind: "custom" as const, image: null, shaderCode: null,
  customCode: "ctx.fillStyle='#000';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);",
  params: {}, keyframes: [], triggers: [],
};

/** mask.mp4 with THREE objects packed one per channel, as sam_runner*.py writes for n > 1.
 *  R and B carry busy neighbours whose edges are what ring into G under 4:2:0. */
function writeMaskAsset(dir: string): void {
  const g = `if(lt(pow(X-(540+N*3),2)+pow(Y-(960+N*2),2),${DISC_R * DISC_R}),255,0)`;
  // Object 0 (R): a bar sweeping across the frame, deliberately crossing the disc's neighbourhood.
  const r = `if(between(X-N*4,120,420)*between(Y,200,1700),255,0)`;
  // Object 2 (B): a comb of 24px stripes — the finest structure in the frame, so the worst ringer.
  const b = `if(gt(X,700)*lt(mod(X+N*2,48),24)*between(Y,300,1600),255,0)`;
  execFileSync(FFMPEG_PATH, [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", `color=black:s=${W}x${H}:r=30:d=1`,
    "-vf", `format=gbrp,geq=r='${r}':g='${g}':b='${b}'`,
    "-c:v", "libx264", "-pix_fmt", "yuv444p", "-qp", "0",
    join(dir, "mask.mp4"),
  ]);
  writeManifest(dir, {
    kind: "video", source: "input.mp4", prompt: "three", width: W, height: H, fps: 30, frames: 30,
    objects: [
      { id: 0, label: "bar", channel: "r" },
      { id: 1, label: "disc", channel: "g" },
      { id: 2, label: "comb", channel: "b" },
    ],
    backend: "test", tracked: true,
  });
  magick(["-size", `${W}x${H}`, "xc:#333333", join(dir, "asset.png")]);
}

const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "",
  segments: [{
    kind: "video", source: "asset.png", caption: "", startSec: 0, endSec: 2,
    regionShader: {
      masks: [{ maskSrc: "mask.mp4", maskKind: "video" as const, channel: "g" as const }],
      subjectCode: body, backgroundCode: body,
    },
  }],
};

describe("kinoMaskDist on a packed multi-object mask", () => {
  it("keeps chroma ringing out of the analytic branch on the G channel", async () => {
    const publicDir = mkdtempSync(join(tmpdir(), "kino-maskmulti-"));
    writeMaskAsset(publicDir);
    const out = await renderStills({
      props, publicDir, format: "9:16",
      frames: [{ frame: FRAME, name: "probe" }],
      outDir: mkdtempSync(join(tmpdir(), "kino-maskmulti-out-")),
    });

    const bbox = magick([out[0], "-channel", "G", "-separate", "-threshold", "50%", "-format", "%@", "info:"]).trim();
    const [, bw, bh, bx, by] = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(bbox)!.map(Number);
    const isoline = 2 * (DISC_R - RADIUS / 2);

    // Deep interior: a square inscribed well inside the disc, every pixel further than RADIUS from
    // the edge, so the whole crop owes a saturated -RADIUS. THIS is where the speckle lived.
    const side = 320;
    const crop = `${side}x${side}+${Math.round(cx(FRAME) - side / 2)}+${Math.round(cy(FRAME) - side / 2)}`;
    const meanG = parseFloat(magick([out[0], "-crop", crop, "+repage", "-format", "%[fx:mean.g]", "info:"]).trim());
    // Count interior pixels that are NOT saturated — the direct speckle measure. A pixel that
    // wrongly takes the analytic branch answers 0.5/g, which at RADIUS 64 is visibly < 1.0.
    const speckle = Number(magick([out[0], "-crop", crop, "+repage", "-channel", "G", "-separate",
                                   "-threshold", "99%", "-negate", "-format", "%[fx:mean*w*h]", "info:"]).trim());
    console.log(`multi-object isoline bbox ${bbox} (expect ~${isoline}px, centred ${cx(FRAME)},${cy(FRAME)}) meanG=${meanG} speckle=${speckle}`);

    // Geometry — also pins the mask decode and the G-channel binding: if uChannel0 selected the
    // wrong channel the bbox would be the bar or the comb, not a disc.
    expect(Math.abs(bx + bw / 2 - cx(FRAME))).toBeLessThan(6);
    expect(Math.abs(by + bh / 2 - cy(FRAME))).toBeLessThan(6);
    expect(Math.abs(bw - isoline)).toBeLessThan(30);
    expect(Math.abs(bh - isoline)).toBeLessThan(30);

    // THE regression bound. Zero speckled pixels with the fix; thousands without it.
    expect(speckle).toBeLessThan(50);
    expect(meanG).toBeGreaterThan(0.999);
  }, 240000);
});
```

- [ ] **Step 2: Prove the test bites — revert the fix and watch it fail**

Temporarily set the fixture encode back to `"-pix_fmt", "yuv420p", "-crf", "16"` AND the
extraction back to JPEG, run the test, and record `speckle` and `meanG`. Then restore both.
Record both numbers in the spec's Verification section.

Run: `npx vitest run tests/render-maskdist-multiobject.test.ts`
Expected (reverted): FAIL on `speckle` — thousands of pixels.
Expected (fixed): PASS — speckle 0.

- [ ] **Step 3: Commit**

```bash
git add tests/render-maskdist-multiobject.test.ts
git commit -m "test(segment): render-level proof kinoMaskDist works on a packed G-channel mask"
```

---

### Task 4: Docs and the gate comment

**Files:**
- Modify: `src/render/shaderSource.ts` (the `kinoMaskDist` justification comment)
- Modify: `docs/segmentation.md:243-247` (the R/G/B-packed limitation)
- Modify: `docs/segmentation-tracking-todo.md:44-46` (the stale "accepted limitation" note)
- Modify: `docs/superpowers/specs/2026-07-24-multi-object-chroma.md` (Verification section)

- [ ] **Step 1: Update the gate comment**

Record the new floor and that the gate is **unchanged at 0.05**, with the reason: masks already on
disk are still subsampled, and the prior measurement rendered 0.02–0.4 identically.

- [ ] **Step 2: Rewrite the `docs/segmentation.md` limitation**

The limitation is now conditional on **when the mask was generated**, not absolute. Masks generated
after this change clear the gate by 9x; older ones do not.

- [ ] **Step 3: Replace the stale todo note**

`docs/segmentation-tracking-todo.md:45` currently calls 4:2:0 softening "acceptable for a lossy
fallback". It is no longer accepted — it is fixed. Rewrite, keeping the 4-object/no-alpha bullet
which is still true.

- [ ] **Step 4: Fill in the spec's Verification section** with the bite-proof numbers and the
measured extraction wall-clock.

- [ ] **Step 5: Full suite + build**

Run: `npx vitest run` then `npm run build`
Expected: both green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs(segment): multi-object masks are out of subsampled chroma"
```
