# Motion Graphics (Tier 2) — Procedural HTML — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent generate a motion graphic's markup procedurally — a JS file whose body is `render(env)` returning an HTML string, evaluated per frame in the browser render and injected into the existing Tier-1 Shadow DOM.

**Architecture:** Reuse the proven `custom`-background pattern (`new Function` evaluated per frame in the Remotion/browser render). A `motion` `source` ending in `.js` is procedural: the JS is determinism-linted at build time and baked verbatim into `MotionGraphicProps.proc`; `MotionGraphic` memoizes `new Function("env", proc)` and, each frame, calls it with an `env` (frame state + resolved params + palette + dimensions) and injects the returned HTML. The CSS-variable contract + `.kino-anim` scrub still apply; `KINO_SCRUB_STYLE` also disables `transition` so generated CSS can't animate on the wall clock. Trusted (agent-authored) but browser-side, so no Node secrets are reachable; true isolation stays Tier 3.

**Tech Stack:** TypeScript (ESM), Remotion (React, headless Chromium), Vitest, ImageMagick (`magick`, pixel sampling). No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-06-17-motion-procedural-tier2-design.md`](../specs/2026-06-17-motion-procedural-tier2-design.md)

---

## File Structure

**Modified files:**

- `src/render/props.ts` — add `proc?: string` to `MotionGraphicProps`; add the `MotionEnv` interface (the per-frame argument to a procedural `render`).
- `src/render/motiongraphic.ts` — add `BANNED_JS` + `lintMotionJs`; branch `resolveMotionGraphic` on the `.js` extension (lint JS, bake `proc`) vs `.html` (lint + sanitize, today's path).
- `src/spec/validate.ts` — `assertMotionGraphics` lints `.js` sources with `lintMotionJs`.
- `src/render/remotion/MotionGraphic.tsx` — add `transition:none` to `KINO_SCRUB_STYLE`; evaluate `proc` per frame into the injected HTML.
- `src/commands/motion.ts` — a "Procedural graphics (`.js`)" section in `kino motion`.
- `skills/video-production/SKILL.md` — note the `.js` option in the motion bullet.
- `docs/motion-graphics.md` — a "Procedural graphics (Tier 2)" section.
- `tests/motiongraphic.test.ts` — `lintMotionJs` cases, `.js` routing in `resolveMotionGraphic`, `.js` lint in `assertMotionGraphics`, a `kino motion` help assertion.
- `tests/render-motion.test.ts` — procedural render (deterministic, `env.progress`-driven), error→blank, and a `transition:none` determinism guard.

---

## Task 1: Props — `proc` field + `MotionEnv` type

**Files:**
- Modify: `src/render/props.ts`

- [ ] **Step 1: Add the `proc` field + `MotionEnv` interface**

In `src/render/props.ts`, replace the `MotionGraphicProps` interface:
```ts
// A resolved motion graphic: the sanitized HTML plus the JSON-owned timing controls.
export interface MotionGraphicProps {
  html: string; // sanitized, self-contained static markup (Tier 1); "" for procedural graphics
  proc?: string; // Tier 2: linted JS source — body of render(env) → HTML string, evaluated per frame
  params: Record<string, BgParamValue>; // base CSS-variable values
  keyframes: BgKeyframe[]; // tween params over time (--<name>)
  triggers: BgTrigger[]; // one-shot pulses (--pulse)
}

// The argument passed to a Tier-2 procedural graphic's render(env) every frame.
export interface MotionEnv {
  frame: number; // integer frame within the beat
  t: number; // seconds within the beat
  progress: number; // 0 → 1 across the beat
  pulse: number; // 0 → 1 trigger envelope
  params: Record<string, BgParamValue>; // resolved spec params at this frame
  palette: { mint: string; green: string; night: string; white: string; gold: string; font: string };
  width: number; // canvas px (1080 for 9:16)
  height: number; // canvas px (1920 for 9:16)
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: `tsc` completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/render/props.ts
git commit -m "feat(motion): add proc field + MotionEnv type for procedural graphics"
```

---

## Task 2: JS determinism lint + `.js` routing in `resolveMotionGraphic`

**Files:**
- Modify: `src/render/motiongraphic.ts`
- Test: `tests/motiongraphic.test.ts`

- [ ] **Step 1: Write the failing lint + routing tests**

In `tests/motiongraphic.test.ts`, extend the top import to include `lintMotionJs`:
```ts
import { lintMotionHtml, sanitizeMotionHtml, lintMotionJs } from "../src/render/motiongraphic.js";
```

Add a new `describe` block (anywhere after the existing `lintMotionHtml` block):
```ts
describe("lintMotionJs", () => {
  it("passes a clean render(env) body", () => {
    expect(lintMotionJs("const n = env.params.count; return `<div>${n}</div>`;")).toEqual([]);
  });
  it("allows Math.* geometry", () => {
    expect(lintMotionJs("return Math.sin(env.t) + Math.cos(env.frame) + Math.round(env.progress)")).toEqual([]);
  });
  it("rejects Math.random / Date.now / new Date", () => {
    expect(lintMotionJs("return Math.random()")[0]).toMatch(/Math\.random/);
    expect(lintMotionJs("return Date.now()")[0]).toMatch(/Date\.now/i);
    expect(lintMotionJs("return new Date()")[0]).toMatch(/new Date/i);
  });
  it("rejects timers, network, modules, and Node/DOM globals", () => {
    expect(lintMotionJs("setTimeout(()=>{},1)").length).toBeGreaterThan(0);
    expect(lintMotionJs("fetch('/x')").length).toBeGreaterThan(0);
    expect(lintMotionJs("require('fs')").length).toBeGreaterThan(0);
    expect(lintMotionJs("const k = process.env.KEY").length).toBeGreaterThan(0);
    expect(lintMotionJs("document.body.innerHTML = ''").length).toBeGreaterThan(0);
  });
});
```

In the existing `describe("resolveMotionGraphic", ...)` block (which already defines a `projWith(file, contents)` helper), add:
```ts
  it("routes a .js source to proc (linted, not sanitized) with empty html", () => {
    const project = projWith("motion/gen.js", "return `<div class=\"x\"></div>`;");
    const props = resolveMotionGraphic({ source: "motion/gen.js" }, project);
    expect(props.proc).toContain("<div");
    expect(props.html).toBe("");
  });
  it("throws listing the JS lint violation for a banned construct in a .js source", () => {
    const project = projWith("motion/bad.js", "return Math.random()");
    expect(() => resolveMotionGraphic({ source: "motion/bad.js" }, project)).toThrow(/Math\.random/);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/motiongraphic.test.ts -t "lintMotionJs"`
Expected: FAIL — `lintMotionJs` is not exported.

- [ ] **Step 3: Add `BANNED_JS` + `lintMotionJs`**

In `src/render/motiongraphic.ts`, after the `lintMotionHtml` function (line ~26), add:
```ts
// Determinism + safety denylist for Tier-2 procedural sources (JS). The function must be a pure
// (env) → HTML string; anything time-based, networked, module-loading, or environment-touching is
// rejected. Globals are matched by access (process. / window.[) so the bare words can still appear
// in emitted string content.
const BANNED_JS: { re: RegExp; msg: string }[] = [
  { re: /\bMath\.random\b/, msg: "Math.random breaks determinism — derive variation from env.frame or an index" },
  { re: /\b(Date\.now|performance\.now)\b/, msg: "Date.now/performance.now break determinism — use env.t / env.frame" },
  { re: /\bnew\s+Date\b/, msg: "new Date breaks determinism — use env.t / env.frame" },
  { re: /\b(requestAnimationFrame|setTimeout|setInterval)\b/, msg: "timers/RAF aren't allowed — kino calls render(env) once per frame" },
  { re: /\b(fetch|XMLHttpRequest)\b/, msg: "network access isn't allowed during render" },
  { re: /\brequire\s*\(/, msg: "require() isn't allowed — render(env) must be self-contained" },
  { re: /\bimport\b\s*[('"\w{*]/, msg: "import isn't allowed — render(env) must be self-contained" },
  { re: /\bprocess\s*[.\[]/, msg: "process isn't available — render(env) runs in the browser, not Node" },
  { re: /\b(globalThis|window|document)\s*[.\[]/, msg: "globalThis/window/document aren't allowed — return an HTML string, don't touch the DOM" },
  { re: /\son\w+\s*=/i, msg: "inline event handlers (on*=) aren't allowed in generated markup" },
];

// Returns a list of human-readable violations for a Tier-2 procedural (JS) source (empty = clean).
export function lintMotionJs(src: string): string[] {
  return BANNED_JS.filter((b) => b.re.test(src)).map((b) => b.msg);
}
```

- [ ] **Step 4: Branch `resolveMotionGraphic` on the `.js` extension**

In `src/render/motiongraphic.ts`, replace the body of `resolveMotionGraphic`:
```ts
export function resolveMotionGraphic(
  ref: MotionGraphicRefInput,
  project: { assetPath(rel: string): string },
): MotionGraphicProps {
  const abs = project.assetPath(ref.source);
  if (!existsSync(abs)) throw new Error(`Missing motion graphic file: assets/${ref.source}`);
  const raw = readFileSync(abs, "utf8");
  const base = { params: ref.params ?? {}, keyframes: ref.keyframes ?? [], triggers: ref.triggers ?? [] };
  if (ref.source.endsWith(".js")) {
    // Tier 2: procedural source. Lint for determinism/safety; bake the JS verbatim (not sanitized —
    // it's code, not markup; its per-frame output is trusted like the custom-background draw fn).
    const violations = lintMotionJs(raw);
    if (violations.length) throw new Error(`Motion graphic assets/${ref.source}: ${violations.join("; ")}`);
    return { html: "", proc: raw, ...base };
  }
  const violations = lintMotionHtml(raw);
  if (violations.length) throw new Error(`Motion graphic assets/${ref.source}: ${violations.join("; ")}`);
  return { html: sanitizeMotionHtml(raw), ...base };
}
```

- [ ] **Step 5: Run to verify the lint + routing tests pass**

Run: `npx vitest run tests/motiongraphic.test.ts`
Expected: PASS (the new `lintMotionJs` + `.js` routing cases, and all existing cases).

- [ ] **Step 6: Commit**

```bash
git add src/render/motiongraphic.ts tests/motiongraphic.test.ts
git commit -m "feat(motion): lint .js procedural sources + route them to proc in resolveMotionGraphic"
```

---

## Task 3: Lint `.js` sources in the build-time validator

**Files:**
- Modify: `src/spec/validate.ts`
- Test: `tests/motiongraphic.test.ts`

- [ ] **Step 1: Write the failing validator test**

In `tests/motiongraphic.test.ts`, in the existing `describe("assertMotionGraphics", ...)` block (which defines its own `projWith` writing under `assets/`), add:
```ts
  it("lints a .js motion source with the JS denylist", () => {
    const project = projWith("motion/bad.js", "return fetch('/x')");
    const spec = { segments: [{ kind: "motion", source: "motion/bad.js", text: "x" }] } as unknown as Spec;
    expect(() => assertMotionGraphics(spec, project)).toThrow(/network access/i);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/motiongraphic.test.ts -t "assertMotionGraphics"`
Expected: FAIL — `assertMotionGraphics` runs `lintMotionHtml` on the `.js` file, which does not flag `fetch(`, so no error is thrown.

- [ ] **Step 3: Branch the validator's lint on the extension**

In `src/spec/validate.ts`, change the import on line 6:
```ts
import { lintMotionHtml, lintMotionJs } from "../render/motiongraphic.js";
```

In `assertMotionGraphics`, replace the two lines inside the `for` loop that read + lint the file:
```ts
    const raw = readFileSync(abs, "utf8");
    const violations = source.endsWith(".js") ? lintMotionJs(raw) : lintMotionHtml(raw);
    if (violations.length) throw new Error(`Motion graphic ${where} (assets/${source}): ${violations.join("; ")}`);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/motiongraphic.test.ts -t "assertMotionGraphics"`
Expected: PASS (the new `.js` case + the existing `.html` cases).

- [ ] **Step 5: Commit**

```bash
git add src/spec/validate.ts tests/motiongraphic.test.ts
git commit -m "feat(motion): validate .js motion sources with the JS lint"
```

---

## Task 4: Render `proc` per frame + disable transitions

**Files:**
- Modify: `src/render/remotion/MotionGraphic.tsx`

(No unit test here — render behavior is covered by Task 5; this task must typecheck.)

- [ ] **Step 1: Add `transition:none` to the scrub stylesheet**

In `src/render/remotion/MotionGraphic.tsx`, in `KINO_SCRUB_STYLE`, change the universal rule from:
```tsx
  "<style>*{animation-play-state:paused !important}" +
```
to:
```tsx
  "<style>*{animation-play-state:paused !important;transition:none !important}" +
```

- [ ] **Step 2: Import `MotionEnv`**

In `src/render/remotion/MotionGraphic.tsx`, extend the props type import:
```tsx
import type { Theme, MotionGraphicProps, MotionEnv } from "../props";
```

- [ ] **Step 3: Evaluate `proc` per frame**

In the `MotionGraphic` component, change the `useVideoConfig()` destructure to also take dimensions:
```tsx
  const { fps, width, height } = useVideoConfig();
```

Then, after the `vars` object is fully built (after the `for (const [k, v] of Object.entries(resolved)) ...` line) and before the `return`, add:
```tsx
  // Tier 2: a procedural source is the body of render(env); memoize the compiled fn and evaluate it
  // for this frame. It runs in the browser (no Node globals) and must be a pure (env) → HTML string.
  const procFn = React.useMemo(
    () => (data.proc ? (new Function("env", data.proc) as (env: MotionEnv) => unknown) : null),
    [data.proc],
  );
  let html = data.html;
  if (procFn) {
    const env: MotionEnv = {
      frame,
      t: tt,
      progress,
      pulse,
      params: resolved,
      palette: { mint: t.mint, green: t.green, night: t.night, white: t.white, gold: t.gold, font: t.font },
      width,
      height,
    };
    try {
      html = String(procFn(env) ?? "");
    } catch (err) {
      html = "";
      if (frame === 0) console.error("motion graphic render(env) threw:", err);
    }
  }
```

Change the returned JSX to inject the computed `html`:
```tsx
  return (
    <AbsoluteFill>
      <ShadowHtml html={html} vars={vars} />
    </AbsoluteFill>
  );
```
(`ShadowHtml` already re-sets `innerHTML` whenever `html` changes and prepends `KINO_SCRUB_STYLE`, so per-frame procedural output is handled with no other change.)

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: `tsc` completes with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/render/remotion/MotionGraphic.tsx
git commit -m "feat(motion): evaluate procedural render(env) per frame + disable CSS transitions"
```

---

## Task 5: Render tests (procedural + determinism)

**Files:**
- Test: `tests/render-motion.test.ts`

(`theme`, `bg`, and `sampleCenter` are already defined at the top of this file; reuse them. `renderStills`, `mkdtempSync`, `existsSync`, `tmpdir`, `join`, and `KinoProps` are already imported.)

- [ ] **Step 1: Write the procedural + determinism render tests**

Append to `tests/render-motion.test.ts`:
```ts
const greenOf = (s: string) => {
  const m = s.match(/srgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) throw new Error(`Unexpected pixel format: ${s}`);
  return Number(m[2]);
};

describe("motion graphics procedural (Tier 2)", () => {
  it("renders a procedural graphic driven by env.progress, deterministically", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-proc-"));
    // full-frame block whose green channel = round(progress*255); sampling the centre reads progress.
    const proc = "return `<div style=\"position:absolute;inset:0;background:rgb(0,${Math.round(env.progress*255)},0)\"></div>`;";
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "test",
      segments: [{ kind: "motion", caption: "", startSec: 0, endSec: 2,
        motion: { html: "", proc, params: {}, keyframes: [], triggers: [] } }],
    };
    // beat 0..2s = 60 frames; frame 6 → ~10% (dark green), frame 54 → ~90% (bright green).
    const outs = await renderStills({ props, publicDir: outDir, format: "9:16",
      frames: [{ frame: 6, name: "p-early" }, { frame: 54, name: "p-late" }, { frame: 54, name: "p-late2" }], outDir });
    const early = sampleCenter(outs[0]);
    const late = sampleCenter(outs[1]);
    const late2 = sampleCenter(outs[2]);
    expect(early).not.toBe(late);          // env.progress advanced the generated colour
    expect(late).toBe(late2);              // same frame twice → identical (deterministic)
    expect(greenOf(early)).toBeLessThan(80);     // ~10%
    expect(greenOf(late)).toBeGreaterThan(180);  // ~90%
  }, 180000);

  it("renders a blank frame (no crash) when render(env) throws", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-procerr-"));
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "test",
      segments: [{ kind: "motion", caption: "", startSec: 0, endSec: 2,
        motion: { html: "", proc: "throw new Error('boom');", params: {}, keyframes: [], triggers: [] } }],
    };
    const outs = await renderStills({ props, publicDir: outDir, format: "9:16", frames: [{ frame: 30, name: "err" }], outDir });
    expect(existsSync(outs[0])).toBe(true);
  }, 180000);

  it("disables CSS transitions so markup can't animate on the wall clock", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-trans-"));
    // opacity bound to --progress with a long transition; transition:none must snap it to the frame's
    // value, so the same frame rendered twice is identical.
    const html = `<style>.b{position:absolute;inset:0;background:#00ff00;opacity:var(--progress);transition:opacity 10s linear}</style><div class="b"></div>`;
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "test",
      segments: [{ kind: "motion", caption: "", startSec: 0, endSec: 2,
        motion: { html, params: {}, keyframes: [], triggers: [] } }],
    };
    const outs = await renderStills({ props, publicDir: outDir, format: "9:16",
      frames: [{ frame: 40, name: "tr" }, { frame: 40, name: "tr2" }], outDir });
    expect(sampleCenter(outs[0])).toBe(sampleCenter(outs[1]));
  }, 180000);
});
```

- [ ] **Step 2: Run the render tests**

Run: `npx vitest run tests/render-motion.test.ts -t "procedural"`
Expected: PASS (3 cases) — the procedural colour advances + is deterministic, the throwing source produces a PNG, and the transition graphic is identical frame-to-frame.

- [ ] **Step 3: Commit**

```bash
git add tests/render-motion.test.ts
git commit -m "test(motion): render tests for procedural graphics + transition:none determinism"
```

---

## Task 6: Docs — `kino motion`, SKILL, motion-graphics.md

**Files:**
- Modify: `src/commands/motion.ts`
- Modify: `skills/video-production/SKILL.md`
- Modify: `docs/motion-graphics.md`
- Test: `tests/motiongraphic.test.ts`

- [ ] **Step 1: Add the `kino motion` help assertion**

In `tests/motiongraphic.test.ts`, in the `describe("kino motion help", ...)` test, add:
```ts
    expect(t).toMatch(/render\(env\)/); // the procedural (.js) section
    expect(t).toMatch(/\.js/);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/motiongraphic.test.ts -t "kino motion help"`
Expected: FAIL — `render(env)` not yet in the help text.

- [ ] **Step 3: Add the procedural section to `kino motion`**

In `src/commands/motion.ts`, insert this block immediately before the `"Rules (the build rejects violations):",` line:
```ts
    "Procedural graphics (.js) — when a layout needs loops/computed geometry, point source at a .js",
    "file whose body is render(env) and returns an HTML string. kino calls it every frame:",
    "  // assets/motion/bars.js",
    "  const data = [40, 75, 55, 90];",
    "  return data.map((h, i) => `<div class='bar kino-anim' style='left:${8 + i * 22}%;height:${h}%;`",
    "    + `--kino-delay:${i * .08}'></div>`).join('')",
    "    + `<style>.bar{position:absolute;bottom:10%;width:8%;background:var(--kino-mint);`",
    "    + `transform-origin:bottom;transform:scaleY(var(--progress))}</style>`;",
    "  · env = { frame, t, progress, pulse, params, palette:{mint,green,night,white,gold,font}, width, height }.",
    "  · The returned markup can use the variables above + .kino-anim / .kino-cliptext.",
    "  · Pure (env)->string: no Date.now/Math.random/timers/fetch/import/process (the build lints it).",
    "",
```

- [ ] **Step 4: Run to verify the help test passes**

Run: `npx vitest run tests/motiongraphic.test.ts -t "kino motion help"`
Expected: PASS.

- [ ] **Step 5: Update SKILL.md**

In `skills/video-production/SKILL.md`, in the motion-graphics bullet, immediately after the sentence ending "…instead of being clipped." add:
```markdown
  For loops/computed geometry, point `source` at a `.js` file whose body is `render(env)` returning an
  HTML string (evaluated per frame; `env` = `{ frame, t, progress, pulse, params, palette, width, height }`;
  determinism-linted) instead of a `.html` file.
```

- [ ] **Step 6: Add a "Procedural (Tier 2)" section to `docs/motion-graphics.md`**

In `docs/motion-graphics.md`, immediately before the "## Determinism & safety (the lint)" section, add:
```markdown
## Procedural graphics (Tier 2)

When a graphic needs loops or computed geometry (a chart of N bars, a ring of N dots, a scatter), point
`source` at a **`.js`** file instead of `.html`. Its body is the body of `render(env)` and must **return
an HTML string**; kino evaluates it in the browser **every frame** and injects the result into the same
Shadow DOM, so the returned markup can still use the CSS-variable contract, `.kino-anim`, and
`.kino-cliptext`.

```js
// assets/motion/bars.js  — body of render(env) → returns HTML
const data = [40, 75, 55, 90];                 // structured data lives in the file; params stay scalar
return data.map((h, i) =>
  `<div class="bar kino-anim" style="left:${8 + i * 22}%;height:${h}%;--kino-delay:${i * 0.08}"></div>`
).join("") +
`<style>.bar{position:absolute;bottom:10%;width:8%;background:var(--kino-mint);
  transform-origin:bottom;transform:scaleY(var(--progress))}</style>`;
```

`env = { frame, t, progress, pulse, params, palette:{mint,green,night,white,gold,font}, width, height }`.

It runs in the browser render (no Node `process`/`fs`/env reachable) and must be a **pure `(env) → string`**:
the build lints the source and rejects `Date.now`/`Math.random`/timers/`fetch`/`import`/`require`/`process`
and direct `document`/`window` access. Reference it from the spec exactly like a `.html` graphic.
```

- [ ] **Step 7: Commit**

```bash
git add src/commands/motion.ts skills/video-production/SKILL.md docs/motion-graphics.md tests/motiongraphic.test.ts
git commit -m "docs(motion): document procedural (.js) graphics in kino motion + SKILL + docs"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests PASS, including the new `lintMotionJs`, `.js` routing, validator, and procedural render tests.

- [ ] **Step 2: Typecheck the build**

Run: `npm run build`
Expected: `tsc` completes with no errors.

- [ ] **Step 3: Smoke-test the command + an end-to-end procedural render**

Run: `node bin/kino.mjs motion | grep -i "render(env)"`
Expected: prints the procedural section lines.

Create `examples/motion-flex/proc-bars.js` (a quick manual check; not committed unless you want it):
```js
const data = [40, 75, 55, 90];
return data.map((h, i) => `<div class="bar kino-anim" style="position:absolute;bottom:12%;width:8%;left:${10 + i * 20}%;height:${h}%;background:var(--kino-mint);transform-origin:bottom;transform:scaleY(var(--progress));--kino-delay:${i * 0.08}"></div>`).join("");
```
Then render one still through the real path to confirm visually (reuse `examples/motion-flex/render-flex.ts` patterns or a one-off script pointing a `motion` segment at `proc-bars.js`). Expected: four mint bars scaling up from the baseline.

- [ ] **Step 4: Confirm the feature branch state**

Run: `git status && git log --oneline -8`
Expected: clean tree; the Tier-2 commits present on `feat/motion-procedural-tier2`. Do **not** merge — integration is a separate decision (PR/merge) after review.

---

## Self-Review

**Spec coverage** (design doc → task):
- Procedural `.js` source referenced like a Tier-1 graphic → Task 2 (routing), Task 3 (validator). ✅
- `render(env) → string` evaluated per frame in the browser → Task 4. ✅
- `env` = frame/t/progress/pulse/params/palette/width/height → Task 1 (`MotionEnv`), Task 4 (constructed). ✅
- Composes with CSS-var contract + `.kino-anim` + `.kino-cliptext` → unchanged host-var effect + `ShadowHtml` prepending `KINO_SCRUB_STYLE` (Task 4). ✅
- Determinism/safety: JS source lint → Task 2 (`lintMotionJs`) + Task 3 (validator). ✅
- `transition:none` hardening → Task 4 (Step 1) + Task 5 (Step 1 guard test). ✅
- Trusted but browser-side (no Node secrets) → Task 4 evaluates in the Remotion render; no Node-side eval. ✅
- `params` stay scalar; data in the file → reflected in docs (Task 6); no schema change. ✅
- Error in `render` → blank frame, no crash → Task 4 (try/catch) + Task 5 (Step 1 test). ✅
- Docs (`kino motion`, SKILL, motion-graphics.md) → Task 6. ✅
- Tests (unit lint/routing/validator + render) → Tasks 2, 3, 5, 6. ✅

**Placeholder scan:** none — every code/edit step shows the actual content; the only optional/uncommitted artifact is the Task 7 Step 3 manual smoke file, explicitly marked as such.

**Type consistency:** `MotionGraphicProps.proc?: string` (Task 1) is read in `resolveMotionGraphic` (Task 2), the validator path (Task 3, via `source.endsWith(".js")`), and `MotionGraphic` (Task 4). `MotionEnv` (Task 1) is the exact object built in Task 4 and named in the docs (Task 6). `lintMotionJs(src: string): string[]` has one signature, used by Task 2 and Task 3. `BANNED_JS`/`lintMotionJs` mirror the existing `BANNED`/`lintMotionHtml` shape. `palette` keys (`mint/green/night/white/gold/font`) come straight from `Theme` (which has all six).
