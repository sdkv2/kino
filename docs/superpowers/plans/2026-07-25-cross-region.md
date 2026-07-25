# Cross-region sampling (`kinoBackground`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a region subject body sample the *shaded* background region at an arbitrary offset, so tracked glass over a background **treatment** refracts the treatment instead of the raw plate.

**Architecture:** No framebuffer. The background body is already emitted as the pure function `void regionBg(out vec4, in vec2 fragCoord)`; evaluating it at `fragCoord + offset` *is* the offset sample. The only blocker is emission order (subject bodies precede it in the one translation unit), so `assembleRegionShaderSource` gains a forward declaration plus a `#define kinoBackground regionBg` scoped to subject bodies only — emitted **only when a subject-side body mentions the name**, so non-users get byte-identical GLSL.

**Tech Stack:** TypeScript, GLSL ES 3.00, vitest, ImageMagick (`tests/magick.ts`), `renderStills` driving a real headless browser on SwiftShader.

## Global Constraints

- GLSL ES 3.00.
- Determinism: motion only from `iTime`, keyframed params, `uPulse`. No wall clock, no unseeded randomness.
- Do not change `kinoMaskDist`'s signature.
- `MAX_REGION_MASKS = 4` and `EXTRA_PARAM_SLOTS = 4` unchanged.
- A spec that does not use the feature must get a **byte-identical** assembled program, asserted with `toBe`.
- Never place a helper behind non-uniform control flow — screen-space derivatives are undefined there and fail silently.
- kino runs from compiled `dist/` — `npm run build` after editing source.
- Specs use beat kinds `scene`/`video` (with `source:`), not `app`/`avatar`.
- `npx vitest run` and `npm run build` green before finishing.
- `RegionShader.tsx` and `ShaderBackground.tsx` contain a non-UTF8 byte — plain `grep -n` silently reports nothing. Use `grep -an` or read them in Python.

**Design spec:** `docs/superpowers/specs/2026-07-25-cross-region-design.md`

---

### Task 1: Emit `kinoBackground` from the assembler, gated on use

**Files:**
- Modify: `src/render/shaderSource.ts` (`unionTail`, `perObjectTail`, and a new module-scope helper)
- Test: `tests/segment-regionshader-src.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: assembled region GLSL in which any subject-side body that mentions `kinoBackground` can call `void kinoBackground(out vec4 fragColor, in vec2 fragCoord)`. `assembleRegionShaderSource`'s signature is **unchanged**: `(subjectBody: string | null, backgroundBody: string | null, extraNames?: string[], maskBodies?: (string | null)[]) => string`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/segment-regionshader-src.test.ts`:

```ts
describe("kinoBackground (cross-region sampling)", () => {
  const BG = "void mainImage(out vec4 c, in vec2 f){ c = vec4(0.0, 0.0, 1.0, 1.0); }";
  const PLAIN = "void mainImage(out vec4 c, in vec2 f){ c = vec4(1.0); }";
  const USER = "void mainImage(out vec4 c, in vec2 f){ kinoBackground(c, f + vec2(0.0, 8.0)); }";

  // The backward-compat bar phases 2 and 3 both held: a spec that does not use the feature must
  // get the SAME BYTES it got before the feature existed.
  it("emits byte-identical source when no body mentions kinoBackground", () => {
    const src = assembleRegionShaderSource(PLAIN, BG);
    expect(src).not.toContain("kinoBackground");
    expect(src).not.toContain("void regionBg(out vec4 fragColor, in vec2 fragCoord);");
  });

  // Forward declaration BEFORE the subject body (GLSL needs declaration before use), and the alias
  // scoped to the subject body only.
  it("forward-declares regionBg and aliases it inside a subject body that uses it", () => {
    const src = assembleRegionShaderSource(USER, BG);
    expect(src).toContain("void regionBg(out vec4 fragColor, in vec2 fragCoord);");
    expect(src).toContain("#define kinoBackground regionBg");
    expect(src).toContain("#undef kinoBackground");
    expect(src.indexOf("void regionBg(out vec4 fragColor, in vec2 fragCoord);"))
      .toBeLessThan(src.indexOf("#define mainImage regionSubject"));
  });

  // The background body is where kinoBackground must NOT resolve — that is recursion, and leaving
  // it undefined turns the mistake into a loud compile error instead of a silent one.
  it("does not define kinoBackground for the background body", () => {
    const src = assembleRegionShaderSource(USER, BG);
    const undefAt = src.indexOf("#undef kinoBackground");
    expect(src.indexOf("#define mainImage regionBg")).toBeGreaterThan(undefAt);
  });

  // A background body that mentions it must NOT switch the feature on — it must still error loudly.
  it("is not switched on by the background body alone", () => {
    const src = assembleRegionShaderSource(PLAIN, "void mainImage(out vec4 c, in vec2 f){ kinoBackground(c, f); }");
    expect(src).not.toContain("#define kinoBackground regionBg");
  });

  // Per-object tail: a per-entry subject body gets the same access, alongside uMaskSelf.
  it("aliases kinoBackground inside a per-entry subject body", () => {
    const src = assembleRegionShaderSource(null, BG, [], [USER]);
    expect(src).toContain("void regionBg(out vec4 fragColor, in vec2 fragCoord);");
    expect(src).toContain("#define kinoBackground regionBg");
    expect(src.indexOf("void regionBg(out vec4 fragColor, in vec2 fragCoord);"))
      .toBeLessThan(src.indexOf("#define mainImage regionSubject0"));
  });

  // Per-object tail, unused: byte-identical to before.
  it("leaves the per-object tail untouched when no body mentions it", () => {
    const src = assembleRegionShaderSource(null, BG, [], [PLAIN]);
    expect(src).not.toContain("kinoBackground");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/segment-regionshader-src.test.ts`
Expected: the four "uses it" tests FAIL (the emitted source contains no `regionBg` forward declaration and no `#define kinoBackground`); the two "unused" tests PASS already.

- [ ] **Step 3: Implement**

In `src/render/shaderSource.ts`, add a module-scope helper immediately above `unionTail`:

```ts
// Cross-region sampling. The background body is emitted as a PURE function of fragCoord, so
// evaluating it at fragCoord+offset IS an offset sample of the shaded background — no framebuffer,
// no second pass, exact and full-resolution. The only blocker is order: subject bodies are emitted
// BEFORE the background body in the one translation unit they share, and GLSL wants a declaration
// first. Hence the forward declaration, plus a `kinoBackground` alias scoped to subject bodies the
// way uMaskSelf/uChannelSelf already are — using it in the BACKGROUND body would be recursion
// (illegal in GLSL) and has no meaning, so leaving it undefined there makes that a loud compile
// error against line-numbered source rather than a silent one.
//
// Emitted ONLY when a subject-side body actually names it, so a spec that doesn't use the feature
// gets byte-identical GLSL (asserted with toBe, the bar phases 2 and 3 held).
// ponytail: substring test, not a parse. A body naming it in a comment gets an unused declaration
// and an unused macro — harmless. One that builds the name via its own macro doesn't match and gets
// the compile error above. Parse the GLSL if that ever costs anyone anything.
//
// Cost is one evaluation of the background body per call: measured +0.019 s/frame for a light body,
// +0.112 for one 10x heavier (1080x1920, SwiftShader). That is ~5% of what the three kinoMaskDist
// calls in a typical bevel already cost, which is why this is a body call and not an FBO. The
// crossover — a WIDE kernel over an EXPENSIVE background body, ~8 taps heavy — is where a real
// two-pass FBO becomes the right answer; this signature does not change when it lands.
// See docs/superpowers/specs/2026-07-25-cross-region-design.md.
const BG_FORWARD_DECL = "void regionBg(out vec4 fragColor, in vec2 fragCoord);\n";
const usesBackground = (bodies: (string | null)[]): boolean =>
  bodies.some((b) => b?.includes("kinoBackground"));
```

Then wrap subject bodies. In `unionTail`, change the signature and the subject emission:

```ts
function unionTail(subj: string, bg: string): string {
  const xr = usesBackground([subj]);
  return (
    (xr ? BG_FORWARD_DECL : "") +
    // Preprocessor-namespace each body's mainImage → two collision-free functions. Bodies are the
    // normal shader convention, reused unchanged.
    "// ---- subject region body ----\n" +
    (xr ? "#define kinoBackground regionBg\n" : "") +
    "#define mainImage regionSubject\n" +
    subj +
    "\n#undef mainImage\n" +
    (xr ? "#undef kinoBackground\n" : "") +
    "// ---- background region body ----\n" +
    "#define mainImage regionBg\n" +
    bg +
    "\n#undef mainImage\n" +
    // ... rest of the function UNCHANGED
```

Leave every remaining line of `unionTail` exactly as it is.

In `perObjectTail`, compute the gate over every subject-side body (per-entry bodies plus the shared
fallback, never the background), emit the declaration once at the top, and wrap each subject body:

```ts
function perObjectTail(per: (string | null)[], subj: string, bg: string): string {
  const needShared = per.some((b) => !b);
  const xr = usesBackground([...per, ...(needShared ? [subj] : [])]);
  const varOf = (b: string | null, i: number) => (b ? `s${i}` : "sShared");
  return (
    (xr ? BG_FORWARD_DECL : "") +
    per
      .map((b, i) =>
        b
          ? `// ---- subject region body for mask ${i} ----\n` +
            `#define uMaskSelf uMask${i}\n` +
            `#define uChannelSelf uChannel${i}\n` +
            (xr ? "#define kinoBackground regionBg\n" : "") +
            `#define mainImage regionSubject${i}\n` +
            b +
            "\n#undef mainImage\n" +
            (xr ? "#undef kinoBackground\n" : "") +
            "#undef uChannelSelf\n#undef uMaskSelf\n"
          : "",
      )
      .join("") +
    (needShared
      ? "// ---- shared subject region body (masks without their own) ----\n" +
        (xr ? "#define kinoBackground regionBg\n" : "") +
        "#define mainImage regionSubjectShared\n" +
        subj +
        "\n#undef mainImage\n" +
        (xr ? "#undef kinoBackground\n" : "")
      : "") +
    // ... rest of the function UNCHANGED
```

Leave every remaining line of `perObjectTail` exactly as it is.

**Note on the shared-fallback comment block:** the existing comment above the `uMaskSelf` defines
explains why they are absent from the shared and background bodies. Extend it with one sentence:

```ts
            // uMaskSelf/uChannelSelf are scoped to THIS body, so a .frag can rim its own subject
            // (kinoMaskDist(uMaskSelf, uChannelSelf, ...)) without hardcoding an array index.
            // Deliberately absent from the shared and background bodies — those span several masks
            // / the whole frame, so there is no single "self" and using it there is a loud compile
            // error instead of a silently wrong edge. kinoBackground is scoped differently: EVERY
            // subject-side body gets it (there is exactly one background), only the background body
            // does not.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/segment-regionshader-src.test.ts`
Expected: PASS, all tests in the file including the pre-existing byte-identity assertions.

- [ ] **Step 5: Run the whole suite and build**

Run: `npx vitest run && npm run build`
Expected: both green. The build matters — kino runs from `dist/`, and the render test in Task 2
drives the real renderer.

- [ ] **Step 6: Commit**

```bash
git add src/render/shaderSource.ts tests/segment-regionshader-src.test.ts
git commit -m "feat(regionShader): kinoBackground — subject bodies can sample the shaded background

The background body is a pure function of fragCoord, so calling it at an offset IS
the offset sample. No FBO. Emitted only when a subject body names it, so specs that
do not use it get byte-identical GLSL."
```

---

### Task 2: Render-level proof that the offset lands on the background body

**Files:**
- Create: `tests/render-region-crosssample.test.ts`

**Interfaces:**
- Consumes: `kinoBackground(out vec4, in vec2)` inside a subject body, from Task 1.
- Produces: nothing later tasks rely on.

The load-bearing test. A string assertion cannot tell a background sample from a subject sample, nor
an offset one from a same-pixel one. This renders real pixels and reads exact numbers off them.

- [ ] **Step 1: Write the failing test**

Create `tests/render-region-crosssample.test.ts`:

```ts
// Cross-region sampling through a REAL render. The background body is a MONOTONE VERTICAL RAMP
// (value == y / H), so its output at a pixel is an exact invertible function of y — which makes an
// offset sample numerically separable from a same-pixel one instead of a thing you judge by eye.
//
// One frame, one mask. The subject body splits on x: the left half samples the background at
// offset 0, the right half at +D pixels in y. Three crops at the SAME y then pin all three claims:
// that kinoBackground is the background body, that the offset lands, and that it lands with the
// right magnitude and sign.
import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

// film: 0 kills the vignette+grain finishing pass, disclosure "" the corner text — both paint over
// the probe crops and would skew a flat-colour mean.
const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0 };
const bg = {
  kind: "custom" as const, image: null,
  customCode: "ctx.fillStyle='#000';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);",
  shaderCode: null,
  params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 },
  keyframes: [], triggers: [],
};

const W = 1080, H = 1920;
const D = 192; // offset in px. D / H = 0.1 exactly — a round number to assert against.

// The ramp. Deliberately NOT a function of uTex0: if the subject read the plate instead of the
// background body, it would not track this at all.
const BG = "void mainImage(out vec4 c, in vec2 f){ c = vec4(vec3(f.y / iResolution.y), 1.0); }";

// Left half: offset 0. Right half: +D in y. Both through kinoBackground, so the ONLY difference
// between the two crops is the coordinate handed to it.
const SUBJ = `
void mainImage(out vec4 c, in vec2 f){
  float dy = f.x < iResolution.x * 0.5 ? 0.0 : ${D}.0;
  kinoBackground(c, f + vec2(0.0, dy));
}`;

const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "",
  segments: [{
    kind: "video", source: "asset.png", caption: "", startSec: 0, endSec: 2,
    regionShader: {
      masks: [{ maskSrc: "mask0.png", maskKind: "image" as const, channel: "gray" as const, subjectCode: null }],
      subjectCode: SUBJ, backgroundCode: BG, params: {}, keyframes: [],
    },
  }],
};

const cropRgb = (p: string, w: number, h: number, x: number, y: number): number[] =>
  magick([p, "-crop", `${w}x${h}+${x}+${y}`, "+repage", "-format", "%[fx:mean.r] %[fx:mean.g] %[fx:mean.b]", "info:"])
    .trim().split(/\s+/).map(Number);
const meanDiff = (a: string, b: string) =>
  parseFloat(magick([a, b, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim());

describe("cross-region sampling", () => {
  it("samples the shaded background body at an offset", async () => {
    const publicDir = mkdtempSync(join(tmpdir(), "kino-xregion-"));
    // Mask: a wide band spanning both halves of the frame, so one crop lands in the offset-0 half
    // and one in the offset-D half at the SAME y.
    magick(["-size", `${W}x${H}`, "xc:black", "-fill", "white",
            "-draw", `rectangle 80,${700} ${W - 80},${1200}`, join(publicDir, "mask0.png")]);
    magick(["-size", `${W}x${H}`, "xc:#333333", join(publicDir, "asset.png")]);

    const out = await renderStills({
      props, publicDir, format: "9:16",
      frames: [{ frame: 15, name: "x" }, { frame: 15, name: "xb" }],
      outDir: mkdtempSync(join(tmpdir(), "kino-xregion-out-")),
    });

    // All three crops share the SAME y band (860..1060), 100px+ clear of every mask edge so none
    // straddles the antialiased seam. Their centre y is 960, so the ramp reads 960/1920 = 0.5.
    const Y = 860, CH = 200;
    const left = cropRgb(out[0], 300, CH, 100, Y);       // inside mask, offset 0
    const right = cropRgb(out[0], 300, CH, 680, Y);      // inside mask, offset +D
    const outside = cropRgb(out[0], 300, CH, 380, 200);  // outside the mask entirely
    const outsideAtY = 960 / H;                          // what the ramp reads at the crop centre
    console.log(`xregion left=${left} right=${right} outside(y=300)=${outside} expect ${outsideAtY}`);

    // 1. kinoBackground IS the background body. At offset 0 the subject must read exactly what the
    //    background renders at that pixel. A ramp at crop centre y=960 reads 0.5.
    expect(Math.abs(left[0] - outsideAtY)).toBeLessThan(0.01);

    // 2. THE ASSERTION THIS PHASE EXISTS FOR. Offsetting the lookup by +D px in y must move the
    //    sampled ramp by exactly D/H = 0.1, with that sign.
    expect(right[0] - left[0]).toBeGreaterThan(0.09);
    expect(right[0] - left[0]).toBeLessThan(0.11);

    // 3. Self-contained bite for #2: both crops come from the same call, differing ONLY in the
    //    coordinate. An implementation that dropped the offset collapses them onto each other.
    expect(Math.abs(right[0] - left[0])).toBeGreaterThan(0.05);

    // Grey, not tinted — the ramp writes all three channels, so a colour shift means something
    // other than the background body produced these pixels.
    expect(Math.abs(left[0] - left[2])).toBeLessThan(0.01);

    // Rules out the night fill (b would be 0.13 with r near 0) — i.e. proves it actually compiled.
    expect(left[0]).toBeGreaterThan(0.2);

    // Determinism: two seeks to the same frame index are byte-identical.
    expect(meanDiff(out[0], out[1])).toBe(0);
  }, 240000);
});
```

- [ ] **Step 2: Run it to verify it passes against Task 1's implementation**

Run: `npx vitest run tests/render-region-crosssample.test.ts`
Expected: PASS. Record the logged `xregion left=… right=…` line — `left` ≈ 0.5, `right` ≈ 0.6.

- [ ] **Step 3: Prove assertion 1 bites — misdirect the alias**

Temporarily edit `src/render/shaderSource.ts` and point the alias at the subject body, a plausible
typo:

```ts
const BG_FORWARD_DECL = "void regionSubject(out vec4 fragColor, in vec2 fragCoord);\n";
```
and in `unionTail` emit `"#define kinoBackground regionSubject\n"` instead of `regionBg`.

Run: `npm run build && npx vitest run tests/render-region-crosssample.test.ts`
Expected: FAIL (GLSL recursion — the subject body would call itself — or a wrong crop value).
**Record the exact failure and the numbers in the report**, then revert with
`git checkout src/render/shaderSource.ts`.

- [ ] **Step 4: Prove the forward declaration is load-bearing — remove it**

Temporarily edit `src/render/shaderSource.ts` so `unionTail` emits the `#define` but **not**
`BG_FORWARD_DECL`.

Run: `npm run build && npx vitest run tests/render-region-crosssample.test.ts`
Expected: FAIL with `'regionBg' : no matching overloaded function found` from the fatal path, quoted
against line-numbered assembled source. **Record it**, then revert with
`git checkout src/render/shaderSource.ts`.

- [ ] **Step 5: Prove assertion 2 bites — drop the offset**

Temporarily edit the **test's** `SUBJ` so both halves use `dy = 0.0`.

Run: `npx vitest run tests/render-region-crosssample.test.ts`
Expected: FAIL on `expect(right[0] - left[0]).toBeGreaterThan(0.09)` — the difference collapses to
~0. **Record the numbers**, then restore `SUBJ`.

- [ ] **Step 6: Re-run clean and commit**

Run: `npm run build && npx vitest run tests/render-region-crosssample.test.ts`
Expected: PASS.

```bash
git add tests/render-region-crosssample.test.ts
git commit -m "test(regionShader): render-level proof that kinoBackground samples the background at an offset

Monotone ramp background makes the offset numerically separable: subject-left (offset 0)
matches the background exactly, subject-right (offset +192px) reads exactly +0.1."
```

---

### Task 3: Worked example — glass over a background treatment

**Files:**
- Create: `examples/segmentation/region-glass.frag`
- Create: `examples/segmentation/region-tint.frag`
- Create: `examples/segmentation/cross-region-glass.json`

**Interfaces:**
- Consumes: `kinoBackground` from Task 1.
- Produces: an example spec an author can copy. Nothing depends on it in code.

This is the deliverable that makes the phase usable. The design spec's whole argument is that
`uTex0` refraction is already right when the background is a passthrough and wrong when it is a
treatment — so the example must have a treatment background, or it demonstrates nothing new.

- [ ] **Step 1: Write the background treatment**

Create `examples/segmentation/region-tint.frag`:

```glsl
// Background region: a real TREATMENT, not a passthrough — crushed luma pushed to cold blue. This
// is the case kinoBackground exists for. Refracting uTex0 here would show the ORIGINAL saturated
// plate through the glass, a hole punched to a different image; refracting THIS matches.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec3 src = texture(uTex0, fragCoord / iResolution.xy).rgb;
  float l = dot(src, vec3(0.2126, 0.7152, 0.0722));
  fragColor = vec4(vec3(l) * vec3(0.35, 0.55, 0.90), 1.0);
}
```

- [ ] **Step 2: Write the glass subject**

Create `examples/segmentation/region-glass.frag`:

```glsl
// Tracked liquid glass: bend the lookup along the mask's own surface normal, then sample the SHADED
// BACKGROUND at the bent coordinate. kinoBackground(c, fragCoord + offset) re-evaluates the
// background body at that point — an exact, full-resolution sample with no framebuffer.
//
// Both kinoMaskDist and kinoBackground are called from UNIFORM control flow. Neither may sit inside
// an `if` that differs across a fragment quad: both use screen-space derivatives, which are
// undefined there and fail silently.
//
// Params: u_bend (px of displacement at the rim), u_radius (bevel depth in px).
vec2 glassBend(vec2 f, float r) {
  float d = kinoMaskDist(uMask0, uChannel0, f, r);
  float t = clamp(1.0 + d / r, 0.0, 1.0);   // 0 deep inside, 1 at the silhouette
  float e = 4.0;
  // Surface normal from central differences of the distance field.
  vec2 n = vec2(
    kinoMaskDist(uMask0, uChannel0, f + vec2(e, 0.0), r) - kinoMaskDist(uMask0, uChannel0, f - vec2(e, 0.0), r),
    kinoMaskDist(uMask0, uChannel0, f + vec2(0.0, e), r) - kinoMaskDist(uMask0, uChannel0, f - vec2(0.0, e), r));
  return normalize(n + vec2(1e-5, 1e-5)) * t * t;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  float r = max(u_radius, 1.0);
  vec2 bent = glassBend(fragCoord, r);
  vec4 refracted;
  kinoBackground(refracted, fragCoord + bent * u_bend);
  float rim = pow(length(bent), 6.0) * 0.35;
  fragColor = vec4(refracted.rgb * 1.06 + rim, 1.0);
}
```

- [ ] **Step 3: Write the spec**

Create `examples/segmentation/cross-region-glass.json`:

```json
{
  "title": "cross-region-glass",
  "format": ["9:16"],
  "provider": "none",
  "segments": [
    {
      "kind": "video",
      "source": "segdemo/subject.png",
      "text": "glass that refracts its own background",
      "dur": 2,
      "regionShader": {
        "mask": "masks/segdemo-mask",
        "object": 0,
        "subject": "backgrounds/region-glass.frag",
        "background": "backgrounds/region-tint.frag",
        "params": { "bend": 55, "radius": 70 },
        "keyframes": [
          { "at": 0, "params": { "bend": 0 } },
          { "at": 1.2, "params": { "bend": 55 }, "ease": "easeInOut" }
        ]
      }
    }
  ]
}
```

Note `bend` and `radius` are the only two numeric params, well under `EXTRA_PARAM_SLOTS = 4`, and
they alias to `u_bend` / `u_radius` alphabetically — `bend` → `uParam0`, `radius` → `uParam1`.

- [ ] **Step 4: Verify the example spec parses**

Run: `npx vitest run tests/segment-regionshader-schema.test.ts`
Expected: PASS. If the repo has a schema test that walks `examples/`, it must accept the new file.

- [ ] **Step 5: Commit**

```bash
git add examples/segmentation/region-glass.frag examples/segmentation/region-tint.frag examples/segmentation/cross-region-glass.json
git commit -m "docs(segment): worked cross-region glass example — subject refracts a treated background"
```

---

### Task 4: Document the helper

**Files:**
- Modify: `docs/segmentation.md` (the "Inside a region shader you can sample:" list, ~line 208, and a new subsection after "Params and keyframes")

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Extend the sampling list**

`docs/segmentation.md` currently reads:

```markdown
Inside a region shader you can sample:
- `uTex0` — the beat's own asset (the thing being segmented).
- the shader's own params/uniforms (`u_*` aliases, `iTime`, etc.) as any shader — see
  [Params and keyframes](#params-and-keyframes) below.
```

Add a third bullet:

```markdown
- **from a subject body only** — `kinoBackground(out vec4, in vec2 fragCoord)`, the *shaded*
  background region, at any coordinate. See [Cross-region sampling](#cross-region-sampling).
```

- [ ] **Step 2: Add the subsection**

Append after the "Params and keyframes" subsection:

````markdown
#### Cross-region sampling

`texture(uTex0, uv + bend)` already refracts the beat's **plate**, and when `background` is absent
or a passthrough that is exactly right — the plate *is* what is visibly behind the subject. It is
wrong the moment the background is a **treatment**: refracting `uTex0` under a desaturating
background shows the original saturated footage through the glass, a hole punched to a different
image.

For that case a subject body can call the background body directly, at any coordinate:

```glsl
vec4 b;  kinoBackground(b, fragCoord);            // the shaded background AT THIS PIXEL
vec4 r;  kinoBackground(r, fragCoord + bend);     // refraction / displacement
```

There is no framebuffer involved. The background body is a pure function of `fragCoord`, so
evaluating it at an offset **is** the offset sample — exact, full-resolution, deterministic.

- **Available in every subject body**: the top-level `subject`, each `masks[].subject`, and the
  shared fallback. There is exactly one background, so it means the same thing in all of them.
- **Not available in the background body.** That would be recursion (illegal in GLSL) and has no
  meaning; using it there is a loud compile error naming an undeclared function.
- **A subject cannot sample another subject.** Under painter's order a subject body's output is
  discarded outside its own mask, so "what does that subject look like here" has no answer exactly
  where you would want to ask. Not offered.
- **Call it from uniform control flow.** The background body may use `aastep` or `kinoMaskDist`,
  which read screen-space derivatives — undefined inside a branch that differs across a fragment
  quad, and silently wrong rather than loud. Call it unconditionally and `mix` afterwards.
- **Derivatives inside it see your offset coordinate.** `fwidth` in the background body measures how
  fast `fragCoord + offset` changes across the quad. For a smooth displacement that is correct; for
  one that jumps between neighbouring pixels, `aastep` inside the background goes soft in that band.
  Keep the displacement continuous.

**Cost.** One call = one extra evaluation of the background body. Measured on an Apple M4,
1080×1920, 12 stills, SwiftShader, over a subject whose bevel already costs three `kinoMaskDist`
calls:

| | light background body | 10× heavier body |
| --- | --- | --- |
| no call (refract `uTex0`) | 0.642 s/frame | 0.839 s/frame |
| 1 `kinoBackground` call | 0.661 s/frame (+0.019) | 0.951 s/frame (+0.112) |
| 8 calls (frosted blur) | 0.728 s/frame (+0.086) | 1.305 s/frame (+0.466) |

One call is ~5% of what the bevel's distance-field lookups already cost, so a single refraction tap
is effectively free. Cost is `taps × background-body weight` and nothing else — a wide kernel over
an expensive background is the one shape that gets dear, and that is the case a real two-pass
framebuffer would fix if it is ever needed.

Nothing changes for specs that do not use it: kino emits the declaration only when a subject body
names `kinoBackground`, so every other region program is byte-for-byte what it was.

**Worked example:** `examples/segmentation/cross-region-glass.json` with
`region-glass.frag` (subject) and `region-tint.frag` (background treatment).
````

- [ ] **Step 3: Commit**

```bash
git add docs/segmentation.md
git commit -m "docs(segment): kinoBackground reference — cross-region sampling, hazards, measured cost"
```

---

### Task 5: Full verification and report

**Files:**
- Create: `docs/superpowers/specs/2026-07-25-cross-region-REPORT.md`

- [ ] **Step 1: Delete every throwaway probe**

```bash
rm -f tests/tmp-probe.test.ts tests/tmp-probe2.test.ts tests/tmp-cost.test.ts
```

- [ ] **Step 2: Full suite and build**

Run: `npx vitest run && npm run build`
Expected: both green, no skipped region tests.

- [ ] **Step 3: Write the report**

`docs/superpowers/specs/2026-07-25-cross-region-REPORT.md` covering: what already worked (the
`uTex0` probe, with the image described), what was genuinely missing (the treatment case), what
shipped and what was deliberately not (FBO, subject-samples-subject, the file-scope pixel-local
`vec4`), the measured cost table, the test and its recorded bite numbers from Task 2 steps 3–5, and
anything found wrong in existing code.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-25-cross-region-REPORT.md
git commit -m "docs(segment): phase 4 report — cross-region sampling"
```

---

## Self-Review

**Spec coverage.** Surface (`kinoBackground` alias + forward declaration) → Task 1. Scoping to
subject bodies only, and the loud error in the background body → Task 1 tests 3 and 4. Gate on use /
byte-identical for non-users → Task 1 tests 1 and 6. Per-object tail → Task 1 test 5. "What the
background means with N subjects" and subject-samples-subject → documented in Task 4, enforced by
there being no code for it. Render-level proof + bite → Task 2. Cost table → measured pre-plan,
recorded in Task 4 docs and Task 5 report. Authoring hazards → Task 4. Worked example → Task 3.

**Placeholders.** None: every step carries its literal code or its literal command.

**Type consistency.** `BG_FORWARD_DECL` and `usesBackground` are named identically in Task 1's
implementation and in Task 2's bite steps. `assembleRegionShaderSource`'s signature is unchanged
throughout, so no caller in `RegionShader.tsx` or the existing tests moves.
