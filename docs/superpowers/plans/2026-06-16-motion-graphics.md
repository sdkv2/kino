# Motion Graphics (Tier 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent add a custom motion graphic to a kino video by writing a self-contained HTML/CSS file, with all timing/params owned by the JSON spec and the graphic driven deterministically by kino-set CSS variables.

**Architecture:** A new `kind:"motion"` segment (VO-timed, like avatar/app) and a `motionOverlay` field on avatar/app segments both render through one Remotion component, `MotionGraphic`, which injects the sanitized HTML into a Shadow DOM root and sets CSS custom properties (`--frame`, `--t`, `--progress`, `--pulse`, the brand palette, and one `--<name>` per JSON param) on the host every frame. The agent's CSS reads those variables (custom properties inherit across the shadow boundary). Motion is therefore a pure function of `useCurrentFrame()` + the JSON keyframes (reusing the existing `paramsAt`/`pulseAt`). HTML is read, **DOMPurify-sanitized**, and **determinism-linted** at build time (Node side); the cleaned string is baked into the Remotion props. No agent JS, no `@keyframes`, no `transition` (rejected by the lint).

**Tech Stack:** TypeScript (ESM), Remotion (React, headless Chromium), Zod (spec schema), Vitest, `isomorphic-dompurify` (new, build-time sanitizer), Commander (CLI).

**Spec:** [`docs/superpowers/specs/2026-06-16-motion-graphics-design.md`](../specs/2026-06-16-motion-graphics-design.md)

---

## File Structure

**New files:**

- `src/render/motiongraphic.ts` — Node-side, pure/testable. `lintMotionHtml` (regex denylist → violation messages), `sanitizeMotionHtml` (DOMPurify allowlist), `resolveMotionGraphic` (read file → lint → sanitize → `MotionGraphicProps`). Imported by `build.ts` and `validate.ts`. **Never imported by the Remotion bundle**, so DOMPurify stays out of the browser build.
- `src/render/remotion/MotionGraphic.tsx` — the Remotion render component (`ShadowHtml` helper + `MotionGraphic`). Bundled by esbuild. Imports only React, remotion, `props` types, and `bgparams`.
- `src/commands/motion.ts` — the `kino motion` discovery command (prints the CSS-variable contract + rules + a copyable example).
- `tests/motiongraphic.test.ts` — unit tests for lint/sanitize/resolve + schema parsing.
- `tests/render-motion.test.ts` — renders a still of a motion segment (integration/determinism).

**Modified files:**

- `src/spec/schema.ts` — `MotionGraphicRef`, a `kind:"motion"` member, and `motionOverlay` on avatar/app.
- `src/render/props.ts` — `MotionGraphicProps`; `KinoSegment.kind` gains `"motion"`; `motion?`/`motionOverlay?` fields.
- `src/spec/validate.ts` — `assertMotionGraphics`, called from `validateSpec`.
- `src/commands/build.ts` — resolve motion graphics into `renderSegments` inside `prepare`.
- `src/render/remotion/KinoVideo.tsx` — render motion segments + overlays.
- `src/cli.ts` — register `kino motion`.
- `skills/video-production/SKILL.md` — a "Motion graphics" section.
- `package.json` — add `isomorphic-dompurify`.

---

## Task 1: Sanitizer + determinism lint module

**Files:**
- Modify: `package.json` (add dependency)
- Create: `src/render/motiongraphic.ts`
- Test: `tests/motiongraphic.test.ts`

- [ ] **Step 1: Add the sanitizer dependency**

Run:
```bash
npm install isomorphic-dompurify@^2.16.0
```
Expected: `package.json` `dependencies` gains `"isomorphic-dompurify": "^2.16.0"`; install succeeds.

- [ ] **Step 2: Write the failing lint test**

Create `tests/motiongraphic.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { lintMotionHtml, sanitizeMotionHtml } from "../src/render/motiongraphic.js";

describe("lintMotionHtml", () => {
  it("passes a clean CSS-variable-driven fragment", () => {
    const html = `<style>.b{width:calc(var(--pct)*1%);color:var(--kino-mint)}</style><div class="b"></div>`;
    expect(lintMotionHtml(html)).toEqual([]);
  });
  it("rejects @keyframes", () => {
    expect(lintMotionHtml(`<style>@keyframes x{from{opacity:0}}</style>`)[0]).toMatch(/keyframes/i);
  });
  it("rejects CSS transition", () => {
    expect(lintMotionHtml(`<style>.b{transition: all .3s}</style>`)[0]).toMatch(/transition/i);
  });
  it("rejects <script>", () => {
    expect(lintMotionHtml(`<script>alert(1)</script>`)[0]).toMatch(/script/i);
  });
  it("rejects inline event handlers", () => {
    expect(lintMotionHtml(`<div onclick="x()"></div>`)[0]).toMatch(/event handler/i);
  });
  it("rejects timers/RAF and non-deterministic globals", () => {
    expect(lintMotionHtml(`<div>requestAnimationFrame</div>`).length).toBeGreaterThan(0);
    expect(lintMotionHtml(`<div>Math.random()</div>`).length).toBeGreaterThan(0);
  });
  it("rejects external/relative url() but allows data: and #fragment", () => {
    expect(lintMotionHtml(`<style>.b{background:url(https://x/y.png)}</style>`).length).toBe(1);
    expect(lintMotionHtml(`<style>.b{background:url(foo.png)}</style>`).length).toBe(1);
    expect(lintMotionHtml(`<style>.b{background:url(data:image/png;base64,AA==)}</style>`)).toEqual([]);
    expect(lintMotionHtml(`<style>.b{fill:url(#grad)}</style>`)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the lint test to verify it fails**

Run: `npx vitest run tests/motiongraphic.test.ts`
Expected: FAIL — `lintMotionHtml`/`sanitizeMotionHtml` not exported / module not found.

- [ ] **Step 4: Implement the module**

Create `src/render/motiongraphic.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import DOMPurify from "isomorphic-dompurify";
import type { MotionGraphicProps, BgKeyframe, BgTrigger, BgParamValue } from "./props.js";

// Determinism + safety denylist. Each pattern → a message that tells the agent what to do instead.
// Motion in Tier 1 comes ONLY from CSS variables (var(--progress) etc.); anything time-based or
// script-based is rejected so the rendered frame stays a pure function of useCurrentFrame().
const BANNED: { re: RegExp; msg: string }[] = [
  { re: /<script[\s>]/i, msg: "<script> is not allowed — motion comes from CSS variables, not JS" },
  { re: /\son\w+\s*=/i, msg: "inline event handlers (on*=) are not allowed" },
  { re: /@keyframes/i, msg: "@keyframes is banned in v1 — animate by reading var(--progress)/var(--t)" },
  { re: /transition\s*:/i, msg: "CSS transition is non-deterministic — drive motion from var(--progress)" },
  { re: /animation\s*:/i, msg: "CSS animation is non-deterministic in v1 — drive motion from var(--progress)" },
  { re: /\b(requestAnimationFrame|setInterval|setTimeout)\b/i, msg: "timers/RAF are not allowed — motion is frame-driven by kino" },
  { re: /\b(Date\.now|Math\.random)\b/, msg: "Date.now/Math.random break determinism" },
  { re: /\bfetch\s*\(|\bXMLHttpRequest\b/i, msg: "network access is not allowed during render" },
  { re: /url\(\s*['"]?(?!data:|#)[^)'"]/i, msg: "url(...) must be a data: URI or #fragment — external/relative refs don't resolve" },
];

// Returns a list of human-readable violations (empty = clean). Pure; no DOMPurify needed.
export function lintMotionHtml(html: string): string[] {
  return BANNED.filter((b) => b.re.test(html)).map((b) => b.msg);
}

// Robust strip of script/handlers/dangerous tags while keeping the agent's <style> + structural markup.
export function sanitizeMotionHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ["style"],
    FORBID_TAGS: ["script", "iframe", "object", "embed", "link", "meta", "base"],
    ALLOW_DATA_ATTR: true,
  });
}

export interface MotionGraphicRefInput {
  source: string;
  params?: Record<string, BgParamValue>;
  keyframes?: BgKeyframe[];
  triggers?: BgTrigger[];
}

// Read the agent's HTML file, reject on lint violations, sanitize, and attach the JSON-owned
// params/keyframes/triggers. `project` is narrowed to just the asset resolver for easy testing.
export function resolveMotionGraphic(
  ref: MotionGraphicRefInput,
  project: { assetPath(rel: string): string },
): MotionGraphicProps {
  const abs = project.assetPath(ref.source);
  if (!existsSync(abs)) throw new Error(`Missing motion graphic file: assets/${ref.source}`);
  const raw = readFileSync(abs, "utf8");
  const violations = lintMotionHtml(raw);
  if (violations.length) throw new Error(`Motion graphic assets/${ref.source}: ${violations.join("; ")}`);
  return {
    html: sanitizeMotionHtml(raw),
    params: ref.params ?? {},
    keyframes: ref.keyframes ?? [],
    triggers: ref.triggers ?? [],
  };
}
```

> Ordering note: `MotionGraphicProps` is added to `props.ts` in Task 3. The `import type { MotionGraphicProps }` here is **type-only** — Vitest (esbuild/tsx) erases it at runtime, so this task's lint/sanitize tests run standalone without the type existing yet. Do **not** run `npm run build` (tsc) until Task 3 Step 4, which is the first full typecheck. The `resolveMotionGraphic` runtime tests live in Task 3 (after the type exists).

- [ ] **Step 5: Run the lint + sanitize tests to verify they pass**

First add the sanitize test to `tests/motiongraphic.test.ts` (append inside the file):

```ts
describe("sanitizeMotionHtml", () => {
  it("strips <script> and event handlers but keeps <style> + structure", () => {
    const out = sanitizeMotionHtml(`<style>.b{color:red}</style><div class="b" onclick="x()">hi</div><script>bad()</script>`);
    expect(out).toContain("<style>");
    expect(out).toContain("hi");
    expect(out).not.toMatch(/script/i);
    expect(out).not.toMatch(/onclick/i);
  });
});
```

Run: `npx vitest run tests/motiongraphic.test.ts`
Expected: PASS (all lint + sanitize cases). If `MotionGraphicProps` import errors, do Task 3 Step 1 (the props type) first, then re-run.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/render/motiongraphic.ts tests/motiongraphic.test.ts
git commit -m "feat(motion): add HTML sanitizer + determinism lint for motion graphics"
```

---

## Task 2: Spec schema — motion segment + overlay

**Files:**
- Modify: `src/spec/schema.ts`
- Test: `tests/motiongraphic.test.ts`

- [ ] **Step 1: Write the failing schema test**

Append to `tests/motiongraphic.test.ts`:

```ts
import { SpecSchema } from "../src/spec/schema.js";

describe("SpecSchema motion graphics", () => {
  it("parses a motion segment with params/keyframes/triggers", () => {
    const spec = SpecSchema.parse({
      title: "t", segments: [
        { kind: "motion", source: "motion/stat.html", text: "eighty six percent",
          params: { pct: 0 }, keyframes: [{ at: 0.2, params: { pct: 86 }, ease: "overshoot" }],
          triggers: [{ at: 0.2, action: "pulse" }] },
      ],
    });
    expect(spec.segments[0]).toMatchObject({ kind: "motion", source: "motion/stat.html" });
  });
  it("parses a motionOverlay on an app segment", () => {
    const spec = SpecSchema.parse({
      title: "t", segments: [
        { kind: "app", asset: "screens/x.png", text: "look", caption: "c",
          motionOverlay: { source: "motion/callout.html", params: { x: 50 } } },
      ],
    });
    expect((spec.segments[0] as any).motionOverlay.source).toBe("motion/callout.html");
  });
  it("rejects a motion segment missing source", () => {
    expect(() => SpecSchema.parse({ title: "t", segments: [{ kind: "motion", text: "x" }] })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/motiongraphic.test.ts -t "SpecSchema motion"`
Expected: FAIL — `kind:"motion"` not in the union; `motionOverlay` unknown.

- [ ] **Step 3: Add the schema**

In `src/spec/schema.ts`, after the `BgTrigger` definition (line 14) add:

```ts
const motionFields = {
  source: z.string().min(1),
  params: z.record(z.union([z.number(), z.string()])).optional(),
  keyframes: z.array(BgKeyframe).optional(),
  triggers: z.array(BgTrigger).optional(),
};
const MotionGraphicRef = z.object(motionFields);
```

Add `motionOverlay: MotionGraphicRef.optional(),` to BOTH the `avatar` object (after `captionKeyframes`, line 27) and the `app` object (after `kickerKeyframes`, line 40).

Add a third member to the `Segment` discriminated union (after the `app` object, before the closing `]`):

```ts
  z.object({
    kind: z.literal("motion"),
    ...motionFields,
    text: z.string().min(1),
    caption: z.string().optional(),
    captionMode: CaptionMode.optional(),
    emphasis: z.array(z.string()).optional(),
    captionKeyframes: z.array(BgKeyframe).optional(),
  }),
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/motiongraphic.test.ts -t "SpecSchema motion"`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add src/spec/schema.ts tests/motiongraphic.test.ts
git commit -m "feat(motion): add motion segment + motionOverlay to the spec schema"
```

---

## Task 3: Props types + resolveMotionGraphic test

**Files:**
- Modify: `src/render/props.ts`
- Test: `tests/motiongraphic.test.ts`

- [ ] **Step 1: Add the prop types**

In `src/render/props.ts`:

Change `KinoSegment.kind` (line 25) to:
```ts
  kind: "avatar" | "app" | "motion";
```

Add these two fields to the `KinoSegment` interface (after `kickerKeyframes`, line 37):
```ts
  motion?: MotionGraphicProps; // resolved graphic for kind === "motion"
  motionOverlay?: MotionGraphicProps; // resolved overlay graphic layered on this beat
```

Add a new interface after `BackgroundProps` (after line 65):
```ts
// A resolved motion graphic: the sanitized HTML plus the JSON-owned timing controls.
export interface MotionGraphicProps {
  html: string; // sanitized, self-contained (markup + one inline <style>)
  params: Record<string, BgParamValue>; // base CSS-variable values
  keyframes: BgKeyframe[]; // tween params over time (--<name>)
  triggers: BgTrigger[]; // one-shot pulses (--pulse)
}
```

- [ ] **Step 2: Write the failing resolve test**

Append to `tests/motiongraphic.test.ts`:

```ts
import { resolveMotionGraphic } from "../src/render/motiongraphic.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("resolveMotionGraphic", () => {
  function projWith(file: string, contents: string) {
    const root = mkdtempSync(join(tmpdir(), "kino-mg-"));
    const abs = join(root, file);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, contents);
    return { assetPath: (rel: string) => join(root, rel) };
  }
  it("reads, sanitizes, and attaches JSON params/keyframes/triggers", () => {
    const project = projWith("motion/ok.html", `<style>.b{width:calc(var(--pct)*1%)}</style><div class="b"></div>`);
    const props = resolveMotionGraphic({ source: "motion/ok.html", params: { pct: 10 }, keyframes: [], triggers: [] }, project);
    expect(props.html).toContain("<style>");
    expect(props.params).toEqual({ pct: 10 });
  });
  it("throws a clear error for a missing file", () => {
    const project = { assetPath: (rel: string) => join("/nope", rel) };
    expect(() => resolveMotionGraphic({ source: "motion/x.html" }, project)).toThrow(/Missing motion graphic/);
  });
  it("throws listing the lint violation for a banned construct", () => {
    const project = projWith("motion/bad.html", `<style>@keyframes x{from{opacity:0}}</style>`);
    expect(() => resolveMotionGraphic({ source: "motion/bad.html" }, project)).toThrow(/keyframes/i);
  });
});
```

- [ ] **Step 3: Run to verify it fails, then passes**

Run: `npx vitest run tests/motiongraphic.test.ts -t resolveMotionGraphic`
Expected: initially FAIL if the props type was missing; after Step 1 it should PASS (3 cases). If it fails on types, run `npx tsc --noEmit` and fix.

- [ ] **Step 4: Typecheck the whole project**

Run: `npm run build`
Expected: `tsc` completes with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/render/props.ts tests/motiongraphic.test.ts
git commit -m "feat(motion): add MotionGraphicProps + motion/overlay fields to render props"
```

---

## Task 4: The MotionGraphic Remotion component

**Files:**
- Create: `src/render/remotion/MotionGraphic.tsx`

(No unit test here — DOM/Remotion behavior is covered by the render-still test in Task 7. This task just creates the component and must typecheck.)

- [ ] **Step 1: Create the component**

Create `src/render/remotion/MotionGraphic.tsx`:

```tsx
import React, { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme, MotionGraphicProps } from "../props";
import { paramsAt, pulseAt } from "../bgparams";

// Inject the sanitized HTML into a Shadow root, then set CSS custom properties on the host every
// frame. Custom properties inherit across the shadow boundary, so the agent's (shadow-scoped) CSS
// reads --frame/--t/--progress/--pulse/--<param> and the brand palette. useLayoutEffect runs sync,
// pre-paint, so Remotion captures a deterministic frame (same pattern as CanvasBackground).
const ShadowHtml: React.FC<{ html: string; vars: Record<string, string> }> = ({ html, vars }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!shadowRef.current) shadowRef.current = host.attachShadow({ mode: "open" });
    shadowRef.current.innerHTML = html;
  }, [html]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    for (const [k, v] of Object.entries(vars)) host.style.setProperty(k, v);
  });

  return <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />;
};

// Full-frame motion-graphic layer. durationFrames maps --progress 0→1 across the beat.
export const MotionGraphic: React.FC<{ data: MotionGraphicProps; durationFrames: number; t: Theme }> = ({
  data,
  durationFrames,
  t,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tt = frame / fps;
  const resolved = paramsAt(data.params, data.keyframes, tt);
  const pulse = pulseAt(data.triggers, tt);
  const progress = durationFrames > 0 ? Math.min(1, Math.max(0, frame / durationFrames)) : 0;

  const vars: Record<string, string> = {
    "--frame": String(frame),
    "--t": tt.toFixed(4),
    "--progress": progress.toFixed(4),
    "--pulse": pulse.toFixed(4),
    "--kino-green": t.green,
    "--kino-night": t.night,
    "--kino-white": t.white,
    "--kino-mint": t.mint,
    "--kino-font": t.font,
  };
  for (const [k, v] of Object.entries(resolved)) vars[`--${k}`] = String(v);

  return (
    <AbsoluteFill>
      <ShadowHtml html={data.html} vars={vars} />
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: `tsc` completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/render/remotion/MotionGraphic.tsx
git commit -m "feat(motion): add the MotionGraphic Remotion component (Shadow DOM + CSS-var binding)"
```

---

## Task 5: Build-time validation

**Files:**
- Modify: `src/spec/validate.ts`
- Test: `tests/motiongraphic.test.ts`

- [ ] **Step 1: Write the failing validation test**

Append to `tests/motiongraphic.test.ts`:

```ts
import { assertMotionGraphics } from "../src/spec/validate.js";
import type { Spec } from "../src/spec/schema.js";

describe("assertMotionGraphics", () => {
  function projWith(file: string, contents: string) {
    const root = mkdtempSync(join(tmpdir(), "kino-mgv-"));
    const abs = join(root, "assets", file);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, contents);
    return { assetPath: (rel: string) => join(root, "assets", rel) };
  }
  it("passes when every motion source exists and is clean", () => {
    const project = projWith("motion/ok.html", `<div style="width:calc(var(--progress)*100%)"></div>`);
    const spec = { segments: [{ kind: "motion", source: "motion/ok.html", text: "x" }] } as unknown as Spec;
    expect(() => assertMotionGraphics(spec, project)).not.toThrow();
  });
  it("throws for a missing overlay source", () => {
    const project = { assetPath: (rel: string) => join("/nope", rel) };
    const spec = { segments: [{ kind: "app", asset: "a.png", text: "x", caption: "c", motionOverlay: { source: "motion/missing.html" } }] } as unknown as Spec;
    expect(() => assertMotionGraphics(spec, project)).toThrow(/Missing motion graphic/);
  });
  it("throws naming the segment + violation for a banned construct", () => {
    const project = projWith("motion/bad.html", `<style>.b{transition:all .3s}</style>`);
    const spec = { segments: [{ kind: "motion", source: "motion/bad.html", text: "x" }] } as unknown as Spec;
    expect(() => assertMotionGraphics(spec, project)).toThrow(/segment\[0\].*transition/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/motiongraphic.test.ts -t assertMotionGraphics`
Expected: FAIL — `assertMotionGraphics` not exported.

- [ ] **Step 3: Implement the validator**

In `src/spec/validate.ts`, add to the imports at the top:
```ts
import { readFileSync } from "node:fs";
import { lintMotionHtml } from "../render/motiongraphic.js";
```
(`existsSync` is already imported on line 1 — extend that import to `import { existsSync, readFileSync } from "node:fs";` and remove the duplicate.)

Add this function (after `assertAssetsExist`, before `validateSpec`):
```ts
// Motion graphics: every referenced HTML file must exist and pass the determinism/safety lint.
// Runs before VO generation so a bad graphic fails the build cheaply.
export function assertMotionGraphics(spec: Spec, project: { assetPath(rel: string): string }): void {
  const refs: { source: string; where: string }[] = [];
  spec.segments.forEach((seg, i) => {
    if (seg.kind === "motion") refs.push({ source: seg.source, where: `segment[${i}]` });
    const ov = (seg as { motionOverlay?: { source?: string } }).motionOverlay;
    if (ov?.source) refs.push({ source: ov.source, where: `segment[${i}].motionOverlay` });
  });
  for (const { source, where } of refs) {
    const abs = project.assetPath(source);
    if (!existsSync(abs)) throw new Error(`Missing motion graphic for ${where}: assets/${source}`);
    const violations = lintMotionHtml(readFileSync(abs, "utf8"));
    if (violations.length) throw new Error(`Motion graphic ${where} (assets/${source}): ${violations.join("; ")}`);
  }
}
```

In `validateSpec`, add the call after `assertAssetsExist(spec, project);`:
```ts
  assertMotionGraphics(spec, project);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/motiongraphic.test.ts -t assertMotionGraphics`
Expected: PASS (3 cases).

- [ ] **Step 5: Run the full unit suite (no render) to check nothing regressed**

Run: `npx vitest run tests/motiongraphic.test.ts tests/validate.test.ts tests/spec.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/spec/validate.ts tests/motiongraphic.test.ts
git commit -m "feat(motion): validate motion-graphic files (existence + lint) before render"
```

---

## Task 6: Wire motion graphics into the build pipeline

**Files:**
- Modify: `src/commands/build.ts`

(Covered by typecheck + the render test in Task 7; `prepare` needs VO/brand/project and isn't unit-tested in isolation.)

- [ ] **Step 1: Import the resolver**

In `src/commands/build.ts`, add to the imports (near the other `../render/*` imports, ~line 19):
```ts
import { resolveMotionGraphic } from "../render/motiongraphic.js";
```

- [ ] **Step 2: Make `base.caption` tolerate an optional motion caption**

In `prepare`, in the `renderSegments` map, change the `base` object's caption line (currently `caption: seg.caption,`) to:
```ts
      caption: seg.caption ?? "",
```
(Motion segments have an optional caption; avatar/app still always provide one.)

- [ ] **Step 3: Resolve overlays for app/avatar and add the motion branch**

In the same `renderSegments` map: the `kind === "app"` branch's returned object — add the overlay:
```ts
      return {
        ...base,
        shot,
        transition,
        kickerKeyframes: seg.kickerKeyframes,
        kicker: seg.kicker
          ? { text: seg.kicker.text, color: c[seg.kicker.color], fg: KICKER_FG[seg.kicker.color] }
          : undefined,
        motionOverlay: seg.motionOverlay ? resolveMotionGraphic(seg.motionOverlay, project) : undefined,
      };
```

Replace the final `return { ...base, shot: seg.shot as Shot | undefined };` (the avatar/fallback return) with an explicit motion-vs-avatar branch:
```ts
    if (seg.kind === "motion") {
      return { ...base, motion: resolveMotionGraphic({ source: seg.source, params: seg.params, keyframes: seg.keyframes, triggers: seg.triggers }, project) };
    }
    return {
      ...base,
      shot: seg.shot as Shot | undefined,
      motionOverlay: seg.motionOverlay ? resolveMotionGraphic(seg.motionOverlay, project) : undefined,
    };
```

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: `tsc` completes with no errors. (If the discriminated-union narrowing complains, confirm `seg.kind === "motion"` is checked before accessing `seg.source`.)

- [ ] **Step 5: Commit**

```bash
git add src/commands/build.ts
git commit -m "feat(motion): resolve motion segments + overlays in the build pipeline"
```

---

## Task 7: Render motion graphics in the composition

**Files:**
- Modify: `src/render/remotion/KinoVideo.tsx`
- Test: `tests/render-motion.test.ts`

- [ ] **Step 1: Write the failing render test**

Create `tests/render-motion.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9 };
const bg = { kind: "glow" as const, image: null, customCode: null, params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 }, keyframes: [], triggers: [] };
const html = `<style>.bar{position:absolute;left:10%;bottom:20%;height:40px;width:calc(var(--pct)*1%);background:var(--kino-mint)}</style><div class="bar"></div>`;

describe("motion graphics render", () => {
  it("renders a still of a motion segment (CSS-variable bar)", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-mgr-"));
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg,
      disclosure: "test",
      segments: [
        { kind: "motion", caption: "", startSec: 0, endSec: 2,
          motion: { html, params: { pct: 0 }, keyframes: [{ at: 0.2, params: { pct: 86 } }], triggers: [] } },
      ],
    };
    const outs = await renderStills({ props, publicDir: outDir, format: "9:16", frames: [{ frame: 30, name: "mg" }], outDir });
    expect(outs).toHaveLength(1);
    expect(existsSync(outs[0]) && outs[0].endsWith(".png")).toBe(true);
  }, 180000);

  it("renders a motionOverlay on an avatar beat", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-mgo-"));
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg,
      disclosure: "test",
      segments: [
        { kind: "avatar", caption: "hook", startSec: 0, endSec: 2,
          motionOverlay: { html, params: { pct: 50 }, keyframes: [], triggers: [] } },
      ],
    };
    const outs = await renderStills({ props, publicDir: outDir, format: "9:16", frames: [{ frame: 20, name: "ov" }], outDir });
    expect(outs).toHaveLength(1);
    expect(existsSync(outs[0])).toBe(true);
  }, 180000);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/render-motion.test.ts`
Expected: FAIL — the composition ignores `motion`/`motionOverlay` (no error rendering, but to make this a true red→green, the assertions still pass because rendering doesn't crash). To force a meaningful red first, temporarily assert pixel content is non-empty is overkill; instead treat Step 2 as confirming the test *runs* and Step 4 as confirming the new render paths execute. Proceed to Step 3.

> Rationale: a still always produces a PNG even if the layer is missing, so this test guards against **crashes/regressions** in the new render paths rather than pixel output. Pixel-level determinism is left to manual `kino still` review (Task 9).

- [ ] **Step 3: Render motion segments + overlays in KinoVideo**

In `src/render/remotion/KinoVideo.tsx`:

Add to the imports (line 3 area):
```ts
import { MotionGraphic } from "./MotionGraphic";
```

After the app-segments block (the `segments.filter((s) => s.kind === "app")...` map that ends at line 64), add two new blocks:

```tsx
      {/* Full-screen motion-graphic beats. */}
      {segments
        .filter((s) => s.kind === "motion" && s.motion)
        .map((s, i) => {
          const dur = f(s.endSec) - f(s.startSec);
          return (
            <Sequence key={`m${i}`} from={f(s.startSec)} durationInFrames={dur}>
              <MotionGraphic data={s.motion!} durationFrames={dur} t={theme} />
            </Sequence>
          );
        })}

      {/* Motion-graphic overlays layered on top of their host beat (avatar or app). */}
      {segments
        .filter((s) => s.motionOverlay)
        .map((s, i) => {
          const dur = f(s.endSec) - f(s.startSec);
          return (
            <Sequence key={`mo${i}`} from={f(s.startSec)} durationInFrames={dur}>
              <MotionGraphic data={s.motionOverlay!} durationFrames={dur} t={theme} />
            </Sequence>
          );
        })}
```

(These sit above the app cut-ins and below the faceless logo + captions, so kino's captions stay legible over agent graphics.)

- [ ] **Step 4: Run the render test to verify it passes**

Run: `npx vitest run tests/render-motion.test.ts`
Expected: PASS (2 cases) — both stills produced without crashing.

- [ ] **Step 5: Commit**

```bash
git add src/render/remotion/KinoVideo.tsx tests/render-motion.test.ts
git commit -m "feat(motion): render motion segments + overlays in the composition"
```

---

## Task 8: `kino motion` discovery command

**Files:**
- Create: `src/commands/motion.ts`
- Modify: `src/cli.ts`
- Test: `tests/motiongraphic.test.ts`

- [ ] **Step 1: Write the failing command test**

Append to `tests/motiongraphic.test.ts`:

```ts
import { motionHelpText } from "../src/commands/motion.js";

describe("kino motion help", () => {
  it("documents the core CSS-variable contract and the rules", () => {
    const t = motionHelpText();
    expect(t).toMatch(/--progress/);
    expect(t).toMatch(/--pulse/);
    expect(t).toMatch(/--kino-mint/);
    expect(t).toMatch(/@keyframes/); // names what is banned
    expect(t).toMatch(/data:/); // inline assets guidance
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/motiongraphic.test.ts -t "kino motion help"`
Expected: FAIL — `motionHelpText` not found.

- [ ] **Step 3: Implement the command**

Create `src/commands/motion.ts`:

```ts
// Discovery: print the CSS-variable contract + rules an agent codes a motion-graphic HTML file
// against. Mirrors `kino backgrounds`/`kino elements`. The graphic is referenced from the spec
// (kind:"motion" or motionOverlay) and driven entirely by these kino-set variables.
export function motionHelpText(): string {
  return [
    "Motion graphics — author a self-contained HTML/CSS file in assets/motion/, reference it from",
    'the spec ({ "kind": "motion", "source": "motion/x.html", "text": "..." } or "motionOverlay").',
    "JSON owns timing; your CSS reads kino-set variables. Motion = a function of these vars:",
    "",
    "  --frame      integer frame within the beat",
    "  --t          seconds within the beat",
    "  --progress   0 → 1 across the beat (use for entrances/reveals)",
    "  --pulse      0 → 1 envelope fired by spec triggers ({ at, action:'pulse' })",
    "  --<param>    every key in the spec's params, tweened by keyframes (e.g. --pct)",
    "  --kino-green --kino-night --kino-white --kino-mint   brand palette",
    "  --kino-font  brand font family",
    "",
    "Example (a bar that grows to --pct and a title that rises in):",
    "  <style>",
    "    .bar   { position:absolute; left:8%; bottom:30%; height:48px;",
    "             width:calc(var(--pct) * 1%); background:var(--kino-mint); border-radius:8px; }",
    "    .title { position:absolute; left:8%; bottom:38%; font-family:var(--kino-font);",
    "             color:var(--kino-white); font-weight:900; font-size:64px;",
    "             opacity:var(--progress);",
    "             transform:translateY(calc((1 - var(--progress)) * 40px)); }",
    "  </style>",
    "  <div class='title'>86% match</div><div class='bar'></div>",
    "",
    "Drive it from the spec:",
    '  "params": { "pct": 0 }, "keyframes": [{ "at": 0.2, "params": { "pct": 86 }, "ease": "overshoot" }]',
    "",
    "Rules (the build rejects violations):",
    "  · No @keyframes, no CSS transition, no <script>, no JS timers/RAF, no Date.now/Math.random.",
    "    Animate by reading the variables above — kino sets them every frame.",
    "  · Inline images as data: URIs (external/relative url() won't resolve in the render).",
    "  · Sync timings to the VO with `kino inspect` (per-word start/end).",
    "",
  ].join("\n");
}

export async function motion(): Promise<void> {
  process.stdout.write(motionHelpText());
}
```

In `src/cli.ts`, after the `elements` command block (line 116), add:
```ts
program
  .command("motion")
  .description("Show how to author motion-graphic HTML files + the CSS-variable contract")
  .action(async () => (await import("./commands/motion.js")).motion());
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/motiongraphic.test.ts -t "kino motion help"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/motion.ts src/cli.ts tests/motiongraphic.test.ts
git commit -m "feat(motion): add the `kino motion` discovery command"
```

---

## Task 9: Agent docs + full verification

**Files:**
- Modify: `skills/video-production/SKILL.md`

- [ ] **Step 1: Add the SKILL.md section**

In `skills/video-production/SKILL.md`, after the "Overlay elements tween" bullet (line 59), add:

```markdown
- **Motion graphics** (`kino motion`): for a fully custom animated beat or overlay, author a
  self-contained HTML/CSS file in `assets/motion/` and reference it from the spec — a full-screen
  beat (`{ "kind": "motion", "source": "motion/x.html", "text": "spoken VO" }`) or an overlay on an
  app/avatar beat (`"motionOverlay": { "source": "motion/x.html" }`). **You write the HTML/CSS; the
  JSON owns timing.** Animate by reading kino-set CSS variables — `--progress` (0→1 over the beat),
  `--t`, `--frame`, `--pulse`, your `params` (e.g. `--pct`, tweened by `keyframes`), and the brand
  palette (`--kino-mint` etc.). **No `@keyframes`/`transition`/JS** — the build rejects them; motion
  comes only from the variables. Run `kino motion` for the full contract + a copyable example, and
  preview with `kino still`/`storyboard` like any other beat.
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all tests PASS, including `tests/motiongraphic.test.ts` and `tests/render-motion.test.ts`.

- [ ] **Step 3: Typecheck the build**

Run: `npm run build`
Expected: `tsc` completes with no errors.

- [ ] **Step 4: Smoke-test the command**

Run: `node bin/kino.mjs motion`
Expected: prints the CSS-variable contract + example (the `motionHelpText` content).

- [ ] **Step 5: Commit**

```bash
git add skills/video-production/SKILL.md
git commit -m "docs(motion): document motion graphics in the video-production skill"
```

---

## Self-Review

**Spec coverage** (design doc → task):
- New `motion` segment kind → Task 2 (schema), Task 6 (build), Task 7 (render). ✅
- `motionOverlay` on avatar/app → Task 2, Task 6, Task 7. ✅
- One shared `MotionGraphic` component (Shadow DOM + CSS-var binding) → Task 4, Task 7. ✅
- File-referenced HTML + JSON params/keyframes/triggers → Task 1 (`resolveMotionGraphic`), Task 6. ✅
- CSS-variable contract (`--frame`/`--t`/`--progress`/`--pulse`/`--<param>`/brand palette) → Task 4, Task 8. ✅
- VO-timed motion beat (carries `text`) → Task 2 (schema requires `text`), Task 6 (flows through existing VO/timeline). ✅
- DOMPurify sanitize + determinism lint, single self-contained `.html` with inline `<style>` → Task 1. ✅
- `<style>` in the allowlist → Task 1 (`ADD_TAGS:["style"]`, tested). ✅
- Fail-fast validation before VO → Task 5 (`assertMotionGraphics` in `validateSpec`). ✅
- `kino motion` command + examples → Task 8. ✅
- SKILL.md docs → Task 9. ✅
- Fast preview via existing still/storyboard → no work needed (renders through the composition); confirmed by Task 7 still test + Task 9 manual note. ✅

**Deviations from the spec (intentional, recorded):**
- The spec mentioned registering numeric vars via the CSS `@property` at-rule. **Omitted** — kino sets a concrete numeric value every frame, so there is no CSS-side interpolation to smooth; `calc(var(--pct) * 1%)` works on the plain value. Drops complexity with no behavior loss.
- Image handling tightened to **inline `data:` URIs only** for v1 (lint rejects external/relative `url()`); staging local image files referenced inside motion HTML is deferred. Pure-CSS visuals (the common case) are unaffected.
- Render-still tests assert **no-crash + PNG produced** rather than pixel content (a still always emits a PNG). Pixel-level determinism is verified by manual `kino still` review. Noted in Task 7.

**Placeholder scan:** none — every code/edit step shows the actual content.

**Type consistency:** `MotionGraphicProps` (props.ts) is the single resolved shape used by `resolveMotionGraphic` (Task 1), the `KinoSegment.motion`/`motionOverlay` fields (Task 3), and `MotionGraphic`'s `data` prop (Task 4). `MotionGraphicRefInput` (the unresolved spec shape) is distinct and used only by `resolveMotionGraphic`. `lintMotionHtml` is referenced by `motiongraphic.ts` + `validate.ts` with the same signature.
