# GL Compositor Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure whether a full-frame WebGL compositor is viable in kino before any production code is written, and publish a REPORT with a go / redesign / stop verdict.

**Architecture:** Throwaway measurement code on a scratch branch. Six measurements (M1–M6) from `docs/superpowers/specs/2026-07-25-gl-compositor-design.md`, each producing numbers written into one REPORT. Only the M4 scanner is real tested code; everything else is a benchmark script deleted after the report lands.

**Tech Stack:** Node 22, TypeScript (strict), puppeteer (already a dependency via the render engine), esbuild (devDependency), vitest, ImageMagick (`magick` on PATH — already required by the existing pixel tests).

## Global Constraints

- The spike branch is **never merged**. Only the REPORT markdown file is cherry-picked to a doc branch.
- No file under `src/render/native/page/` that ships today may be modified except `engine.ts` timing instrumentation, which is behind `KINO_TIMING=1` and defaults off.
- All measurements run at 1080×1920 (`9:16`), the project's default format.
- Benchmarks report **p50 and p95 over at least 60 samples**, never a single timing.
- The CLI runs compiled `dist/`, not `src/` — run `npm run build` after editing source, or new fields are silently stripped.
- Decision criteria are fixed by the spec and must not be renegotiated after seeing numbers:
  - **Proceed** if projected compositor per-frame time is ≤ 1.25× baseline on the worst-case spec and ≤ 1.0× on the typical one, and M3 shows no visible text degradation.
  - **Redesign** if dynamic full-screen raster dominates.
  - **Stop** if M6 shows color or alpha differences that cannot be reconciled.

---

### Task 1: Scratch branch and REPORT skeleton

**Files:**
- Create: `docs/superpowers/specs/2026-07-25-gl-compositor-spike-REPORT.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the REPORT file every later task appends its numbers to.

- [ ] **Step 1: Create the scratch branch**

```bash
git checkout -b spike/gl-compositor
```

- [ ] **Step 2: Write the REPORT skeleton**

Create `docs/superpowers/specs/2026-07-25-gl-compositor-spike-REPORT.md`:

```markdown
# GL compositor spike — REPORT

**Spec:** docs/superpowers/specs/2026-07-25-gl-compositor-design.md
**Branch:** spike/gl-compositor
**Machine:** <cpu model, core count, OS version, GL backend from `resolveGL`>

## Verdict

<proceed | redesign | stop — filled in by Task 8>

## M1 — DOM-path baseline per-frame wall time

| Spec | Frames | resolve p50 | resolve p95 | capture p50 | capture p95 | total p50 |
|---|---|---|---|---|---|---|

## M2 — `html` raster cost

| Subject | SS | p50 ms | p95 ms |
|---|---|---|---|

## M3 — Raster fidelity

| Subject | meanDiff vs DOM | visual notes |
|---|---|---|

## M4 — External references in motion HTML

| Corpus | Specs scanned | Specs with external refs | Distinct refs |
|---|---|---|---|

## M5 — Capture path

| Method | p50 ms | p95 ms | bytes/frame |
|---|---|---|---|

## M6 — Color and alpha parity

| Case | meanDiff GL vs DOM | reconcilable |
|---|---|---|

## Projection

<per-frame compositor estimate derived from M1/M2/M5, with the arithmetic shown>
```

- [ ] **Step 3: Record the machine line**

Run:

```bash
node -e "const os=require('os');console.log(os.cpus()[0].model, '|', os.cpus().length, 'cores |', os.type(), os.release())"
```

Paste the output into the `**Machine:**` line. Add the GL backend by running:

```bash
node -e "import('./dist/render/native/browser.js').then(m=>console.log('GL backend:', m.resolveGL()))"
```

If `dist/` does not exist yet, run `npm run build` first.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-25-gl-compositor-spike-REPORT.md
git commit -s -m "spike: REPORT skeleton for the GL compositor measurements"
```

---

### Task 2: M1 — baseline per-frame timing instrumentation

**Files:**
- Modify: `src/render/native/engine.ts` (add timing around the seek/shot pair in the worker loop)
- Create: `scripts/spike/percentiles.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `pct(samples: number[], p: number): number` from `scripts/spike/percentiles.mjs`, used by Tasks 3, 5 and 6.

- [ ] **Step 1: Write the percentile helper**

Create `scripts/spike/percentiles.mjs`:

```js
// Nearest-rank percentile. Shared by every spike benchmark so the REPORT's numbers
// are computed one way.
export function pct(samples, p) {
  if (!samples.length) throw new Error("pct() needs at least one sample");
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export function summarize(label, samples) {
  return `${label}: n=${samples.length} p50=${pct(samples, 50).toFixed(1)}ms p95=${pct(samples, 95).toFixed(1)}ms`;
}
```

- [ ] **Step 2: Add the timing hook to the engine**

In `src/render/native/engine.ts`, find the worker loop where each frame is produced — the call site that invokes `handle.seek(frame)` followed by `handle.shot()`. Wrap both calls:

```ts
const timing = process.env.KINO_TIMING === "1";
const t0 = timing ? performance.now() : 0;
await handle.seek(frame);
const t1 = timing ? performance.now() : 0;
const buf = await handle.shot();
if (timing) {
  const t2 = performance.now();
  process.stderr.write(`KINO_TIMING frame=${frame} resolve=${(t1 - t0).toFixed(2)} capture=${(t2 - t1).toFixed(2)}\n`);
}
```

Keep the existing assignment of `buf` intact — this only adds timestamps around it.

- [ ] **Step 3: Verify the hook is inert when the flag is off**

Run:

```bash
npm run build && npx vitest run tests/engine-pipeline.test.ts
```

Expected: PASS, and no `KINO_TIMING` lines in the output.

- [ ] **Step 4: Choose the two measurement specs**

Pick from `examples/` or `demos/`:
- **typical** — a build with a shader or canvas2d background, word captions, and one video cut-in.
- **worst case** — a build whose motion beats dominate the timeline (a motion graphic on screen for most frames).

Record the two chosen spec paths in the REPORT under M1 so the numbers are reproducible.

- [ ] **Step 5: Run both baselines**

```bash
KINO_TIMING=1 KINO_CONCURRENCY=1 npx kino build <typical-spec.json> --draft 2> /tmp/kino-m1-typical.log
```

```bash
KINO_TIMING=1 KINO_CONCURRENCY=1 npx kino build <worst-case-spec.json> --draft 2> /tmp/kino-m1-worst.log
```

`KINO_CONCURRENCY=1` is required: with a worker pool the wall-clock per frame overlaps across workers and the numbers become meaningless.

- [ ] **Step 6: Summarize into the REPORT**

```bash
node -e "
import('./scripts/spike/percentiles.mjs').then(({pct})=>{
  const fs=require('fs');
  for (const f of ['/tmp/kino-m1-typical.log','/tmp/kino-m1-worst.log']) {
    const rows=fs.readFileSync(f,'utf8').split('\n').filter(l=>l.startsWith('KINO_TIMING'));
    const g=(k)=>rows.map(l=>parseFloat(l.match(new RegExp(k+'=([0-9.]+)'))[1]));
    const r=g('resolve'), c=g('capture');
    console.log(f, 'n='+rows.length,
      'resolve p50='+pct(r,50).toFixed(1), 'p95='+pct(r,95).toFixed(1),
      'capture p50='+pct(c,50).toFixed(1), 'p95='+pct(c,95).toFixed(1),
      'total p50='+(pct(r,50)+pct(c,50)).toFixed(1));
  }
});
"
```

Paste both rows into the M1 table.

- [ ] **Step 7: Commit**

```bash
git add scripts/spike/percentiles.mjs src/render/native/engine.ts docs/superpowers/specs/2026-07-25-gl-compositor-spike-REPORT.md
git commit -s -m "spike(M1): per-frame timing instrumentation and DOM-path baseline"
```

---

### Task 3: M2 — `html` raster cost benchmark

**Files:**
- Create: `src/render/native/page/spike-entry.ts`
- Create: `scripts/spike/raster-bench.mjs`

**Interfaces:**
- Consumes: `pct`, `summarize` from `scripts/spike/percentiles.mjs`.
- Produces: nothing later tasks import; writes M2 rows into the REPORT.

The existing page bundle is an IIFE with no exports, so the benchmark needs its own tiny entry that puts the raster functions on `window`.

- [ ] **Step 1: Write the spike page entry**

Create `src/render/native/page/spike-entry.ts`:

```ts
// SPIKE ONLY — never shipped. Exposes the raster path on window so a puppeteer
// benchmark can time buildTemplate/rasterAt directly.
import { buildTemplate, rasterAt, scrubCss } from "./bgTextures";
import type { KinoProps } from "../props.js";

declare global {
  interface Window {
    __spike: {
      buildTemplate: typeof buildTemplate;
      rasterAt: typeof rasterAt;
      scrubCss: typeof scrubCss;
    };
  }
}

window.__spike = { buildTemplate, rasterAt, scrubCss };
```

If `buildTemplate`, `rasterAt` or `scrubCss` are not exported from `bgTextures.ts`, add `export` to their declarations — that is a spike-branch-only edit and is reverted with the branch.

- [ ] **Step 2: Write the benchmark**

Create `scripts/spike/raster-bench.mjs`:

```js
// M2: how long does one foreignObject raster take, at composition size?
import { build } from "esbuild";
import puppeteer from "puppeteer";
import { pct, summarize } from "./percentiles.mjs";

const W = 1080, H = 1920, N = 60;

const THEME = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
};

// A full-screen motion graphic whose CSS reads frame vars — the `dynamic` worst case.
const MOTION = `<style>
.card{position:absolute;left:8%;right:8%;top:30%;bottom:30%;border-radius:48px;
  background:linear-gradient(135deg,#0c8d64,#80e2b4);
  transform:translateY(calc(var(--progress,0) * -40px)) scale(calc(1 + var(--progress,0) * 0.06));}
.h{position:absolute;inset:0;display:grid;place-items:center;font:700 96px Arial;color:#fff}
</style><div class="card"></div><div class="h">Ship faster</div>`;

// One caption line — the `keyed` case.
const CAPTION = `<style>.c{font:800 74px Arial;color:#fff;-webkit-text-stroke:9px #0b1020;
  paint-order:stroke fill;text-align:center}</style><div class="c">deterministic by design</div>`;

const bundle = await build({
  entryPoints: ["src/render/native/page/spike-entry.ts"],
  bundle: true, write: false, format: "iife", platform: "browser",
  target: "chrome120", jsx: "automatic", logLevel: "silent",
});
const js = bundle.outputFiles[0].text;

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.setContent("<!doctype html><body style='margin:0'></body>");
await page.addScriptTag({ content: js });

for (const [label, html, size] of [
  ["motion-fullscreen", MOTION, { w: W, h: H }],
  ["caption-line", CAPTION, null],
]) {
  for (const scale of [1, 2]) {
    const samples = await page.evaluate(
      async (html, theme, size, scale, n) => {
        const tpl = await window.__spike.buildTemplate(html, theme, { size: size ?? undefined, scale });
        const out = [];
        for (let i = 0; i < n; i++) {
          // A distinct scrub value every iteration and a null cache — the dynamic
          // cadence, where no raster is ever reused.
          const css = window.__spike.scrubCss(i / 30);
          const t0 = performance.now();
          await window.__spike.rasterAt(tpl, String(i), css, null);
          out.push(performance.now() - t0);
        }
        return out;
      },
      html, THEME, size, scale, N,
    );
    console.log(summarize(`${label} SS=${scale}`, samples));
  }
}

await browser.close();
```

- [ ] **Step 3: Run the benchmark**

```bash
node scripts/spike/raster-bench.mjs
```

Expected: four lines of the form `motion-fullscreen SS=1: n=60 p50=…ms p95=…ms`.

- [ ] **Step 4: Record into the REPORT**

Paste all four rows into the M2 table.

- [ ] **Step 5: Commit**

```bash
git add src/render/native/page/spike-entry.ts scripts/spike/raster-bench.mjs docs/superpowers/specs/2026-07-25-gl-compositor-spike-REPORT.md
git commit -s -m "spike(M2): foreignObject raster cost at composition size"
```

---

### Task 4: M3 — raster fidelity against the DOM path

**Files:**
- Create: `scripts/spike/raster-fidelity.mjs`

**Interfaces:**
- Consumes: the `window.__spike` entry from Task 3.
- Produces: PNG pairs in `/tmp/kino-m3/` plus meanDiff numbers for the REPORT.

- [ ] **Step 1: Write the fidelity script**

Create `scripts/spike/raster-fidelity.mjs`:

```js
// M3: does a foreignObject raster of a subtree match what Chromium paints for the
// same subtree? Text edges are the thing that matters.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer";

const W = 1080, H = 1920, OUT = "/tmp/kino-m3";
mkdirSync(OUT, { recursive: true });

const THEME = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
};

const CASES = {
  "caption-stroke": `<style>.c{position:absolute;inset:0;display:grid;place-items:center;
    font:800 74px Arial;color:#fff;-webkit-text-stroke:9px #0b1020;paint-order:stroke fill}
    </style><div class="c">deterministic by design</div>`,
  "small-label": `<style>.l{position:absolute;inset:0;display:grid;place-items:center;
    font:500 28px Arial;color:#80e2b4;letter-spacing:0.08em}
    </style><div class="l">RENDERED FROM A SPEC</div>`,
  "gradient-card": `<style>.g{position:absolute;left:10%;right:10%;top:35%;bottom:35%;
    border-radius:48px;background:linear-gradient(135deg,#0c8d64,#d99a20)}
    </style><div class="g"></div>`,
};

const bundle = await build({
  entryPoints: ["src/render/native/page/spike-entry.ts"],
  bundle: true, write: false, format: "iife", platform: "browser",
  target: "chrome120", jsx: "automatic", logLevel: "silent",
});

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });

for (const [name, html] of Object.entries(CASES)) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });

  // A: what Chromium paints today.
  await page.setContent(
    `<!doctype html><body style="margin:0;width:${W}px;height:${H}px;background:#0b1020">
     <div style="position:relative;width:${W}px;height:${H}px">${html}</div></body>`,
  );
  await page.screenshot({ path: `${OUT}/${name}-dom.png` });

  // B: the same subtree through the raster path, drawn onto the same backdrop.
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const dataUrl = await page.evaluate(
    async (html, theme, w, h) => {
      const tpl = await window.__spike.buildTemplate(html, theme, { size: { w, h }, scale: 2 });
      const raster = await window.__spike.rasterAt(tpl, "fid", "", null);
      const out = document.createElement("canvas");
      out.width = w; out.height = h;
      const ctx = out.getContext("2d");
      ctx.fillStyle = "#0b1020";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(raster, 0, 0, w, h);
      return out.toDataURL("image/png");
    },
    html, THEME, W, H,
  );
  writeFileSync(`${OUT}/${name}-raster.png`, Buffer.from(dataUrl.split(",")[1], "base64"));

  const meanDiff = execFileSync("magick", [
    `${OUT}/${name}-dom.png`, `${OUT}/${name}-raster.png`,
    "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:",
  ]).toString().trim();
  console.log(`${name}: meanDiff=${meanDiff}`);
  await page.close();
}

await browser.close();
console.log(`PNG pairs in ${OUT} — open them and look at the text edges.`);
```

- [ ] **Step 2: Run it**

```bash
node scripts/spike/raster-fidelity.mjs
```

Expected: three `meanDiff=…` lines and six PNGs in `/tmp/kino-m3/`.

- [ ] **Step 3: Look at the PNGs**

Open `caption-stroke-dom.png` and `caption-stroke-raster.png` side by side at 100% zoom. The question the REPORT must answer in words, not numbers: **is stroked caption text visibly softer, thinner, or differently kerned in the raster?** A meanDiff under 0.01 with visibly mushy text is still a failure — M3's gate is visual.

- [ ] **Step 4: Record into the REPORT**

Fill the M3 table with one row per case: the meanDiff and a one-sentence visual note.

- [ ] **Step 5: Commit**

```bash
git add scripts/spike/raster-fidelity.mjs docs/superpowers/specs/2026-07-25-gl-compositor-spike-REPORT.md
git commit -s -m "spike(M3): raster fidelity against the DOM path"
```

---

### Task 5: M4 — external-reference scanner

**Files:**
- Create: `scripts/spike/scan-external-refs.mjs`
- Test: `tests/spike-external-refs.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `findExternalRefs(html: string): string[]` — exported from `scripts/spike/scan-external-refs.mjs`. This is the one piece of spike code that may graduate into `inline.ts` in the core plan, so it is written test-first.

- [ ] **Step 1: Write the failing test**

Create `tests/spike-external-refs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { findExternalRefs } from "../scripts/spike/scan-external-refs.mjs";

describe("findExternalRefs", () => {
  it("finds img src attributes", () => {
    expect(findExternalRefs(`<img src="/public/shot.png">`)).toEqual(["/public/shot.png"]);
  });

  it("finds CSS url() references in style blocks and attributes", () => {
    const html = `<style>.a{background:url("/public/bg.jpg")}</style><div style="background:url(/public/x.svg)"></div>`;
    expect(findExternalRefs(html).sort()).toEqual(["/public/bg.jpg", "/public/x.svg"]);
  });

  it("ignores data: URLs — they already survive the raster", () => {
    expect(findExternalRefs(`<img src="data:image/png;base64,AAAA">`)).toEqual([]);
  });

  it("ignores in-document SVG fragment references", () => {
    expect(findExternalRefs(`<div style="filter:url(#kino-glow)"></div>`)).toEqual([]);
  });

  it("deduplicates repeats", () => {
    expect(findExternalRefs(`<img src="/public/a.png"><img src="/public/a.png">`)).toEqual(["/public/a.png"]);
  });

  it("returns empty for markup with no external references", () => {
    expect(findExternalRefs(`<div style="background:#0b1020">hi</div>`)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/spike-external-refs.test.ts
```

Expected: FAIL — cannot resolve `scripts/spike/scan-external-refs.mjs`.

- [ ] **Step 3: Write the scanner**

Create `scripts/spike/scan-external-refs.mjs`:

```js
// M4: which references inside motion HTML would vanish in a foreignObject raster?
// SVG-as-image runs in a restricted mode: no external fetches. data: URLs and
// in-document fragment refs (#id) survive; everything else does not.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const IMG_SRC = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
const CSS_URL = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;

export function findExternalRefs(html) {
  const found = new Set();
  const add = (ref) => {
    const r = ref.trim();
    if (!r || r.startsWith("data:") || r.startsWith("#")) return;
    found.add(r);
  };
  for (const m of html.matchAll(IMG_SRC)) add(m[1]);
  for (const m of html.matchAll(CSS_URL)) add(m[1]);
  return [...found];
}

// --- corpus scan -------------------------------------------------------------

// Every place a spec's motion markup can live. `html` on a motion beat or overlay,
// and `html` on a region-shader texture channel.
function motionHtmlIn(spec) {
  const out = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node.html === "string") out.push(node.html);
    Object.values(node).forEach(visit);
  };
  visit(spec);
  return out;
}

function walkJson(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e === "node_modules" || e === ".git" || e === "out") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkJson(p, acc);
    else if (e.endsWith(".json")) acc.push(p);
  }
  return acc;
}

if (process.argv[1]?.endsWith("scan-external-refs.mjs")) {
  const corpora = ["examples", "demos", "projects", "assets-lib"];
  for (const corpus of corpora) {
    const files = walkJson(corpus);
    let specsWithHtml = 0, specsWithRefs = 0;
    const refs = new Set();
    for (const f of files) {
      let spec;
      try {
        spec = JSON.parse(readFileSync(f, "utf8"));
      } catch {
        continue;
      }
      const htmls = motionHtmlIn(spec);
      if (!htmls.length) continue;
      specsWithHtml++;
      const found = htmls.flatMap(findExternalRefs);
      if (found.length) {
        specsWithRefs++;
        found.forEach((r) => refs.add(r));
        console.log(`  ${f}: ${found.join(", ")}`);
      }
    }
    console.log(`${corpus}: ${files.length} json, ${specsWithHtml} with motion html, ${specsWithRefs} with external refs, ${refs.size} distinct refs`);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/spike-external-refs.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Scan the corpus**

```bash
node scripts/spike/scan-external-refs.mjs
```

Expected: one summary line per corpus, plus a detail line per offending spec.

- [ ] **Step 6: Record into the REPORT**

Fill the M4 table. Then write one sentence of interpretation: if more than a handful of specs carry external refs, `inline.ts` is a first-class piece of the core plan rather than a footnote, and the core plan's Task 12 estimate goes up.

- [ ] **Step 7: Commit**

```bash
git add scripts/spike/scan-external-refs.mjs tests/spike-external-refs.test.ts docs/superpowers/specs/2026-07-25-gl-compositor-spike-REPORT.md
git commit -s -m "spike(M4): external-reference scanner and corpus blast radius"
```

---

### Task 6: M5 — capture path comparison

**Files:**
- Create: `scripts/spike/capture-bench.mjs`

**Interfaces:**
- Consumes: `pct`, `summarize` from `scripts/spike/percentiles.mjs`.
- Produces: M5 rows.

- [ ] **Step 1: Write the benchmark**

Create `scripts/spike/capture-bench.mjs`:

```js
// M5: with the page reduced to a single canvas, which way out is cheaper —
// Chromium's JPEG screenshot, or readPixels plus a base64 hop over CDP?
import puppeteer from "puppeteer";
import { pct, summarize } from "./percentiles.mjs";

const W = 1080, H = 1920, N = 60;

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.setContent(
  `<!doctype html><body style="margin:0"><canvas id="c" width="${W}" height="${H}"
   style="width:100%;height:100%"></canvas></body>`,
);

// A canvas that actually changes per frame, so nothing can be cached away.
await page.evaluate((w, h) => {
  const gl = document.getElementById("c").getContext("webgl2", {
    preserveDrawingBuffer: true, premultipliedAlpha: true, antialias: false,
  });
  window.__draw = (i) => {
    gl.viewport(0, 0, w, h);
    gl.clearColor((i % 60) / 60, 0.3, 0.6, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.finish();
  };
}, W, H);

const cdp = [], read = [];
let cdpBytes = 0, readBytes = 0;

for (let i = 0; i < N; i++) {
  await page.evaluate((n) => window.__draw(n), i);
  const a = performance.now();
  const buf = await page.screenshot({ type: "jpeg", quality: 95 });
  cdp.push(performance.now() - a);
  cdpBytes = buf.length;

  await page.evaluate((n) => window.__draw(n), i);
  const b = performance.now();
  const dataUrl = await page.evaluate(() => document.getElementById("c").toDataURL("image/jpeg", 0.95));
  read.push(performance.now() - b);
  readBytes = Buffer.from(dataUrl.split(",")[1], "base64").length;
}

console.log(summarize("cdp-screenshot", cdp), `bytes=${cdpBytes}`);
console.log(summarize("canvas-toDataURL", read), `bytes=${readBytes}`);
await browser.close();
```

`toDataURL` is measured rather than raw `readPixels` because the pixels still have to cross the CDP boundary and be encoded; a raw `readPixels` timing would flatter the option by hiding both costs.

- [ ] **Step 2: Run it**

```bash
node scripts/spike/capture-bench.mjs
```

Expected: two summary lines with p50/p95 and bytes per frame.

- [ ] **Step 3: Record into the REPORT and commit**

Fill the M5 table, then:

```bash
git add scripts/spike/capture-bench.mjs docs/superpowers/specs/2026-07-25-gl-compositor-spike-REPORT.md
git commit -s -m "spike(M5): capture path comparison"
```

---

### Task 7: M6 — color and alpha parity

**Files:**
- Create: `scripts/spike/color-parity.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: the M6 table — the measurement that can **stop** the project.

- [ ] **Step 1: Write the parity script**

Create `scripts/spike/color-parity.mjs`:

```js
// M6: does GL compositing in sRGB reproduce what CSS compositing does? Two cases:
// a 50% white plate over a gradient (straight alpha blend), and antialiased text
// over the same gradient (per-pixel coverage alpha).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer";

const W = 1080, H = 1920, OUT = "/tmp/kino-m6";
mkdirSync(OUT, { recursive: true });

const GRADIENT = "linear-gradient(160deg,#0b1020 0%,#0c8d64 55%,#d99a20 100%)";

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });

// A: CSS composites the plate over the gradient.
await page.setContent(
  `<!doctype html><body style="margin:0">
   <div style="position:absolute;inset:0;background:${GRADIENT}"></div>
   <div style="position:absolute;left:12%;right:12%;top:40%;bottom:40%;
        background:rgba(255,255,255,0.5)"></div>
   <div style="position:absolute;inset:0;display:grid;place-items:center;
        font:800 96px Arial;color:#fff">parity</div></body>`,
);
await page.screenshot({ path: `${OUT}/dom.png` });

// B: the same three layers as textures, blended by GL in sRGB with premultiplied alpha.
await page.setContent(`<!doctype html><body style="margin:0"><canvas id="c" width="${W}" height="${H}"
  style="width:100%;height:100%"></canvas></body>`);
await page.evaluate(async (w, h, gradient) => {
  // Each layer is rasterized to its own canvas exactly as a provider would produce it.
  const layer = (paint) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    paint(c.getContext("2d"));
    return c;
  };
  const bg = layer((ctx) => {
    const g = ctx.createLinearGradient(0, 0, w * 0.34, h);
    g.addColorStop(0, "#0b1020"); g.addColorStop(0.55, "#0c8d64"); g.addColorStop(1, "#d99a20");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
  const plate = layer((ctx) => {
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect(w * 0.12, h * 0.4, w * 0.76, h * 0.2);
  });
  const text = layer((ctx) => {
    ctx.font = "800 96px Arial"; ctx.fillStyle = "#fff";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("parity", w / 2, h / 2);
  });

  const gl = document.getElementById("c").getContext("webgl2", {
    preserveDrawingBuffer: true, premultipliedAlpha: true, antialias: false, alpha: false,
  });
  const vs = `#version 300 es
    void main(){ vec2 p=vec2((gl_VertexID<<1)&2, gl_VertexID&2); gl_Position=vec4(p*2.0-1.0,0,1); }`;
  const fs = `#version 300 es
    precision highp float; uniform sampler2D uTex; uniform vec2 uRes;
    out vec4 o;
    void main(){ vec2 uv=gl_FragCoord.xy/uRes; uv.y=1.0-uv.y; o=texture(uTex,uv); }`;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog); gl.useProgram(prog);
  gl.uniform2f(gl.getUniformLocation(prog, "uRes"), w, h);

  gl.viewport(0, 0, w, h);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  // Premultiplied source over destination — the CSS compositing equivalent.
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);

  for (const src of [bg, plate, text]) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  gl.finish();
}, W, H, GRADIENT);

const dataUrl = await page.evaluate(() => document.getElementById("c").toDataURL("image/png"));
writeFileSync(`${OUT}/gl.png`, Buffer.from(dataUrl.split(",")[1], "base64"));

const meanDiff = execFileSync("magick", [
  `${OUT}/dom.png`, `${OUT}/gl.png`, "-compose", "difference", "-composite",
  "-format", "%[fx:mean]", "info:",
]).toString().trim();
const maxDiff = execFileSync("magick", [
  `${OUT}/dom.png`, `${OUT}/gl.png`, "-compose", "difference", "-composite",
  "-format", "%[fx:maxima]", "info:",
]).toString().trim();
console.log(`composite parity: meanDiff=${meanDiff} maxDiff=${maxDiff}`);
console.log(`PNGs in ${OUT}`);
await browser.close();
```

- [ ] **Step 2: Run it**

```bash
node scripts/spike/color-parity.mjs
```

Expected: one `composite parity: meanDiff=… maxDiff=…` line and two PNGs.

- [ ] **Step 3: Judge reconcilability**

The gradient is drawn twice by two different rasterizers, so a small diff is expected and is not the signal. The signal is **where** the diff lives: open `/tmp/kino-m6/dom.png` and `/tmp/kino-m6/gl.png`.

- Diff concentrated on text edges and the plate boundary → antialiasing difference. Reconcilable; note it and proceed.
- Diff spread evenly across the flat interior of the plate → the alpha blend itself disagrees. Investigate before proceeding: check `UNPACK_PREMULTIPLY_ALPHA_WEBGL`, then whether the canvas is being treated as linear.
- Diff spread across the whole gradient with a consistent hue shift → a color-space mismatch. This is the **stop** condition in the spec.

- [ ] **Step 4: Record into the REPORT and commit**

Fill the M6 table with the numbers and the reconcilable verdict, then:

```bash
git add scripts/spike/color-parity.mjs docs/superpowers/specs/2026-07-25-gl-compositor-spike-REPORT.md
git commit -s -m "spike(M6): color and alpha parity between GL and CSS compositing"
```

---

### Task 8: Projection and verdict

**Files:**
- Modify: `docs/superpowers/specs/2026-07-25-gl-compositor-spike-REPORT.md`

**Interfaces:**
- Consumes: the M1–M6 tables.
- Produces: the verdict that gates the core plan.

- [ ] **Step 1: Compute the projected per-frame cost**

Write the arithmetic into the REPORT's Projection section, showing the terms:

```
compositor per-frame ≈ dynamic_raster_count × M2(motion, SS=2)
                     + keyed_raster_amortized
                     + draw (assume 2ms; providers upload + one quad each)
                     + M5(best capture)
```

`dynamic_raster_count` is how many `dynamic` motion layers are on screen simultaneously in the worst-case spec — count them by reading the spec, and state the number. `keyed_raster_amortized` is M2(caption) divided by the average frames per spoken word (use 12 at 30fps unless the chosen spec's word timings say otherwise; if so, use the real figure and say which spec it came from).

- [ ] **Step 2: Apply the decision criteria verbatim**

Compare the projection against M1's totals:

- Worst-case spec: projected ≤ 1.25 × M1 worst-case total p50?
- Typical spec: projected ≤ 1.00 × M1 typical total p50?
- M3: no visible text degradation?
- M6: reconcilable?

Write **proceed**, **redesign**, or **stop** in the Verdict section with one sentence per criterion showing which way it went. Do not soften a failed criterion — the whole point of fixing them in advance was to make this step mechanical.

- [ ] **Step 3: If the verdict is redesign or stop, write what changes**

For **redesign**, name the specific constraint that would make the numbers work — for example, "motion HTML that reads `--frame` is capped at N simultaneous full-screen layers", or "`dynamic` layers raster at SS=1 while the rest of the graph runs at SS=2" — and state which spec section needs amending.

For **stop**, state what was irreconcilable and what would have to change upstream (in Chromium, in the raster path, or in the authoring model) for the design to become viable.

- [ ] **Step 4: Publish the REPORT to a doc branch**

The spike branch is never merged; only the REPORT travels:

```bash
git add docs/superpowers/specs/2026-07-25-gl-compositor-spike-REPORT.md
git commit -s -m "spike: verdict and projection"
git checkout -b docs/gl-compositor-spike-report main
git checkout spike/gl-compositor -- docs/superpowers/specs/2026-07-25-gl-compositor-spike-REPORT.md
git commit -s -m "docs(spec): GL compositor spike REPORT"
```

- [ ] **Step 5: Hand off**

If the verdict is **proceed**, the core plan at `docs/superpowers/plans/2026-07-25-gl-compositor-core.md` is unblocked; update its Task 12 sizing note with the M4 finding first. If **redesign** or **stop**, the core plan does not start — the spec goes back through brainstorming with the REPORT as input.
