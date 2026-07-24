# Mask Distance (`kinoMaskDist`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give region shaders a signed distance-to-mask-edge value in pixels, so rim light, outline, outward glow, chromatic fringe and erode/dilate become expressible.

**Architecture:** One pure GLSL helper injected into the shared `GLSL_HELPERS` block in `src/render/shaderSource.ts`. It estimates distance by sampling the mask texture that is already bound (`uMask0..3` + `uChannel0..3`) along a golden-angle spiral. No pipeline, manifest, CLI or `kino segment` changes — it works on every mask already on disk.

**Tech Stack:** TypeScript, GLSL ES 3.00, vitest, puppeteer (via `renderStills`), ImageMagick (via the `tests/magick.ts` argv helper).

**Spec:** `docs/superpowers/specs/2026-07-24-mask-distance-design.md`

## Global Constraints

- GLSL target is **GLSL ES 3.00** (`#version 300 es`). Loop bounds must be compile-time constants.
- **Determinism is mandatory.** No `Date.now`, no wall-clock uniform, no unseeded noise. Same frame index must produce identical pixels. The helper may read only its arguments, `iResolution`, and the mask texture.
- The default renderer is **SwiftShader (software)**; `KINO_GPU=1` is opt-in. Keep the tap budget fixed at 24 — do not make it scale with radius.
- `MAX_REGION_MASKS = 4`. The helper takes the sampler and channel as arguments so it works with any of `uMask0..3` / `uChannel0..3`, from either region body.
- Unused helpers must compile away — do not add uniforms or `out` variables.
- Match the existing comment voice in `GLSL_HELPERS`: say what the helper is for and what its limits are, not what the code literally does.

---

### Task 1: The `kinoMaskDist` helper

**Files:**
- Modify: `src/render/shaderSource.ts` (the `GLSL_HELPERS` template literal, starts line 41)
- Test: `tests/segment-regionshader-src.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the GLSL function
  `float kinoMaskDist(sampler2D mask, vec4 channel, vec2 fragCoord, float radius)`
  — returns signed distance in pixels, negative inside the masked region, positive outside, saturating at `±radius`. Task 2 renders against this exact signature.

- [ ] **Step 1: Write the failing test**

Append this case inside the existing `describe("assembleRegionShaderSource", ...)` block in `tests/segment-regionshader-src.test.ts`:

```ts
  it("injects kinoMaskDist so region bodies can read distance to the mask edge", () => {
    const src = assembleRegionShaderSource(SUBJ, null, []);
    expect(src).toContain("float kinoMaskDist(sampler2D mask, vec4 channel, vec2 fragCoord, float radius)");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/segment-regionshader-src.test.ts`
Expected: FAIL — the new case reports the substring is missing. The pre-existing cases in the file still pass.

- [ ] **Step 3: Write minimal implementation**

In `src/render/shaderSource.ts`, inside the `GLSL_HELPERS` template literal, append this after the `kinoBackdropOffset` function and before the closing backtick:

```glsl
// Signed distance in PIXELS from this pixel to the nearest mask boundary: negative inside the
// masked region, positive outside, saturating at ±radius. Region shaders otherwise see only a
// binary in/out, which is what blocks rim light, outline, outward glow, edge fringe and
// erode/dilate. Takes the sampler + channel so it serves any uMask0..3 from either region body.
// Approximate by design: a golden-angle spiral with linear radial spacing, so resolution is
// radius/24 px and a feature thinner than that step can be missed — at radius 24 the step is
// 1px, at radius 240 it is 10px and thin detail will alias. Reads only the texture and the
// coordinate, so determinism holds.
#define KINO_MASK_TAPS 24
float kinoMaskDist(sampler2D mask, vec4 channel, vec2 fragCoord, float radius){
  vec2 res = iResolution.xy;
  vec2 uv = fragCoord / res;
  vec2 texel = 1.0 / res;
  float here = step(0.5, dot(texture(mask, uv), channel));
  float best = radius;
  for (int i = 0; i < KINO_MASK_TAPS; i++){
    float r = (float(i) + 1.0) / float(KINO_MASK_TAPS) * radius;
    float a = float(i) * 2.39996323;
    float s = step(0.5, dot(texture(mask, uv + vec2(cos(a), sin(a)) * r * texel), channel));
    if (s != here) { best = min(best, r); }
  }
  return here > 0.5 ? -best : best;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/segment-regionshader-src.test.ts`
Expected: PASS, all cases in the file.

Then confirm nothing else regressed — `GLSL_HELPERS` is shared with `assembleShaderSource`, and both of these files assert on assembled source:

Run: `npx vitest run tests/render/shaderSource.test.ts tests/segment-regionshader-src.test.ts`
Expected: PASS, both files.

- [ ] **Step 5: Commit**

```bash
git add src/render/shaderSource.ts tests/segment-regionshader-src.test.ts
git commit -m "feat(shader): kinoMaskDist — signed distance to the mask edge

Region shaders reduced every mask to a binary in/out, so a body could know
whether a pixel was on the subject but never how far from the silhouette.
That blocks rim light, outline, outward glow, edge fringe and erode/dilate.

Estimates distance from the mask already bound: a 24-tap golden-angle spiral
with linear radial spacing, resolution radius/24 px. Approximate and bounded
by design; the signature is chosen so a precomputed distance field can replace
the body later without touching any shader that calls it."
```

---

### Task 2: Prove the behavior through a real render

A string assertion cannot catch a helper that returns a constant, inverts its sign, or saturates everywhere. This task renders through the actual browser and measures pixels, following the pattern already established by `tests/render-glass.test.ts`.

**Files:**
- Create: `tests/render-maskdist.test.ts`

**Interfaces:**
- Consumes: `kinoMaskDist(sampler2D, vec4, vec2, float)` from Task 1.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Create `tests/render-maskdist.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9 };
const bg = {
  kind: "custom" as const, image: null,
  customCode: "ctx.fillStyle='#000';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);",
  shaderCode: null,
  params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 },
  keyframes: [], triggers: [],
};

const W = 1080, H = 1920, CX = 540, CY = 960, R = 300;

// White where the predicate on the signed distance holds, black elsewhere. BOTH region bodies get
// the same body, so the reading does not depend on which side of the mask a pixel falls on — that
// is what lets a single frame observe distance across the boundary.
const probe = (expr: string) =>
  `void mainImage(out vec4 c, in vec2 f){ float d = kinoMaskDist(uMask0, uChannel0, f, 32.0); c = vec4(vec3(${expr}), 1.0); }`;

const mkProps = (code: string): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "test",
  segments: [{
    kind: "app", asset: "asset.png", caption: "", startSec: 0, endSec: 2,
    regionShader: {
      masks: [{ maskSrc: "mask.png", maskKind: "image" as const, channel: "gray" as const }],
      subjectCode: code, backgroundCode: code,
    },
  }],
});

const meanOf = (p: string) => parseFloat(magick([p, "-colorspace", "gray", "-format", "%[fx:mean]", "info:"]).trim());

async function renderProbe(expr: string, tag: string): Promise<number> {
  const publicDir = mkdtempSync(join(tmpdir(), `kino-maskdist-${tag}-`));
  magick(["-size", `${W}x${H}`, "xc:black", "-fill", "white",
          "-draw", `circle ${CX},${CY} ${CX},${CY - R}`, join(publicDir, "mask.png")]);
  magick(["-size", `${W}x${H}`, "xc:#333333", join(publicDir, "asset.png")]);
  const out = await renderStills({
    props: mkProps(probe(expr)), publicDir, format: "9:16",
    frames: [{ frame: 10, name: tag }], outDir: mkdtempSync(join(tmpdir(), `kino-maskdist-out-${tag}-`)),
  });
  return meanOf(out[0]);
}

describe("kinoMaskDist", () => {
  it("reads a real signed distance — a thin band at the edge, a filled interior", async () => {
    // |d| <= 2 → a ~4px ring on the mask boundary. Circumference 2*pi*300 * 4px over a
    // 1080x1920 frame is ~0.4% coverage.
    const ring = await renderProbe("1.0 - step(2.0, abs(d))", "ring");
    // d < -8 → everything deeper than 8px INSIDE the disc: ~13% coverage.
    const inside = await renderProbe("1.0 - step(-8.0, d)", "inside");

    // A constant return would light the whole frame; saturation at ±radius would light none.
    expect(ring).toBeGreaterThan(0.0005);
    expect(ring).toBeLessThan(0.03);

    // Catches an inverted sign: with the sign flipped, "deep inside" becomes everything
    // OUTSIDE the disc, which is ~86% of the frame instead of ~13%.
    expect(inside).toBeGreaterThan(0.05);
    expect(inside).toBeLessThan(0.30);

    // The interior must dominate the boundary band by a wide margin.
    expect(inside).toBeGreaterThan(ring * 5);
  }, 180000);
});
```

- [ ] **Step 2: Run test to verify it fails**

First stash the helper so the test is proven to fail for the right reason. Temporarily change the helper's final line in `src/render/shaderSource.ts` from `return here > 0.5 ? -best : best;` to `return 0.0;`.

Run: `npx vitest run tests/render-maskdist.test.ts`
Expected: FAIL — `ring` is ~1.0 (a constant 0 distance lights every pixel), tripping `expect(ring).toBeLessThan(0.03)`.

Restore the real `return here > 0.5 ? -best : best;` line before Step 3.

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run tests/render-maskdist.test.ts`
Expected: PASS. Takes up to ~2 minutes — it launches a real browser twice.

If it fails because ImageMagick is absent, `magick` throws ENOENT; install ImageMagick (the existing `tests/render-glass.test.ts` has the same requirement).

- [ ] **Step 4: Verify the sign guard actually guards**

Temporarily invert the helper's return to `return here > 0.5 ? best : -best;`.

Run: `npx vitest run tests/render-maskdist.test.ts`
Expected: FAIL on `expect(inside).toBeLessThan(0.30)` — the "deep inside" probe now lights the ~86% of the frame outside the disc.

Restore the correct return line and re-run to confirm PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/render-maskdist.test.ts
git commit -m "test(shader): prove kinoMaskDist through a real render

String assertions cannot catch a helper that returns a constant, saturates at
the radius, or inverts its sign. Renders a disc mask through the browser and
measures coverage: a |d|<=2 probe must yield a thin boundary band, a d<-8 probe
a filled interior, and the interior must dominate the band. Each of the three
failure modes trips a different bound."
```

---

### Task 3: Document the helper and its ceiling

**Files:**
- Modify: `.claude/skills/shader-backgrounds/SKILL.md` (injected-helpers table, around line 97)
- Modify: `docs/segmentation.md` (the "Using masks" / region shaders section)

**Interfaces:**
- Consumes: the helper signature from Task 1.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Add the helper to the skill's table**

In `.claude/skills/shader-backgrounds/SKILL.md`, add this row to the injected-helpers table immediately after the `kinoBackdropOffset` row:

```markdown
| `kinoMaskDist(mask, channel, fragCoord, radius)` | Signed px distance to a region mask's edge (−inside/+outside) — rim, outline, glow, erode |
```

- [ ] **Step 2: Document it where region shaders are explained**

In `docs/segmentation.md`, add this subsection at the end of the "Region shaders — the main event" section, immediately before the "How region shaders assemble (for the curious)" heading:

```markdown
#### Distance to the mask edge

A region body sees a binary in/out by default. `kinoMaskDist` gives it the **signed distance to
the silhouette in pixels** — negative inside the masked region, positive outside — which is what
rim light, outline, outward glow, chromatic fringe and erode/dilate all need:

```glsl
float d = kinoMaskDist(uMask0, uChannel0, fragCoord, 24.0);
float rim   = 1.0 - smoothstep(0.0, 3.0,  -d);   // 3px band just inside the edge
float glow  = 1.0 - smoothstep(0.0, 24.0,  d);   // falloff outward from the edge
float eaten = step(-4.0, d);                     // erode the subject by 4px
```

Pass the same `uMaskN`/`uChannelN` pair the split itself uses (`uMask0`/`uChannel0` for a single
mask). It works from the subject body, the background body, or both.

It is an **estimate**: a 24-tap spiral with linear radial spacing, so resolution is `radius/24` px
and features thinner than that step can be missed — 1px steps at `radius` 24, 10px at 240. The
value saturates at `±radius`, so a wide soft glow beyond ~32px is not what this is for. Cost is 24
texture taps per pixel per body that calls it, on top of the two bodies that already run for every
pixel.
```

- [ ] **Step 3: Verify the docs render and nothing else broke**

Run: `npx vitest run`
Expected: PASS — the full suite, confirming Tasks 1 and 2 still hold.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/shader-backgrounds/SKILL.md docs/segmentation.md
git commit -m "docs(shader): document kinoMaskDist and its ceiling

Records the signature, the three worked uses that motivated it, and the limits
up front: radius/24 px resolution, saturation at ±radius, 24 taps per pixel per
calling body. Better stated here than discovered by whoever writes the next
region shader."
```

---

## Done when

- `kinoMaskDist` is injected into every assembled shader and compiles away when unused.
- The render test proves a real signed distance, with constant / saturated / inverted returns each tripping a bound.
- The skill table and `docs/segmentation.md` carry the signature, worked uses, and stated limits.
- `npx vitest run` passes.
- No change to `kino segment`, the mask manifest, the CLI, or any artifact on disk.
