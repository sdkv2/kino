# Scrubbed `@keyframes` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let agents author motion graphics with ordinary CSS `@keyframes`, rendered deterministically by force-pausing every animation and scrubbing `.kino-anim` elements across the beat via a `--progress`-driven negative `animation-delay`.

**Architecture:** `MotionGraphic` injects a trusted scrub stylesheet (`*{animation-play-state:paused !important}` + a `.kino-anim` rule) into every shadow root. The determinism lint flips from banning `@keyframes`/`animation` to banning only `animation-play-state` (the one declaration that could un-pause); `transition` stays banned. Safety moves from "forbid the feature" to "force-pause + forbid un-pausing."

**Tech Stack:** TypeScript (ESM), Remotion (React, headless Chromium), Vitest, ImageMagick (`magick`, already a project dep, used to sample rendered pixels), DOMPurify (already confirmed to preserve `@keyframes`).

**Spec:** [`docs/superpowers/specs/2026-06-17-motion-keyframe-scrub-design.md`](../specs/2026-06-17-motion-keyframe-scrub-design.md)

---

## File Structure

- Modify `src/render/motiongraphic.ts` — lint: drop the `@keyframes` ban, replace the broad `animation-*` ban with a `animation-play-state` ban; update the header comment.
- Modify `src/render/remotion/MotionGraphic.tsx` — add `KINO_SCRUB_STYLE` constant; prepend it when setting the shadow root's `innerHTML`.
- Modify `tests/motiongraphic.test.ts` — flip the `@keyframes`/`animation` lint assertions; add `animation-play-state` + sanitize-keeps-`@keyframes` cases; add a `kino-anim` assertion to the `kino motion` help test.
- Modify `tests/render-motion.test.ts` — add a render test that proves the scrub advances across the beat and is deterministic (center-pixel sampling).
- Modify `src/commands/motion.ts` — add a "scrubbed `@keyframes`" section; fix the "Rules" line.
- Modify `skills/video-production/SKILL.md` — fix the "No `@keyframes`" wording and point at the scrub pattern.

---

## Task 1: Lint relaxation (allow `@keyframes`, ban `animation-play-state`)

**Files:**
- Modify: `src/render/motiongraphic.ts`
- Test: `tests/motiongraphic.test.ts`

- [ ] **Step 1: Update the lint tests (flip behavior)**

In `tests/motiongraphic.test.ts`, inside `describe("lintMotionHtml", ...)`:

(a) Replace the `it("rejects @keyframes", ...)` block with:
```ts
  it("allows @keyframes (now scrubbed deterministically, not banned)", () => {
    expect(lintMotionHtml(`<style>@keyframes x{from{opacity:0}to{opacity:1}}</style>`)).toEqual([]);
  });
```

(b) Replace the `it("rejects animation longhands", ...)` block with:
```ts
  it("allows animation longhands except animation-play-state", () => {
    expect(lintMotionHtml(`<style>.b{animation-name:x;animation-delay:1s;animation-duration:2s}</style>`)).toEqual([]);
    expect(lintMotionHtml(`<style>.b{animation-play-state:running}</style>`)[0]).toMatch(/animation-play-state/i);
  });
```

(c) In the `it("rejects each remaining non-deterministic / network construct", ...)` block, **remove** the `` `<style>.b{animation:spin 1s}</style>` `` entry from the array (keep the `fetch(`, `XMLHttpRequest`, `setInterval`, `setTimeout`, `Date.now` entries).

(d) In `describe("sanitizeMotionHtml", ...)`, add:
```ts
  it("keeps @keyframes + animation-name + the kino-anim class through sanitization", () => {
    const out = sanitizeMotionHtml(`<style>@keyframes f{from{opacity:0}to{opacity:1}} .b{animation-name:f}</style><div class="b kino-anim"></div>`);
    expect(out).toContain("@keyframes");
    expect(out).toContain("animation-name");
    expect(out).toContain("kino-anim");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/motiongraphic.test.ts -t lintMotionHtml`
Expected: FAIL — `@keyframes` and `animation-name:…` still produce violations (old lint), and `animation-play-state` is NOT yet rejected.

- [ ] **Step 3: Update the lint**

In `src/render/motiongraphic.ts`, in the `BANNED` array:

Delete this line:
```ts
  { re: /@keyframes/i, msg: "@keyframes is banned in v1 — animate by reading var(--progress)/var(--t)" },
```

Replace this line:
```ts
  { re: /animation(-\w+)?\s*:/i, msg: "CSS animation is non-deterministic in v1 — drive motion from var(--progress)" },
```
with:
```ts
  { re: /animation-play-state\s*:/i, msg: "animation-play-state is managed by kino — mark the element class=\"kino-anim\"; don't override the pause" },
```

Also update the header comment block (lines ~5-7) to reflect the new model:
```ts
// Determinism + safety denylist. Each pattern → a message that tells the agent what to do instead.
// Motion comes from CSS variables or from @keyframes that kino force-pauses + scrubs (see the
// .kino-anim scrub injected by MotionGraphic). The render pauses ALL animations, so the only
// animation declaration that could break determinism — animation-play-state — is rejected here;
// CSS transition (no pause/scrub equivalent) is also rejected.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/motiongraphic.test.ts`
Expected: PASS (all cases, including the flipped lint + sanitize cases). The `transition` and SVG SMIL rejection tests still pass unchanged.

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/render/motiongraphic.ts tests/motiongraphic.test.ts
git commit -m "feat(motion): allow @keyframes in the lint, ban only animation-play-state"
```

---

## Task 2: Inject the scrub stylesheet + verify the scrub renders deterministically

**Files:**
- Modify: `src/render/remotion/MotionGraphic.tsx`
- Test: `tests/render-motion.test.ts`

- [ ] **Step 1: Write the failing render test**

In `tests/render-motion.test.ts`, add this import near the top (with the other `node:` imports):
```ts
import { execSync } from "node:child_process";
```
Then add this block (the existing `theme` and `bg` consts at the top of the file are reused; do NOT redeclare them, and name the local HTML `scrubHtml` to avoid colliding with the file's existing `html` const):
```ts
const sampleCenter = (png: string) => execSync(`magick "${png}" -format "%[pixel:p{540,960}]" info:`).toString().trim();

describe("motion graphics @keyframes scrub", () => {
  it("scrubs a .kino-anim @keyframes across the beat, deterministically", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-scrub-"));
    // opaque full-frame background fading #000 → #0f0 over the animation; sampling the centre pixel
    // tells us where the scrub is. .kino-anim makes kino pause + scrub it by --progress.
    const scrubHtml = `<style>@keyframes fade{from{background:#000000}to{background:#00ff00}} .bg{position:absolute;inset:0;animation-name:fade}</style><div class="bg kino-anim"></div>`;
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg,
      disclosure: "test",
      segments: [{ kind: "motion", caption: "", startSec: 0, endSec: 2,
        motion: { html: scrubHtml, params: {}, keyframes: [], triggers: [] } }],
    };
    // beat 0..2s = 60 frames; --progress ≈ localFrame/60. frame 6 → ~10% (dark), frame 54 → ~90% (green).
    const outs = await renderStills({ props, publicDir: outDir, format: "9:16",
      frames: [{ frame: 6, name: "early" }, { frame: 54, name: "late" }, { frame: 54, name: "late2" }], outDir });
    const early = sampleCenter(outs[0]);
    const late = sampleCenter(outs[1]);
    const late2 = sampleCenter(outs[2]);
    expect(early).not.toBe(late); // the paused animation is scrubbed forward across the beat
    expect(late).toBe(late2);     // same frame twice → identical pixels (deterministic)
  }, 180000);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/render-motion.test.ts -t scrub`
Expected: FAIL — without the injected scrub stylesheet the animation isn't paused/scrubbed by `--progress`, so `early` and `late` sample the same (un-advanced) state and `expect(early).not.toBe(late)` fails (or the value is wall-clock-nondeterministic). Either way it does not pass.

- [ ] **Step 3: Inject the scrub stylesheet**

In `src/render/remotion/MotionGraphic.tsx`, add this module-level constant above the `ShadowHtml` component:
```tsx
// Trusted stylesheet injected into every motion-graphic shadow root: pause ALL animations so none
// run on the wall clock (determinism), and scrub elements marked `.kino-anim` across the beat via a
// --progress-driven negative animation-delay (the canonical Remotion scrub). Inert when the agent's
// HTML defines no animations. --kino-delay (agent-set, default 0) staggers; sub-timing lives in the
// @keyframes % stops; easing is the agent's via their timing-function.
const KINO_SCRUB_STYLE =
  "<style>*{animation-play-state:paused !important}" +
  ".kino-anim{animation-duration:1s !important;animation-fill-mode:both !important;" +
  "animation-iteration-count:1 !important;" +
  "animation-delay:calc((var(--progress) - var(--kino-delay, 0)) * -1s) !important}</style>";
```
Then change the injection line inside `ShadowHtml`'s first `useLayoutEffect` from:
```tsx
    shadowRef.current.innerHTML = html;
```
to:
```tsx
    shadowRef.current.innerHTML = KINO_SCRUB_STYLE + html;
```

- [ ] **Step 4: Run the render test to verify it passes**

Run: `npx vitest run tests/render-motion.test.ts`
Expected: PASS — `early` (dark, ~`srgb(0,26,0)`) differs from `late` (green, ~`srgb(0,230,0)`), and `late` equals `late2`. The pre-existing render-motion tests still pass.

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/render/remotion/MotionGraphic.tsx tests/render-motion.test.ts
git commit -m "feat(motion): inject the paused-animation scrub stylesheet (.kino-anim)"
```

---

## Task 3: Docs + final verification

**Files:**
- Modify: `src/commands/motion.ts`
- Modify: `skills/video-production/SKILL.md`
- Test: `tests/motiongraphic.test.ts`

- [ ] **Step 1: Add a `kino motion` test assertion for the scrub section**

In `tests/motiongraphic.test.ts`, in the `describe("kino motion help", ...)` test, add:
```ts
    expect(t).toMatch(/kino-anim/); // the @keyframes scrub recipe
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/motiongraphic.test.ts -t "kino motion help"`
Expected: FAIL — `kino-anim` not yet in the help text.

- [ ] **Step 3: Add the scrub section + fix the Rules line in `kino motion`**

In `src/commands/motion.ts`, insert this block immediately before the `"Rules (the build rejects violations):",` line:
```ts
    "Use real @keyframes (kino scrubs them across the beat — add class=\"kino-anim\"):",
    "  <style>@keyframes pop{0%{transform:scale(.6);opacity:0} 60%{transform:scale(1.06)}",
    "                        100%{transform:scale(1);opacity:1}}",
    "         .badge{animation-name:pop}</style>",
    "  <div class='badge kino-anim'>NEW</div>",
    "  · The animation plays 0→100% across the whole beat — put sub-timing in the % stops.",
    "  · Stagger items with --kino-delay (pairs with sibling-index):",
    "      .kw{ --kino-delay: calc((sibling-index() - 1) * .1); }",
    "  · Don't set animation-play-state — kino manages pausing. (CSS transition is still not allowed.)",
    "",
```

Then replace the first Rules bullet:
```ts
    "  · No @keyframes, no CSS transition, no <script>, no JS timers/RAF, no Date.now/Math.random.",
    "    Animate by reading the variables above — kino sets them every frame.",
```
with:
```ts
    "  · No CSS transition, no <script>, no JS timers/RAF, no Date.now/Math.random, and don't set",
    "    animation-play-state. Use CSS variables or .kino-anim @keyframes — both are frame-driven.",
```

- [ ] **Step 4: Run to verify the help test passes**

Run: `npx vitest run tests/motiongraphic.test.ts -t "kino motion help"`
Expected: PASS.

- [ ] **Step 5: Update SKILL.md**

In `skills/video-production/SKILL.md`, in the motion-graphics bullet, replace:
```markdown
  palette (`--kino-mint` etc.). **No `@keyframes`/`transition`/JS** — the build rejects them; motion
```
with:
```markdown
  palette (`--kino-mint` etc.). You can also use real **`@keyframes`** — add `class="kino-anim"` and
  kino force-pauses + scrubs them across the beat deterministically (sub-timing in the `%` stops,
  stagger via `--kino-delay`). **No CSS `transition`/JS and don't set `animation-play-state`** — motion
```

- [ ] **Step 6: Full verification**

Run: `npm test`
Expected: all tests pass (including the flipped lint cases, the scrub render test, and the `kino motion` help test). If any fail, STOP and report.

Run: `npm run build`
Expected: tsc clean.

Run: `node bin/kino.mjs motion | sed -n '/kino-anim/,+2p'`
Expected: prints the scrub example lines (the `@keyframes` / `class="kino-anim"` recipe).

- [ ] **Step 7: Commit**

```bash
git add src/commands/motion.ts skills/video-production/SKILL.md tests/motiongraphic.test.ts
git commit -m "docs(motion): document scrubbed @keyframes (.kino-anim) in kino motion + SKILL"
```

---

## Self-Review

**Spec coverage** (design → task):
- Injected scrub stylesheet (`*{paused}` + `.kino-anim` delay/duration/fill/iteration) → Task 2. ✅
- `--kino-delay` stagger default 0, composes with `sibling-index()` → in `KINO_SCRUB_STYLE` (Task 2) + docs (Task 3). ✅
- Lint: drop `@keyframes` ban, ban `animation-play-state`, keep `transition`/SMIL/etc. → Task 1. ✅
- Render injection in `ShadowHtml` (trusted, not sanitized) → Task 2. ✅
- Docs in `kino motion` + SKILL → Task 3. ✅
- Lint test flips (`@keyframes`/`animation` allowed; `animation-play-state` rejected) → Task 1 Step 1. ✅
- Render test: different poses early vs late + identical across same-frame renders → Task 2. ✅
- DOMPurify keeps `@keyframes` → Task 1 Step 1(d) locks it in with a sanitize test. ✅ (Already verified empirically.)
- Backward compatibility: existing CSS-variable graphics define no animations → the global pause is a no-op; the existing render-motion tests still pass (re-run in Task 2 Step 4 + Task 3 Step 6). ✅

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `KINO_SCRUB_STYLE` is a module constant used only in `MotionGraphic.tsx`. The lint rule name `animation-play-state` is consistent across the lint regex (Task 1), the test assertion (Task 1), and the docs (Task 3). The render test reuses the file's existing `theme`/`bg` consts and names its local HTML `scrubHtml` to avoid colliding with the existing `html` const.
