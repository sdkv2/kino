# Region Shader Params + Keyframes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `regionShader` the `params`/`keyframes` surface `background` already has, so a beat's
subject/background/per-mask GLSL bodies can read tweened `u_<name>` uniforms instead of hardcoded
constants.

**Architecture:** Pure plumbing. The GLSL emitter (`assembleRegionShaderSource` + `extraParamNames`)
and the uniform resolver (`resolveUniforms`) already do the work and are not touched. This plan adds
the spec fields, resolves them in `build.ts`, carries them on `RegionShaderProps`, and uploads the
uniforms in `RegionShader.tsx` — mirroring `ShaderBackground.tsx` line for line.

**Tech Stack:** TypeScript, zod (spec schema), React + WebGL2 (render page), vitest, ImageMagick
(`tests/magick.ts`) for frame assertions.

## Global Constraints

- GLSL ES 3.00. Determinism is mandatory: motion only from `iTime`, keyframed params, `uPulse`.
- Do NOT change `kinoMaskDist`'s signature; never place a call to it behind non-uniform control flow.
- `MAX_REGION_MASKS = 4`, `EXTRA_PARAM_SLOTS = 4` — both unchanged.
- kino runs from compiled `dist/` — `npm run build` after editing source.
- Specs use beat kinds `scene`/`video` (with `source:`), never `app`/`avatar`.
- Keyframe `at` is BEAT-RELATIVE seconds (0 = beat start).
- A `regionShader` with no params must assemble a byte-identical program to today's.
- `npx vitest run` and `npm run build` green at the end.
- Absolute paths in this repo are under
  `/Users/aiden/Developer/Kino/kino/.claude/worktrees/agent-afe3be25bd5d49f46`.
- `grep`/ugrep silently skips `src/render/native/page/ShaderBackground.tsx` as binary — use `grep -a`.

---

### Task 1: Carry params on the props type and prove back-compat

**Files:**
- Modify: `src/render/props.ts:47-53` (`RegionShaderProps`)
- Test: `tests/segment-regionshader-src.test.ts`

**Interfaces:**
- Produces: `RegionShaderProps.params?: Record<string, BgParamValue>` and
  `RegionShaderProps.keyframes?: BgKeyframe[]`, both optional.

- [ ] **Step 1: Write the failing back-compat test**

Append to `tests/segment-regionshader-src.test.ts`:

```ts
import { extraParamNames } from "../src/render/shaderSource.js";

describe("region shader extra params", () => {
  // Nobody pays for a feature they didn't use. Byte-for-byte, not merely equivalent.
  it("emits an identical program when there are no params", () => {
    expect(assembleRegionShaderSource(SUBJ, BG, extraParamNames({}, []), [])).toBe(
      assembleRegionShaderSource(SUBJ, BG, []),
    );
    expect(assembleRegionShaderSource(SUBJ, BG, extraParamNames({ colorA: "#fff" }, []), [])).toBe(
      assembleRegionShaderSource(SUBJ, BG, []),
    );
  });

  it("aliases named params into uParam slots in sorted order", () => {
    const names = extraParamNames({ rim: 1 }, [{ params: { blur: 2 } }]);
    expect(names).toEqual(["blur", "rim"]);
    const src = assembleRegionShaderSource(SUBJ, BG, names, []);
    expect(src).toContain("#define u_blur uParam0");
    expect(src).toContain("#define u_rim uParam1");
  });

  // The shared bank: one alias set serves the subject, the background and every per-mask body.
  it("shares one alias set across per-object bodies", () => {
    const src = assembleRegionShaderSource(null, BG, extraParamNames({ rim: 1 }, []), [A, B2]);
    expect((src.match(/#define u_rim uParam0/g) ?? []).length).toBe(1);
    expect(src).toContain("#define mainImage regionSubject1");
  });
});
```

- [ ] **Step 2: Run it — expect PASS**

Run: `npx vitest run tests/segment-regionshader-src.test.ts`
Expected: PASS. This is a characterisation test — the emitter already supports this, and the point
is to lock the byte-identical guarantee BEFORE the plumbing lands so a later step cannot quietly
break it.

- [ ] **Step 3: Add the props fields**

In `src/render/props.ts`, inside `RegionShaderProps` (after `backgroundCode`):

```ts
  // Author params + tweens shared by EVERY body in this beat's program (subject, background and
  // each masks[].subjectCode) — there is one uParam0..3 bank in the one program they share.
  // Numeric non-reserved names pack into uParam slots as `u_<name>`; colorA/B/C + intensity go to
  // their own uniforms. `keyframes[].at` is BEAT-RELATIVE seconds (0 = beat start), matching the
  // beat-local clock Sequence already gives this component — see 2026-07-25-region-params-design.md.
  params?: Record<string, BgParamValue>;
  keyframes?: BgKeyframe[];
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (`BgParamValue`/`BgKeyframe` are declared later in the same file — TS hoists types.)

- [ ] **Step 5: Commit**

```bash
git add src/render/props.ts tests/segment-regionshader-src.test.ts
git commit -m "test(segment): lock byte-identical region program when no params; add props fields"
```

---

### Task 2: Upload the uniforms in RegionShader.tsx

**Files:**
- Modify: `src/render/native/page/RegionShader.tsx`
- Test: covered by Task 4's render test (no unit test — this is GL upload code)

**Interfaces:**
- Consumes: `RegionShaderProps.params` / `.keyframes` from Task 1.
- Produces: nothing new; `u_<name>`, `uColorA/B/C`, `uIntensity`, `uPulse` become live in region
  bodies.

- [ ] **Step 1: Import the resolvers**

In `src/render/native/page/RegionShader.tsx`, extend the existing imports:

```ts
import { assembleRegionShaderSource, MAX_REGION_MASKS, resolveUniforms, extraParamNames } from "../../shaderSource.js";
import { paramsAt } from "../../bgparams.js";
```

- [ ] **Step 2: Pass extraNames into the assembler and register the locations**

In `initGL`, replace the `assembleRegionShaderSource` call:

```ts
    const extras = extraParamNames(region.params ?? {}, region.keyframes ?? []);
    const fragSrc = assembleRegionShaderSource(
      region.subjectCode,
      region.backgroundCode,
      extras,
      region.masks.map((m) => m.subjectCode ?? null),
    );
```

and extend the uniform-location name list (same function, the `const names = [...]` line):

```ts
    const names = ["iResolution", "iTime", "iFrame", "iTimeDelta", "uTex0",
                   "iMouse", "uPulse", "uColorA", "uColorB", "uColorC", "uIntensity",
                   "uParam0", "uParam1", "uParam2", "uParam3"];
```

- [ ] **Step 3: Upload them every frame**

In `drawFrame`, replace the four `gl.uniform*` lines for iResolution/iTime/iFrame/iTimeDelta with:

```ts
    // Beat-relative clock: Sequence rebases useCurrentFrame to 0 at this beat's start, so `frame`
    // (and therefore iTime and every keyframe lookup) is already seconds-from-beat-start. Same
    // idiom as zoomKeyframes/captionKeyframes — a track rides real VO timing instead of breaking
    // when a beat shifts. See docs/superpowers/specs/2026-07-25-region-params-design.md.
    //
    // ponytail: iTime/iTimeDelta stay on the 30fps convention (all kino comps are 30fps); the video
    // SOURCE frame above is picked node-side with the real fps, which is what must be exact.
    const tt = frame / 30;
    // extraNames must be re-derived the SAME way initGL did, from the full base+keyframe key set —
    // never from this frame's resolved dict, or a slot could shift under the baked-in aliases.
    const u = resolveUniforms(
      paramsAt(region.params ?? {}, region.keyframes ?? [], tt),
      { frame, fps: 30, width, height, pulse: 0 },
      extraParamNames(region.params ?? {}, region.keyframes ?? []),
    );
    gl.uniform3f(loc.iResolution, width, height, 1);
    gl.uniform1f(loc.iTime, u.iTime);
    gl.uniform1i(loc.iFrame, u.iFrame);
    gl.uniform1f(loc.iTimeDelta, u.iTimeDelta);
    gl.uniform4f(loc.iMouse, 0, 0, 0, 0);
    // uPulse is declared in the region header but has no trigger surface this phase (YAGNI) —
    // uploaded explicitly as 0 so a body referencing it reads a defined value.
    gl.uniform1f(loc.uPulse, u.uPulse);
    gl.uniform3fv(loc.uColorA, u.uColorA);
    gl.uniform3fv(loc.uColorB, u.uColorB);
    gl.uniform3fv(loc.uColorC, u.uColorC);
    gl.uniform1f(loc.uIntensity, u.uIntensity);
    gl.uniform1f(loc.uParam0, u.uParams[0]);
    gl.uniform1f(loc.uParam1, u.uParams[1]);
    gl.uniform1f(loc.uParam2, u.uParams[2]);
    gl.uniform1f(loc.uParam3, u.uParams[3]);
```

Note `resolveUniforms` is given `width`/`height` directly — RegionShader does not supersample, so
there is no `SS` factor as in `ShaderBackground`.

- [ ] **Step 4: Add extraNames to glKey**

In the component, extend the `glKey` array (after the per-mask bodies) so a reused page cannot keep
a previous spec's baked aliases:

```ts
    // Param NAMES are baked into the program as `#define u_<name> uParamI` — two specs differing
    // only in their param names must not share a compiled program (cf. render-region-reuse.test.ts).
    extraParamNames(region.params ?? {}, region.keyframes ?? []).join(","),
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/render/native/page/RegionShader.tsx
git commit -m "feat(segment): upload uParam/colour uniforms in RegionShader, beat-relative tweens"
```

---

### Task 3: Spec schema + build resolve

**Files:**
- Modify: `src/spec/schema.ts` (the `regionShader` object, ~line 183)
- Modify: `src/commands/build.ts` (`resolveRegionShader`, ~line 53)
- Test: `tests/segment-regionshader-schema.test.ts`

**Interfaces:**
- Consumes: `RegionShaderProps.params`/`.keyframes` (Task 1).
- Produces: spec fields `regionShader.params` and `regionShader.keyframes`; `resolveRegionShader`
  now throws `Error` when the numeric non-reserved param union exceeds `EXTRA_PARAM_SLOTS`.

- [ ] **Step 1: Write the failing schema test**

Append to `tests/segment-regionshader-schema.test.ts` (match the file's existing helper for building
a spec object — reuse whatever `parseSpec` wrapper it already defines):

```ts
  it("accepts params + beat-relative keyframes on regionShader", () => {
    const spec = parse(withRegion({
      mask: "masks/clip", subject: "s.frag",
      params: { rim: 2 },
      keyframes: [{ at: 0, params: { rim: 2 } }, { at: 1.2, params: { rim: 14 }, ease: "easeInOut" }],
    }));
    const rs = spec.segments[0].regionShader!;
    expect(rs.params).toEqual({ rim: 2 });
    expect(rs.keyframes?.[1].at).toBe(1.2);
  });

  it("rejects unknown keys inside regionShader", () => {
    expect(() => parse(withRegion({ mask: "masks/clip", subject: "s.frag", triggers: [] }))).toThrow();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/segment-regionshader-schema.test.ts`
Expected: FAIL — zod strips or rejects the unknown `params`/`keyframes` keys.

- [ ] **Step 3: Add the schema fields**

In `src/spec/schema.ts`, inside the `regionShader` `z.object({...})`, after `background`:

```ts
        // Author params shared by every body in this beat's program (there is ONE uParam0..3 bank).
        // Numeric non-reserved names alias to `u_<name>`; colorA/B/C + intensity drive their own
        // uniforms. Max 4 numeric non-reserved names across params + keyframes — build throws above
        // that rather than silently dropping the extras.
        params: z.record(z.union([z.number(), z.string()])).optional(),
        // Beat-relative track — `at` is seconds from THIS segment's start (like zoomKeyframes), so
        // it rides the beat when VO timing shifts. RegionShader's clock is already beat-local.
        keyframes: z.array(BgKeyframe).optional(),
```

- [ ] **Step 4: Run the schema test — expect PASS**

Run: `npx vitest run tests/segment-regionshader-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Resolve them in build.ts**

In `src/commands/build.ts`, extend `resolveRegionShader`'s parameter type with:

```ts
    params?: Record<string, number | string>;
    keyframes?: { at: number; params: Record<string, number | string>; ease?: string }[];
```

and its return object with:

```ts
    params: rs.params,
    keyframes: rs.keyframes as BgKeyframe[] | undefined,
```

Immediately before the `return`, add the ceiling guard:

```ts
  // extraParamNames silently slices past EXTRA_PARAM_SLOTS, which for a background means a fifth
  // param quietly does nothing. That is a bad failure mode on a new surface, so fail loudly here.
  // The cap is on the UNION across params + every keyframe, because all bodies share one bank.
  const RESERVED_PARAMS = new Set(["colorA", "colorB", "colorC", "intensity"]);
  const named = new Set<string>();
  for (const src of [rs.params ?? {}, ...(rs.keyframes ?? []).map((k) => k.params)]) {
    for (const [k, v] of Object.entries(src)) if (!RESERVED_PARAMS.has(k) && typeof v === "number") named.add(k);
  }
  if (named.size > EXTRA_PARAM_SLOTS) {
    throw new Error(
      `regionShader has ${named.size} numeric params (${[...named].sort().join(", ")}) but only ` +
        `${EXTRA_PARAM_SLOTS} uParam slots exist — every region body shares one bank. Drop ${named.size - EXTRA_PARAM_SLOTS}.`,
    );
  }
```

Add `EXTRA_PARAM_SLOTS` to the existing `../render/shaderSource.js` import if present, else add:

```ts
import { EXTRA_PARAM_SLOTS } from "../render/shaderSource.js";
```

and add `BgKeyframe` to the existing `../render/props.js` type import.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add src/spec/schema.ts src/commands/build.ts tests/segment-regionshader-schema.test.ts
git commit -m "feat(spec): regionShader params + beat-relative keyframes, 4-slot ceiling guard"
```

---

### Task 4: The render-level proof

**Files:**
- Create: `tests/render-region-params.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-3.

- [ ] **Step 1: Write the failing render test**

Create `tests/render-region-params.test.ts`:

```ts
// Region-shader params through a REAL render. A string assertion that a keyframe parsed proves
// nothing — it cannot tell a tween from a constant, nor a beat-relative clock from an absolute one.
// So: one beat that starts at 2s (absolute and beat-relative therefore disagree), a param tweened
// 0->1 over beat-relative 0..1s, and three frames read off the rendered pixels.
import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0 };
const bg = {
  kind: "custom" as const, image: null,
  customCode: "ctx.fillStyle='#000';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);",
  shaderCode: null,
  params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 },
  keyframes: [], triggers: [],
};

const W = 1080, H = 1920;
const MX0 = 100, MX1 = 600, MY0 = 400, MY1 = 1500; // mask rect

// Subject reads the tweened param straight out to greyscale. Background is a constant blue control:
// it must be pixel-identical across all three frames, so a drift there would mean something OTHER
// than the param moved.
const SUBJ = "void mainImage(out vec4 c, in vec2 f){ c = vec4(vec3(u_lift), 1.0); }";
const BG = "void mainImage(out vec4 c, in vec2 f){ c = vec4(0.0, 0.0, 1.0, 1.0); }";

// The beat starts at 2s. Under BEAT-relative timing, composition frame 60 is beat t=0 -> lift 0.
// Under ABSOLUTE timing it would be t=2, past the last keyframe -> lift 1. The f0 assertion below
// is what separates the two.
const START = 2;
const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "",
  segments: [{
    kind: "video", source: "asset.png", caption: "", startSec: START, endSec: START + 3,
    regionShader: {
      masks: [{ maskSrc: "mask0.png", maskKind: "image" as const, channel: "gray" as const, subjectCode: null }],
      subjectCode: SUBJ,
      backgroundCode: BG,
      params: { lift: 0 },
      keyframes: [{ at: 0, params: { lift: 0 } }, { at: 1, params: { lift: 1 } }],
    },
  }],
};

const cropRgb = (p: string, w: number, h: number, x: number, y: number): number[] =>
  magick([p, "-crop", `${w}x${h}+${x}+${y}`, "+repage", "-format", "%[fx:mean.r] %[fx:mean.g] %[fx:mean.b]", "info:"])
    .trim().split(/\s+/).map(Number);
const meanDiff = (a: string, b: string) =>
  parseFloat(magick([a, b, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim());

describe("region shader params", () => {
  it("tweens a param over the beat on a beat-relative clock", async () => {
    const publicDir = mkdtempSync(join(tmpdir(), "kino-rparams-"));
    magick(["-size", `${W}x${H}`, "xc:black", "-fill", "white",
            "-draw", `rectangle ${MX0},${MY0} ${MX1},${MY1}`, join(publicDir, "mask0.png")]);
    magick(["-size", `${W}x${H}`, "xc:#333333", join(publicDir, "asset.png")]);

    const f = (s: number) => Math.round(s * 30);
    const out = await renderStills({
      props, publicDir, format: "9:16",
      frames: [
        { frame: f(START), name: "t0" },        // beat t = 0.0 -> lift 0
        { frame: f(START + 0.5), name: "t05" }, // beat t = 0.5 -> lift 0.5
        { frame: f(START + 1), name: "t1" },    // beat t = 1.0 -> lift 1
        { frame: f(START + 1), name: "t1b" },   // determinism repeat
      ],
      outDir: mkdtempSync(join(tmpdir(), "kino-rparams-out-")),
    });

    // Subject crop: well inside the mask, 100px+ clear of every edge, no antialiased seam.
    const sub = (p: string) => cropRgb(p, 300, 300, 200, 700);
    // Background crop: outside the mask entirely.
    const back = (p: string) => cropRgb(p, 200, 300, 750, 700);
    const [s0, s05, s1] = [sub(out[0]), sub(out[1]), sub(out[2])];
    console.log(`region params subject: t0=${s0[0]} t0.5=${s05[0]} t1=${s1[0]}`);
    console.log(`region params background: t0=${back(out[0])} t1=${back(out[2])}`);

    // The endpoints. t0 near BLACK is also the beat-relative proof: absolute timing would clamp
    // past the last keyframe here and render white.
    expect(s0[0]).toBeLessThan(0.02);
    expect(s1[0]).toBeGreaterThan(0.98);

    // THE TWEEN. A param that merely jumped between keyframe values (or ignored `ease`) would read
    // 0 or 1 here, not the midpoint. This is the assertion the whole test exists for.
    expect(s05[0]).toBeGreaterThan(0.45);
    expect(s05[0]).toBeLessThan(0.55);

    // Grey, not tinted — all three channels track the one param.
    expect(Math.abs(s05[0] - s05[1])).toBeLessThan(0.01);
    expect(Math.abs(s05[0] - s05[2])).toBeLessThan(0.01);

    // The control: the background body has no param, so it must not move at all.
    expect(back(out[0])[2]).toBeGreaterThan(0.98);
    expect(back(out[2])[2]).toBeGreaterThan(0.98);

    // Two seeks to the same frame index are byte-identical — no wall clock in the tween.
    expect(meanDiff(out[2], out[3])).toBe(0);
  }, 240000);
});
```

- [ ] **Step 2: Run it to verify it fails without the plumbing**

Run: `git stash && npx vitest run tests/render-region-params.test.ts; git stash pop`
Expected: FAIL — without Task 2 the program has no `u_lift` alias, so the fragment shader fails to
compile and the beat renders the night fill.

(If Tasks 1-3 are already committed, instead verify by the deliberate breakages in Step 4.)

- [ ] **Step 3: Run it against the real implementation**

Run: `npx vitest run tests/render-region-params.test.ts`
Expected: PASS, with logged subject means near 0 / 0.5 / 1.

- [ ] **Step 4: Prove each assertion bites — break it and record the numbers**

Do these one at a time, run the test, record the observed number, then REVERT.

  a. **Kill the upload.** In `RegionShader.tsx` `drawFrame`, change
     `gl.uniform1f(loc.uParam0, u.uParams[0]);` to `gl.uniform1f(loc.uParam0, 0);`
     Expected: t0.5 and t1 both read 0 → the tween + endpoint assertions fail.

  b. **Make the clock absolute.** Change `const tt = frame / 30;` to
     `const tt = frame / 30 + 2;`
     Expected: t0 reads ~1.0 → the `s0[0] < 0.02` assertion fails. This is what proves the test can
     actually detect an absolute clock.

  c. **Make it step instead of tween.** In `drawFrame`, replace the `paramsAt(...)` call with
     `region.params ?? {}`. Expected: all three frames read 0 → midpoint assertion fails.

Record every observed number in the report.

- [ ] **Step 5: Full suite + build**

Run: `npx vitest run`
Expected: all green.

Run: `npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add tests/render-region-params.test.ts
git commit -m "test(segment): render-level proof that region params tween on a beat-relative clock"
```

---

### Task 5: Docs

**Files:**
- Modify: `docs/spec-reference.md` (the `regionShader` entry)
- Modify: `docs/segmentation.md` (the region-shader authoring section)
- Create: `docs/superpowers/specs/2026-07-25-region-params-REPORT.md`

- [ ] **Step 1: Document the fields in `docs/spec-reference.md`**

Find the `regionShader` block and add rows/bullets for:

```
params      — { name: number|string }. Author params shared by EVERY body in the beat (subject,
              background, and each masks[].subject) — there is one uParam0..3 bank in the one
              program they share. Numeric names alias to `u_<name>` in GLSL, sorted alphabetically;
              colorA/colorB/colorC (hex) and intensity drive uColorA/B/C and uIntensity instead and
              do NOT consume a slot. Max 4 numeric names across params + keyframes; build errors
              above that rather than silently dropping them.
keyframes   — [{ at, params, ease? }]. Tweens those params. `at` is BEAT-RELATIVE seconds (0 = this
              beat's start), like zoomKeyframes/captionKeyframes — NOT absolute like
              backgroundKeyframes. No triggers/uPulse on region shaders yet; uPulse reads 0.
```

- [ ] **Step 2: Document authoring in `docs/segmentation.md`**

Add a short subsection under the region-shader material with the worked example from the design spec
(`params` + `keyframes` + a body using `u_rim`), and state the beat-relative rule and the 4-slot cap.

- [ ] **Step 3: Write the report**

Create `docs/superpowers/specs/2026-07-25-region-params-REPORT.md` covering: the schema chosen, the
timing decision and why, how the 4-slot ceiling is handled across multiple bodies, what was tested
and the numbers from both the working and each deliberately-broken case, anything unresolved, and
anything found wrong in existing code.

- [ ] **Step 4: Commit**

```bash
git add docs/
git commit -m "docs(segment): regionShader params + keyframes, phase 3 report"
```

## Self-Review

- **Spec coverage:** schema (Task 3), timing (Tasks 2+4), triggers decision (design §3, documented
  Task 5), 4-slot ceiling (Task 3 guard, Task 5 docs), back-compat `toBe` (Task 1), render-level
  tween proof + deliberate breakage (Task 4), docs (Task 5). No gaps.
- **Placeholders:** none — every code step carries the actual code.
- **Type consistency:** `params`/`keyframes` named identically in `RegionShaderProps` (Task 1), the
  zod object (Task 3), `resolveRegionShader`'s return (Task 3) and both test files.
