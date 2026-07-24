# Per-object regions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each entry in `regionShader.masks[]` carry its own shader body, so several tracked
objects get different treatments in one beat, instead of all collapsing into one subject region.

**Architecture:** One optional `subject` per `masks[]` entry, threaded schema → `build.ts` →
`RegionShaderProps.masks[].subjectCode` → a new fourth argument to `assembleRegionShaderSource`.
When no entry carries a body the assembler returns its existing union source byte-for-byte; when
any does, it emits one GLSL function per distinct body and composites them onto the background in
array order (painter's order).

**Tech Stack:** TypeScript, zod (spec schema), GLSL ES 3.00, vitest, puppeteer/`renderStills`,
ImageMagick via `tests/magick.ts`.

## Global Constraints

- GLSL ES 3.00. Loop bounds must be compile-time constants.
- Determinism: same frame index → identical pixels. No wall clock, no unseeded randomness.
- `MAX_REGION_MASKS = 4` stays 4.
- `kinoMaskDist(sampler2D, vec4, vec2, float)` signature is frozen.
- Never guard a `kinoMaskDist` call behind non-uniform control flow.
- A spec that uses no per-entry `subject` must generate exactly the shader it generates today.
- `examples/segmentation/region-smoke.json` and every existing test pass unchanged.
- Design spec: `docs/superpowers/specs/2026-07-24-per-object-regions-design.md`.

---

### Task 1: Assembler — per-mask bodies, painter's order, `uMaskSelf`

**Files:**
- Modify: `src/render/shaderSource.ts` (`assembleRegionShaderSource`, ~line 176)
- Test: `tests/segment-regionshader-src.test.ts`

**Interfaces:**
- Produces: `assembleRegionShaderSource(subjectBody: string | null, backgroundBody: string | null,
  extraNames?: string[], maskBodies?: (string | null)[]): string`.
  `maskBodies` is index-aligned with `RegionShaderProps.masks`; a null/absent entry means that
  mask uses `subjectBody`. All-null (or empty) ⇒ the existing union source, unchanged.

- [ ] **Step 1: Write the failing tests** — append to `tests/segment-regionshader-src.test.ts`:

```ts
const A = "void mainImage(out vec4 c, in vec2 f){ c = vec4(1.0, 0.0, 0.0, 1.0); }";
const B2 = "void mainImage(out vec4 c, in vec2 f){ c = vec4(0.0, 1.0, 0.0, 1.0); }";

describe("assembleRegionShaderSource per-object regions", () => {
  it("emits the union source unchanged when no mask carries its own body", () => {
    expect(assembleRegionShaderSource(SUBJ, BG, [], [])).toBe(assembleRegionShaderSource(SUBJ, BG, []));
    expect(assembleRegionShaderSource(SUBJ, BG, [], [null, null])).toBe(assembleRegionShaderSource(SUBJ, BG, []));
    expect(assembleRegionShaderSource(SUBJ, BG, [])).toContain("m = max(m, dot(texture(uMask0, muv), uChannel0));");
  });

  it("gives each mask its own function and composites in array order", () => {
    const src = assembleRegionShaderSource(null, BG, [], [A, B2]);
    expect(src).toContain("#define mainImage regionSubject0");
    expect(src).toContain("#define mainImage regionSubject1");
    expect(src).toContain(A);
    expect(src).toContain(B2);
    // painter's order: mask 0 composited before mask 1, so 1 paints over 0
    const i0 = src.indexOf("c = mix(c, s0, smoothstep(0.4, 0.6, dot(texture(uMask0, muv), uChannel0)));");
    const i1 = src.indexOf("c = mix(c, s1, smoothstep(0.4, 0.6, dot(texture(uMask1, muv), uChannel1)));");
    expect(i0).toBeGreaterThan(-1);
    expect(i1).toBeGreaterThan(i0);
    expect(src).not.toContain("m = max(m,"); // the union reduce is gone on this path
    expect((src.match(/void main\(\)/g) ?? []).length).toBe(1);
  });

  it("defines uMaskSelf/uChannelSelf inside a per-entry body only", () => {
    const src = assembleRegionShaderSource(null, BG, [], [A, B2]);
    expect(src).toContain("#define uMaskSelf uMask0");
    expect(src).toContain("#define uChannelSelf uChannel0");
    expect(src).toContain("#define uMaskSelf uMask1");
    expect(src).toContain("#define uChannelSelf uChannel1");
    expect((src.match(/#undef uMaskSelf/g) ?? []).length).toBe(2); // scoped, never leaks
  });

  it("emits the shared fallback body once, and only when some mask needs it", () => {
    const both = assembleRegionShaderSource(SUBJ, BG, [], [A, B2]);
    expect(both).not.toContain(SUBJ); // nothing falls back → don't pay for it
    expect(both).not.toContain("regionSubjectShared");

    const mixed = assembleRegionShaderSource(SUBJ, BG, [], [A, null, null]);
    expect(mixed).toContain("#define mainImage regionSubjectShared");
    expect((mixed.match(/regionSubjectShared\(/g) ?? []).length).toBe(1); // called once, used twice
    expect(mixed).toContain("c = mix(c, sShared, smoothstep(0.4, 0.6, dot(texture(uMask1, muv), uChannel1)));");
    expect(mixed).toContain("c = mix(c, sShared, smoothstep(0.4, 0.6, dot(texture(uMask2, muv), uChannel2)));");
  });

  it("ignores mask slots beyond MAX_REGION_MASKS", () => {
    const src = assembleRegionShaderSource(null, BG, [], [A, A, A, A, A]);
    expect(src).not.toContain("uMask4");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/segment-regionshader-src.test.ts`
Expected: the four new tests FAIL (the 4th argument is ignored today).

- [ ] **Step 3: Implement**

In `src/render/shaderSource.ts`, split the shared prelude out and add the per-object tail.
Replace `assembleRegionShaderSource` with:

```ts
/** Assemble ONE GLSL ES 3.00 fragment shader that splits the frame by the segmentation mask(s).
 *
 *  Default (no `maskBodies`): every mask unions into one subject region — `subjectBody` shades
 *  where any mask channel > 0.5, `backgroundBody` elsewhere.
 *
 *  Per-object (any entry of `maskBodies` non-null): each mask gets its own body, falling back to
 *  `subjectBody` where its entry is null, composited onto the background in ARRAY ORDER — later
 *  entries paint over earlier ones where masks overlap. A per-entry body also gets
 *  `uMaskSelf`/`uChannelSelf` aliases for its own mask, so `kinoMaskDist` can rim ITS subject
 *  without the .frag hardcoding an array index.
 *
 *  A null side is a passthrough of the beat asset (uTex0). Each body's `mainImage` is
 *  #define-namespaced so they never collide. */
export function assembleRegionShaderSource(
  subjectBody: string | null,
  backgroundBody: string | null,
  extraNames: string[] = [],
  maskBodies: (string | null)[] = [],
): string {
  const aliases = paramAliases(extraNames);
  const subj = subjectBody ?? REGION_PASSTHROUGH;
  const bg = backgroundBody ?? REGION_PASSTHROUGH;
  const head =
    "#version 300 es\n" +
    "precision highp float;\n\n" +
    REGION_HEADER +
    (aliases ? "\n" + aliases : "") +
    "\n" +
    GLSL_HELPERS +
    "\nout vec4 kino_fragColor;\n\n";
  // A slot past MAX_REGION_MASKS has no uMaskN uniform to reference — drop it rather than emit
  // GLSL that cannot compile (the schema caps masks[] at 4; this is belt-and-braces).
  const per = maskBodies.slice(0, MAX_REGION_MASKS);
  return head + (per.some(Boolean) ? perObjectTail(per, subj, bg) : unionTail(subj, bg));
}
```

Move today's body into `unionTail` verbatim (this is what keeps the default byte-identical):

```ts
// Every mask unions into ONE subject region. This is the shape kino shipped before per-object
// regions and is emitted byte-for-byte unchanged whenever no mask carries its own body — a spec
// that does not use the feature must not pay for it, or change output at all.
function unionTail(subj: string, bg: string): string {
  return (
    // Preprocessor-namespace each body's mainImage → two collision-free functions. Bodies are the
    // normal shader convention, reused unchanged.
    "// ---- subject region body ----\n" +
    "#define mainImage regionSubject\n" +
    subj +
    "\n#undef mainImage\n" +
    "// ---- background region body ----\n" +
    "#define mainImage regionBg\n" +
    bg +
    "\n#undef mainImage\n" +
    "// ---- kino region entry ----\n" +
    // ponytail: both bodies run for EVERY pixel then mix — 2× fragment cost. Upgrade to a
    // discard/stencil split (shade only the region each pixel belongs to) if the cost matters.
    "void main() {\n" +
    "  vec4 s, b;\n" +
    "  regionSubject(s, gl_FragCoord.xy);\n" +
    "  regionBg(b, gl_FragCoord.xy);\n" +
    "  vec2 muv = gl_FragCoord.xy / iResolution.xy;\n" +
    "  float m = 0.0;\n" +
    Array.from(
      { length: MAX_REGION_MASKS },
      (_, i) => `  m = max(m, dot(texture(uMask${i}, muv), uChannel${i}));\n`,
    ).join("") +
    // Tight smoothstep for a clean ~1px AA edge (the bulk of the fringe fix is upstream —
    // sam_runner.py erodes the mask before its 1008→native upscale, see _erode1008).
    "  m = smoothstep(0.4, 0.6, m);\n" +
    "  kino_fragColor = mix(b, s, m);\n" +
    "}\n"
  );
}
```

And add the new tail:

```ts
// One body per mask, composited onto the background in ARRAY ORDER — masks[1] paints over
// masks[0] where they overlap (painter's order; see the design spec). Only the slots this beat
// actually binds are emitted: an unbound uChannelN is the zero vector, so a line for it would be
// a guaranteed no-op mix at full fragment cost.
//
// ponytail: N distinct bodies run for EVERY pixel, so 4 per-object masks is 5× the fragment work
// of a plain background on the default SwiftShader renderer. The shared fallback is emitted and
// called ONCE however many masks share it, and not at all when none do. Upgrade path is the same
// discard/stencil split the union tail wants.
function perObjectTail(per: (string | null)[], subj: string, bg: string): string {
  const needShared = per.some((b) => !b);
  // The var holding each mask's shaded colour: its own function's output, or the shared one's.
  const varOf = (b: string | null, i: number) => (b ? `s${i}` : "sShared");
  return (
    per
      .map((b, i) =>
        b
          ? // uMaskSelf/uChannelSelf are scoped to THIS body: a .frag can rim its own subject
            // (kinoMaskDist(uMaskSelf, uChannelSelf, ...)) without hardcoding an array index.
            // Deliberately absent from the shared and background bodies — they span several
            // masks / the whole frame, so there is no single "self" and using it is a loud
            // compile error rather than a silently wrong edge.
            `// ---- subject region body for mask ${i} ----\n` +
            `#define uMaskSelf uMask${i}\n` +
            `#define uChannelSelf uChannel${i}\n` +
            `#define mainImage regionSubject${i}\n` +
            b +
            "\n#undef mainImage\n#undef uChannelSelf\n#undef uMaskSelf\n"
          : "",
      )
      .join("") +
    (needShared
      ? "// ---- shared subject region body (masks without their own) ----\n" +
        "#define mainImage regionSubjectShared\n" +
        subj +
        "\n#undef mainImage\n"
      : "") +
    "// ---- background region body ----\n" +
    "#define mainImage regionBg\n" +
    bg +
    "\n#undef mainImage\n" +
    "// ---- kino region entry ----\n" +
    "void main() {\n" +
    "  vec2 muv = gl_FragCoord.xy / iResolution.xy;\n" +
    "  vec4 c;\n" +
    "  regionBg(c, gl_FragCoord.xy);\n" +
    per.map((b, i) => (b ? `  vec4 s${i};\n  regionSubject${i}(s${i}, gl_FragCoord.xy);\n` : "")).join("") +
    (needShared ? "  vec4 sShared;\n  regionSubjectShared(sShared, gl_FragCoord.xy);\n" : "") +
    per
      .map(
        (b, i) =>
          `  c = mix(c, ${varOf(b, i)}, smoothstep(0.4, 0.6, dot(texture(uMask${i}, muv), uChannel${i})));\n`,
      )
      .join("") +
    "  kino_fragColor = c;\n" +
    "}\n"
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/segment-regionshader-src.test.ts`
Expected: PASS, including the four pre-existing cases.

- [ ] **Step 5: Prove the byte-identity assertion bites**

Temporarily change one character in `unionTail` (e.g. `0.4, 0.6` → `0.4, 0.61`), re-run, confirm
the "emits the union source unchanged" test still passes (it compares the function to itself) —
then instead temporarily change `perObjectTail`'s composite line ordering and confirm the
array-order test fails. Revert both.

- [ ] **Step 6: Commit**

```bash
git add src/render/shaderSource.ts tests/segment-regionshader-src.test.ts
git commit -m "feat(regionShader): per-mask subject bodies in the assembler, painter's order"
```

---

### Task 2: Schema + build resolution + runtime wiring

**Files:**
- Modify: `src/spec/schema.ts:132-156` (`regionShader`)
- Modify: `src/render/props.ts:41-50` (`RegionShaderMask`)
- Modify: `src/commands/build.ts:46-79` (`resolveRegionShader`)
- Modify: `src/render/native/page/RegionShader.tsx:176` and the `glKey` at :298
- Test: `tests/segment-regionshader-schema.test.ts`

**Interfaces:**
- Consumes: `assembleRegionShaderSource(subject, background, extraNames, maskBodies)` from Task 1.
- Produces: `RegionShaderMask.subjectCode?: string | null` — the per-entry GLSL body, already read
  off disk by `build.ts`. `undefined`/`null` means "use `RegionShaderProps.subjectCode`".

- [ ] **Step 1: Write the failing schema tests** — append to `tests/segment-regionshader-schema.test.ts`:

```ts
it("parses a per-entry subject on a masks[] entry", () => {
  const s = SpecSchema.parse({
    ...valid,
    segments: [{
      ...valid.segments[0],
      regionShader: {
        masks: [
          { mask: "masks/dog", subject: "a.frag" },
          { mask: "masks/ball", object: 1, subject: "b.frag" },
          { mask: "masks/hand" },
        ],
        subject: "fallback.frag",
        background: "bg.frag",
      },
    }],
  });
  const seg = s.segments[0];
  expect(seg.kind === "app" && seg.regionShader?.masks?.[0].subject).toBe("a.frag");
  expect(seg.kind === "app" && seg.regionShader?.masks?.[1].object).toBe(1);
  expect(seg.kind === "app" && seg.regionShader?.masks?.[2].subject).toBe(undefined);
});

it("accepts per-entry subjects as the only shader bodies (no top-level subject/background)", () => {
  const s = SpecSchema.parse({
    ...valid,
    segments: [{
      ...valid.segments[0],
      regionShader: { masks: [{ mask: "masks/dog", subject: "a.frag" }] },
    }],
  });
  expect(s.segments[0].kind === "app").toBe(true);
});

it("still rejects a regionShader with no shader body anywhere", () => {
  expect(() =>
    SpecSchema.parse({
      ...valid,
      segments: [{ ...valid.segments[0], regionShader: { masks: [{ mask: "masks/dog" }] } }],
    }),
  ).toThrow();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/segment-regionshader-schema.test.ts`
Expected: the first two FAIL — `subject` is not in the entry object (`.strict()` on the segment
does not apply here, but the parsed value comes back `undefined`), and the
`v.subject || v.background` refine rejects the second.

- [ ] **Step 3: Schema** — in `src/spec/schema.ts`, replace the `masks` array element and the
first refine, and update the leading comment:

```ts
    // Per-mask-region shaders: the segmentation mask(s) split this beat's frame — each mask's
    // region (its channel >0.5) runs a .frag body, the background region (no mask selected)
    // another. `mask`+`object` is the single-mask shorthand; `masks` (up to 4 entries) is the
    // general form. An entry's own `subject` shades JUST that mask (per-object regions); entries
    // without one fall back to the top-level `subject`, so several masks can still share one
    // treatment. Where two masks overlap, the LATER entry paints over the earlier one.
    // Exactly one of mask/masks required, and at least one shader body somewhere.
    regionShader: z
      .object({
        mask: z.string().min(1).optional(), // mask asset dir, e.g. "masks/clip"
        object: z.number().int().min(0).max(3).default(0), // manifest object → channel, for `mask`
        masks: z
          .array(
            z.object({
              mask: z.string().min(1),
              object: z.number().int().min(0).max(3).default(0),
              subject: z.string().min(1).optional(), // .frag/.glsl body for THIS mask only
            }),
          )
          .min(1)
          .max(4)
          .optional(),
        subject: z.string().min(1).optional(), // .frag/.glsl body; masks without their own
        background: z.string().min(1).optional(), // .frag/.glsl body; region where none are
      })
      .refine((v) => v.mask || v.masks, { message: "regionShader needs mask or masks" })
      .refine((v) => v.subject || v.background || v.masks?.some((m) => m.subject), {
        message: "regionShader needs at least one of subject/background (top-level or per-mask)",
      })
      .optional(),
```

- [ ] **Step 4: Run the schema tests**

Run: `npx vitest run tests/segment-regionshader-schema.test.ts`
Expected: PASS (all seven).

- [ ] **Step 5: props.ts** — add the field to `RegionShaderMask`:

```ts
export interface RegionShaderMask {
  maskSrc: string; // public-relative mask.png (image) or mask.mp4 (video)
  maskKind: "image" | "video";
  channel: "r" | "g" | "b" | "a" | "gray"; // manifest object's coverage channel
  subjectCode?: string | null; // GLSL body for THIS mask's region; null/absent = the shared subjectCode
}
```

and update the `masks` comment in `RegionShaderProps`:

```ts
export interface RegionShaderProps {
  masks: RegionShaderMask[]; // 1..4 entries; each shades its own region (later entries paint over earlier), falling back to subjectCode
  subjectCode: string | null; // GLSL mainImage body for masks without their own, or null = passthrough asset pixels
  backgroundCode: string | null; // GLSL mainImage body elsewhere, or null = passthrough
}
```

- [ ] **Step 6: build.ts** — in `resolveRegionShader`, hoist `loadBody` above the map and read the
per-entry body. Replace the signature + body:

```ts
function resolveRegionShader(
  rs: {
    mask?: string;
    masks?: { mask: string; object: number; subject?: string }[];
    subject?: string;
    background?: string;
    object: number;
  },
  project: Project,
  stageAsset: (rel: string) => void,
): RegionShaderProps {
  const loadBody = (ref: string | undefined) => (ref ? readFileSync(resolveBackgroundComponent(ref, project), "utf8") : null);
  const entries = rs.masks ?? [{ mask: rs.mask!, object: rs.object, subject: undefined }];
  const masks = entries.map(({ mask, object, subject }) => {
    const manifest = readManifest(project.assetPath(mask));
    // Image masks carry every object in the single union mask.png (all channel "gray"); per-object
    // image selection isn't wired, so object>0 would silently pick the same union — reject it loudly.
    // Multi-object addressing lives on video masks (distinct R/G/B channels).
    if (manifest.kind === "image" && object > 0) {
      throw new Error(`regionShader object must be 0 for image mask "${mask}" — per-object selection is only supported on video masks.`);
    }
    const obj = manifest.objects[object];
    if (!obj) {
      throw new Error(`regionShader object ${object} out of range for mask "${mask}" (${manifest.objects.length} objects)`);
    }
    const maskRel = `${mask}/${manifest.kind === "video" ? "mask.mp4" : "mask.png"}`;
    stageAsset(maskRel);
    return { maskSrc: maskRel, maskKind: manifest.kind, channel: obj.channel, subjectCode: loadBody(subject) };
  });
  return {
    masks,
    subjectCode: loadBody(rs.subject),
    backgroundCode: loadBody(rs.background),
  };
}
```

Also update the comment above it (line 46-50) to say each entry may carry its own `subject`.

- [ ] **Step 7: RegionShader.tsx** — pass the per-mask bodies to the assembler (line ~176):

```ts
    const fragSrc = assembleRegionShaderSource(
      region.subjectCode,
      region.backgroundCode,
      [],
      region.masks.map((m) => m.subjectCode ?? null),
    );
```

and include them in `glKey` (line ~298) so a spec that differs only in a per-mask body recompiles
(the exact bug `tests/render-region-reuse.test.ts` guards):

```ts
  const glKey = [
    region.subjectCode,
    region.backgroundCode,
    `${assetSrc.frameVideo}|${assetSrc.staticUrl}`,
    ...region.masks.map((m) => m.subjectCode ?? ""),
    ...maskSrcs.map((s) => `${s.frameVideo}|${s.staticUrl}`),
  ].join(" ");
```

- [ ] **Step 8: Typecheck + full-ish run**

Run: `npm run build && npx vitest run tests/segment-regionshader-schema.test.ts tests/segment-regionshader-src.test.ts`
Expected: build clean, tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/spec/schema.ts src/render/props.ts src/commands/build.ts src/render/native/page/RegionShader.tsx tests/segment-regionshader-schema.test.ts
git commit -m "feat(regionShader): masks[].subject — per-entry shader body through build + runtime"
```

---

### Task 3: Render-level proof (pixels, overlap order, `uMaskSelf`)

**Files:**
- Create: `tests/render-region-perobject.test.ts`

**Interfaces:**
- Consumes: `RegionShaderProps` with `masks[].subjectCode` (Task 2), `renderStills` from
  `src/render/render.js`, `magick` from `tests/magick.ts`.

- [ ] **Step 1: Write the test**

```ts
// Per-object regions through a REAL render. String assertions on the assembled source cannot tell
// a composite in array order from one in reverse order, nor a uMaskSelf that resolved to the wrong
// slot — both compile, both read fine as text. So: two OVERLAPPING image masks, a different body
// on each, and four crops that each read a different one of the four regions the two masks carve
// the frame into.
import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

// film: 0 kills the vignette+grain finishing pass, disclosure "" the corner text — both paint over
// the probe and would skew a flat-colour crop mean.
const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0 };
const bg = {
  kind: "custom" as const, image: null,
  customCode: "ctx.fillStyle='#000';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);",
  shaderCode: null,
  params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 },
  keyframes: [], triggers: [],
};

const W = 1080, H = 1920;
// mask0 = x 100..600, mask1 = x 400..900, both y 400..1500 → they overlap on x 400..600.
const M0 = { x0: 100, x1: 600 }, M1 = { x0: 400, x1: 900 }, Y0 = 400, Y1 = 1500;

const RED = "void mainImage(out vec4 c, in vec2 f){ c = vec4(1.0, 0.0, 0.0, 1.0); }";
// Green, with the SELF-distance in blue: 1 deeper than 40px inside THIS mask, 0 elsewhere. If
// uMaskSelf resolved to uMask0 instead of uMask1, the mask1-only crop (100px clear of mask0, so
// d = +48 there) would read blue 0. Called unconditionally — kinoMaskDist reads derivatives.
const GREEN_SELF =
  "void mainImage(out vec4 c, in vec2 f){\n" +
  "  float d = kinoMaskDist(uMaskSelf, uChannelSelf, f, 48.0);\n" +
  "  c = vec4(0.0, 1.0, 1.0 - step(-40.0, d), 1.0);\n}";
const BLUE = "void mainImage(out vec4 c, in vec2 f){ c = vec4(0.0, 0.0, 1.0, 1.0); }";

const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "",
  segments: [{
    kind: "app", asset: "asset.png", caption: "", startSec: 0, endSec: 2,
    regionShader: {
      masks: [
        { maskSrc: "mask0.png", maskKind: "image" as const, channel: "gray" as const, subjectCode: RED },
        { maskSrc: "mask1.png", maskKind: "image" as const, channel: "gray" as const, subjectCode: GREEN_SELF },
      ],
      subjectCode: null,
      backgroundCode: BLUE,
    },
  }],
};

// Mean rgb of one crop (ImageMagick geometry: WxH+X+Y).
const cropRgb = (p: string, w: number, h: number, x: number, y: number): number[] =>
  magick([p, "-crop", `${w}x${h}+${x}+${y}`, "+repage", "-format", "%[fx:mean.r] %[fx:mean.g] %[fx:mean.b]", "info:"])
    .trim().split(/\s+/).map(Number);
const meanDiff = (a: string, b: string) =>
  parseFloat(magick([a, b, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim());

describe("per-object region shaders", () => {
  it("shades each mask with its own body and paints later masks over earlier ones", async () => {
    const publicDir = mkdtempSync(join(tmpdir(), "kino-perobject-"));
    const rect = (x0: number, x1: number, out: string) =>
      magick(["-size", `${W}x${H}`, "xc:black", "-fill", "white",
              "-draw", `rectangle ${x0},${Y0} ${x1},${Y1}`, join(publicDir, out)]);
    rect(M0.x0, M0.x1, "mask0.png");
    rect(M1.x0, M1.x1, "mask1.png");
    magick(["-size", `${W}x${H}`, "xc:#333333", join(publicDir, "asset.png")]);

    const out = await renderStills({
      props, publicDir, format: "9:16",
      frames: [{ frame: 10, name: "probe" }, { frame: 10, name: "probe2" }],
      outDir: mkdtempSync(join(tmpdir(), "kino-perobject-out-")),
    });
    // All crops sit at y 800..1000 — 400px clear of both horizontal mask edges — and are 100px+
    // clear of every vertical boundary, so no crop straddles an antialiased seam.
    const only0 = cropRgb(out[0], 150, 200, 200, 800);
    const overlap = cropRgb(out[0], 100, 200, 450, 800);
    const only1 = cropRgb(out[0], 150, 200, 700, 800);
    const outside = cropRgb(out[0], 100, 200, 950, 800);
    console.log(`per-object crops: only0=${only0} overlap=${overlap} only1=${only1} outside=${outside}`);

    // mask0 alone → its own body (red). Proves entry 0 got ITS body, not the shared/last one.
    expect(only0[0]).toBeGreaterThan(0.9);
    expect(only0[1]).toBeLessThan(0.1);
    expect(only0[2]).toBeLessThan(0.1);

    // mask1 alone → green, and blue=1 from kinoMaskDist(uMaskSelf) reading MASK 1's edge.
    expect(only1[1]).toBeGreaterThan(0.9);
    expect(only1[0]).toBeLessThan(0.1);
    expect(only1[2]).toBeGreaterThan(0.9);

    // THE OVERLAP RULE. Both masks cover this crop; masks[1] is later, so green wins outright.
    // Reverse the composite order and this crop reads red; average them and it reads yellow.
    expect(overlap[1]).toBeGreaterThan(0.9);
    expect(overlap[0]).toBeLessThan(0.1);

    // Neither mask → the background body. Also rules out the night fill (b would be 0.13).
    expect(outside[2]).toBeGreaterThan(0.9);
    expect(outside[0]).toBeLessThan(0.1);
    expect(outside[1]).toBeLessThan(0.1);

    // Two seeks to the same frame index are byte-identical — no wall clock in the composite.
    expect(meanDiff(out[0], out[1])).toBe(0);
  }, 240000);
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/render-region-perobject.test.ts`
Expected: PASS. If it fails, read the logged crop means before touching anything — they say
exactly which region got which body.

- [ ] **Step 3: Prove the assertions bite**

Three temporary breaks, each reverted immediately after:

1. In `perObjectTail`, reverse the composite order (`per.map(...)` → `[...per].reverse().map(...)`
   over indices). Re-run: the overlap crop must read red and the test must FAIL.
2. In `perObjectTail`, emit `#define uMaskSelf uMask0` for every body. Re-run: `only1[2]` must
   read ~0 and the test must FAIL.
3. In `perObjectTail`, give every mask `s0` (the first body). Re-run: `only1` must read red and
   the test must FAIL.

Record the observed numbers — they go in the report.

- [ ] **Step 4: Commit**

```bash
git add tests/render-region-perobject.test.ts
git commit -m "test(regionShader): render-level proof of per-object regions and painter's order"
```

---

### Task 4: Measure the fragment cost

**Files:**
- Create (scratch, not committed): a timing script under the scratchpad dir.

- [ ] **Step 1: Time 1 body vs 4 bodies**

Write a scratch script that calls `renderStills` for the same 30 frames with (a) one mask, no
per-entry body (union path, 2 bodies/pixel) and (b) four masks each with its own body (5
bodies/pixel), using a body with enough arithmetic to be measurable but no texture taps. Run each
twice and keep the second (page cache warm).

- [ ] **Step 2: Record the numbers**

Wall-clock seconds per configuration, and the ratio. These go verbatim into `docs/segmentation.md`
and the report. Do not round them into a story — state what was measured, on what.

---

### Task 5: Docs

**Files:**
- Modify: `docs/segmentation.md` (Region shaders section, the `kinoMaskDist` union note at ~line
  197, the assembly note at ~line 205)

- [ ] **Step 1: Add a "Per-object regions" subsection** under "2. Region shaders — the main
event", after the multi-object paragraph. It must state: the `masks[].subject` field, the
fallback to top-level `subject`, painter's order for overlap (with a two-mask example), the
`uMaskSelf`/`uChannelSelf` aliases and where they are NOT defined, the "same .frag on two entries
is a duplicate definition" hazard, and the measured cost from Task 4.

- [ ] **Step 2: Correct the `min()` guidance.** Today's line reads "Unioning several masks in one
region? Call it per mask and take `min()` of the results." Keep it for the union case, and add
that a per-entry body wants `uMaskSelf`/`uChannelSelf` instead — its own edge, nothing to `min()`.

- [ ] **Step 3: Update the "How region shaders assemble" paragraph** — it currently says the mask
binds to `uMask` (singular, stale) and describes only the union mix. State both tails and which
one is emitted when.

- [ ] **Step 4: Verify docs against the code.** Re-read the section against
`src/render/shaderSource.ts` and confirm every uniform name, field name and number is real.

- [ ] **Step 5: Commit**

```bash
git add docs/segmentation.md
git commit -m "docs(segment): per-object regions, uMaskSelf, measured fragment cost"
```

---

### Task 6: Full verification

- [ ] **Step 1:** `npx vitest run` — the whole suite must be green, including
`tests/render-region-reuse.test.ts`, `tests/render-maskdist.test.ts` and every schema test.
- [ ] **Step 2:** `npm run build` — clean.
- [ ] **Step 3:** Confirm `examples/segmentation/region-smoke.json` still parses and resolves
(it uses `mask`+`object`, the union path).
- [ ] **Step 4:** Write `docs/superpowers/specs/2026-07-24-per-object-regions-REPORT.md`.
- [ ] **Step 5:** Commit.
