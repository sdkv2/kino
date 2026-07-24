# kino Segmentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `kino segment <image|video> --prompt "<text>"` generates object masks (Mac/CoreML at author-time) that render consumes cross-platform as shader texture channels (`uTex0..uTex3`).

**Architecture:** Author-time mask generation is a Mac-only asset tool (SAM3.1 CoreML); the mask artifacts are plain files (PNG / mask.mp4 + manifest.json) that any platform reads at render time. A `mock` backend keeps the whole feature CI-testable with no Mac and no model. Backend dispatch mirrors kino's `src/avatar/` provider pattern (union type + flat module + `if/else`), so Windows/CUDA is a later drop-in.

**Tech Stack:** Node 20 + TypeScript (ESM), Commander CLI, Zod schema, vitest, ffmpeg (via existing `src/media`), puppeteer/WebGL render page, Python subprocess for the CoreML runner.

## Global Constraints

- Node ESM: all local imports end `.js` (e.g. `import { x } from "./foo.js"`), even from `.ts` sources.
- Build runs from `dist/`: `npm run build` (`tsc && node scripts/build-page.mjs`) after any source change or the CLI runs stale code.
- v1 backend is **macOS/Apple-Silicon only** (`coreml`). Non-Mac coreml invocation exits non-zero with structured error. `mock` runs anywhere.
- Model weights download lazily to `~/.kino/sam/`; never bundled. Env override `KINO_SAM_MODEL`.
- SAM3.1 = Meta SAM License (share-alike/field-of-use/attribution) — note in any downloaded-model dir + docs.
- Mask video packs ≤4 objects into R/G/B/A channels; `--objects` max 4.
- Tests: `npx vitest run tests/<file>.test.ts`. Follow existing `tests/*.test.ts` style (`import { describe, it, expect } from "vitest"`, import source as `../src/**/*.js`).
- Commit after each task. Do not push. Branch `feat/segmentation`.

---

## File Structure

- `src/segment/manifest.ts` — mask-manifest type + read/write/validate. Shared by command and render.
- `src/segment/backend.ts` — `SegmentBackend` union, `pickBackend(platform, opt)`, `SegmentRequest`/`SegmentResult` types.
- `src/segment/mock.ts` — deterministic synthetic mask backend.
- `src/segment/coreml.ts` — Mac CoreML backend: venv bootstrap + HF model download + python-runner subprocess.
- `src/segment/segment.ts` — orchestrator: dispatch backend, write artifacts + manifest.
- `src/commands/segment.ts` — CLI command (lazy-imported from cli.ts).
- `src/cli.ts` — register `segment` command (modify).
- `src/commands/doctor.ts` — add segmentation readiness rows (modify).
- `src/spec/schema.ts` — extend `backgroundTextures` to allow `{source, kind:"video"}` (modify).
- `src/render/props.ts` — extend `BgTexture` with `"video"` kind (modify).
- `src/render/native/page/bgTextures.ts` — per-frame video-frame → texture upload (modify).
- `scripts/sam_runner.py` — CoreML inference harness (image + video) invoked by `coreml.ts`.
- `tests/segment-manifest.test.ts`, `tests/segment-backend.test.ts`, `tests/segment-mock.test.ts`, `tests/segment-schema.test.ts` — tests.
- `docs/segmentation.md` — user/agent docs + example shader.

---

## Task 1: Mask manifest type + round-trip

**Files:**
- Create: `src/segment/manifest.ts`
- Test: `tests/segment-manifest.test.ts`

**Interfaces:**
- Produces: `interface MaskObject { id: number; label: string; channel: "r"|"g"|"b"|"a"|"gray" }`; `interface MaskManifest { kind: "image"|"video"; source: string; prompt: string; width: number; height: number; fps?: number; frames?: number; objects: MaskObject[]; backend: string; tracked: boolean }`; `writeManifest(dir: string, m: MaskManifest): void`; `readManifest(dir: string): MaskManifest` (throws on missing/invalid).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeManifest, readManifest, type MaskManifest } from "../src/segment/manifest.js";

describe("mask manifest", () => {
  it("round-trips through disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-mask-"));
    const m: MaskManifest = {
      kind: "video", source: "clip.mp4", prompt: "the person",
      width: 1080, height: 1920, fps: 30, frames: 90,
      objects: [{ id: 0, label: "the person", channel: "r" }],
      backend: "mock", tracked: true,
    };
    writeManifest(dir, m);
    expect(readManifest(dir)).toEqual(m);
  });
  it("throws on missing manifest", () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-mask-"));
    expect(() => readManifest(dir)).toThrow();
  });
});
```

- [ ] **Step 2: Run test, verify FAIL** — `npx vitest run tests/segment-manifest.test.ts` → fails (module missing).

- [ ] **Step 3: Implement** `src/segment/manifest.ts`

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface MaskObject {
  id: number;
  label: string;
  channel: "r" | "g" | "b" | "a" | "gray";
}

export interface MaskManifest {
  kind: "image" | "video";
  source: string;
  prompt: string;
  width: number;
  height: number;
  fps?: number;
  frames?: number;
  objects: MaskObject[];
  backend: string;
  tracked: boolean;
}

const FILE = "manifest.json";

export function writeManifest(dir: string, m: MaskManifest): void {
  writeFileSync(join(dir, FILE), JSON.stringify(m, null, 2));
}

export function readManifest(dir: string): MaskManifest {
  const raw = JSON.parse(readFileSync(join(dir, FILE), "utf8")) as MaskManifest;
  if (!raw.kind || !Array.isArray(raw.objects)) throw new Error(`invalid mask manifest in ${dir}`);
  return raw;
}
```

- [ ] **Step 4: Run test, verify PASS** — `npx vitest run tests/segment-manifest.test.ts`.

- [ ] **Step 5: Commit** — `git add src/segment/manifest.ts tests/segment-manifest.test.ts && git commit -m "feat(segment): mask manifest type + round-trip"`

---

## Task 2: Backend selection + request/result types

**Files:**
- Create: `src/segment/backend.ts`
- Test: `tests/segment-backend.test.ts`

**Interfaces:**
- Consumes: `MaskManifest` from Task 1.
- Produces: `type SegmentBackend = "coreml" | "mock"`; `interface SegmentRequest { input: string; prompt: string; objects: number; track: boolean; outDir: string }`; `interface SegmentResult { manifest: MaskManifest; outDir: string }`; `interface Backend { name: SegmentBackend; run(req: SegmentRequest): Promise<SegmentResult> }`; `pickBackend(opts: { requested?: SegmentBackend; platform: NodeJS.Platform }): SegmentBackend` — returns `requested` if set; else `"coreml"` on `"darwin"`, else throws `Error` with message containing `backend_unavailable`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { pickBackend } from "../src/segment/backend.js";

describe("pickBackend", () => {
  it("defaults to coreml on darwin", () => {
    expect(pickBackend({ platform: "darwin" })).toBe("coreml");
  });
  it("honors explicit request", () => {
    expect(pickBackend({ platform: "linux", requested: "mock" })).toBe("mock");
  });
  it("throws backend_unavailable off-darwin without request", () => {
    expect(() => pickBackend({ platform: "linux" })).toThrow(/backend_unavailable/);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL** — `npx vitest run tests/segment-backend.test.ts`.

- [ ] **Step 3: Implement** `src/segment/backend.ts`

```ts
import type { MaskManifest } from "./manifest.js";

export type SegmentBackend = "coreml" | "mock";

export interface SegmentRequest {
  input: string;
  prompt: string;
  objects: number;
  track: boolean;
  outDir: string;
}

export interface SegmentResult {
  manifest: MaskManifest;
  outDir: string;
}

export interface Backend {
  name: SegmentBackend;
  run(req: SegmentRequest): Promise<SegmentResult>;
}

export function pickBackend(opts: { requested?: SegmentBackend; platform: NodeJS.Platform }): SegmentBackend {
  if (opts.requested) return opts.requested;
  if (opts.platform === "darwin") return "coreml";
  throw new Error(`backend_unavailable: coreml segmentation needs macOS/Apple Silicon (got ${opts.platform}); use --backend mock or author masks on a Mac`);
}
```

- [ ] **Step 4: Run test, verify PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(segment): backend selection + request/result types"`

---

## Task 3: Mock backend (deterministic synthetic mask)

**Files:**
- Create: `src/segment/mock.ts`
- Test: `tests/segment-mock.test.ts`

**Interfaces:**
- Consumes: `Backend`, `SegmentRequest`, `SegmentResult` (Task 2); `writeManifest` (Task 1).
- Produces: `const mockBackend: Backend`. For an image input writes `mask.png` (a centered white ellipse on black, via a pure-JS PPM→PNG or an ffmpeg lavfi call using existing `src/media` helpers); for a `.mp4`/`.webm` input writes `mask.mp4`. Always writes `manifest.json` with `backend:"mock"`, `tracked: req.track`. Detects video by extension (`.mp4|.mov|.webm|.mkv`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockBackend } from "../src/segment/mock.js";
import { readManifest } from "../src/segment/manifest.js";

describe("mock backend", () => {
  it("produces a mask.png + manifest for an image input", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-mock-"));
    const res = await mockBackend.run({ input: "photo.png", prompt: "the cat", objects: 1, track: false, outDir });
    expect(existsSync(join(outDir, "mask.png"))).toBe(true);
    const m = readManifest(outDir);
    expect(m.kind).toBe("image");
    expect(m.backend).toBe("mock");
    expect(m.objects[0].label).toBe("the cat");
  });
});
```

- [ ] **Step 2: Run test, verify FAIL.**

- [ ] **Step 3: Implement** `src/segment/mock.ts`. Use a minimal dependency-free PNG writer for the image path (grayscale ellipse). Check `src/media` for an existing PNG/ffmpeg helper first and reuse it; only write raw PNG bytes if none exists. For video, shell the existing ffmpeg wrapper to emit a short grayscale `mask.mp4` at 30fps matching a default 1080x1920 (mock needn't probe the real input). Write manifest via `writeManifest`. (Full implementation is the implementer's task; keep it <120 lines, one responsibility.)

- [ ] **Step 4: Run test, verify PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(segment): deterministic mock backend"`

---

## Task 4: Orchestrator + `kino segment` command

**Files:**
- Create: `src/segment/segment.ts`, `src/commands/segment.ts`
- Modify: `src/cli.ts` (register command)
- Test: `tests/segment-cmd.test.ts` (drives orchestrator with mock)

**Interfaces:**
- Consumes: `pickBackend`, `Backend`, `SegmentRequest` (Task 2); `mockBackend` (Task 3); `coremlBackend` (Task 7 — import lazily so non-Mac/CI never loads python paths).
- Produces: `runSegment(opts: { input: string; prompt: string; objects?: number; track?: boolean; out?: string; backend?: SegmentBackend; projectRoot: string; platform?: NodeJS.Platform }): Promise<SegmentResult>` — resolves outDir under `<projectRoot>/assets/masks/<out|derived>`, dispatches backend, returns result.

- [ ] **Step 1** Write failing test: `runSegment` with `backend:"mock"` on an image path returns a result whose `outDir` contains `manifest.json` and is under `assets/masks/`.
- [ ] **Step 2** Run, verify FAIL.
- [ ] **Step 3** Implement `segment.ts` (dispatch: `mock`→`mockBackend`; `coreml`→`await import("./coreml.js")`). Implement `src/commands/segment.ts` with Commander options from the spec (`--prompt`, `--objects`, `--out`, `--no-track`, `--backend`, `--format json`), resolving the project via existing `src/config/project.js` (`resolveProject`), printing JSON when `--format json` or non-TTY, non-zero exit + `{error:"backend_unavailable",...}` on the pickBackend throw. Register in `cli.ts` following the `frames`/`transcribe` block (lazy `await import("./commands/segment.js")`).
- [ ] **Step 4** Run test, verify PASS. Then `npm run build` and smoke: `node bin/kino.mjs segment <fixture.png> --prompt "x" --backend mock --format json` in a temp project → prints manifest JSON.
- [ ] **Step 5** Commit — `git commit -am "feat(segment): orchestrator + kino segment command"`

---

## Task 5: Schema — `backgroundTextures` video kind

**Files:**
- Modify: `src/spec/schema.ts:198` (backgroundTextures union), `src/render/props.ts:89` (`BgTexture`)
- Test: `tests/segment-schema.test.ts`

**Interfaces:**
- Produces: `backgroundTextures` entry accepts `{ source: string, kind: "video" }` in addition to existing `string` and `{source, param}`. `BgTexture` interface gains `kind: "image"|"html"|"video"`.

- [ ] **Step 1** Failing test: a spec with `backgroundTextures: [{ source: "masks/x/mask.mp4", kind: "video" }]` passes `SpecSchema` parse; a bogus `{source, kind:"nope"}` fails.
- [ ] **Step 2** Run, verify FAIL.
- [ ] **Step 3** Extend the zod union at `schema.ts:198` to add `z.object({ source: z.string().min(1), kind: z.literal("video") })`. Update `BgTexture` in `props.ts` and the resolve step that maps spec entries → `BgTexture` (find it near where `param` entries are handled) to carry `kind:"video"`.
- [ ] **Step 4** Run test PASS; `npm run build`.
- [ ] **Step 5** Commit — `git commit -am "feat(segment): backgroundTextures video-source kind"`

---

## Task 6: Render — sample video mask into texture channel

**Files:**
- Modify: `src/render/native/page/bgTextures.ts`, `src/render/native/page/ShaderBackground.tsx`
- Test: `tests/segment-videotex.test.ts` (pure-helper level — assert a video BgTexture yields a per-frame source descriptor with a bumping revision; do not run WebGL in Node)

**Interfaces:**
- Consumes: `BgTexture` with `kind:"video"` (Task 5).
- Produces: video channels resolve like animated-HTML channels — a per-frame `LoadedTex` whose `source` is the current video frame and whose `revision` increments each composition frame, so `ShaderBackground`'s existing revision-diff re-upload path binds it to `uTexN`.

- [ ] **Step 1** Failing test at the seam that's Node-testable (e.g. a helper `videoTexRevision(frame)` or the per-frame source selection function). Keep WebGL out of the test.
- [ ] **Step 2** Run, verify FAIL.
- [ ] **Step 3** Implement: in `bgTextures.ts`, add a `video` branch alongside the `image`/`html` handling — decode via a hidden `<video>`/existing `FrameVideo` seeked to `frame/fps`, draw to a canvas each frame, bump `revision`. Follow the animated-html precedent (source + revision, LRU not needed). Wire nothing new in `ShaderBackground.tsx` if the revision path already re-uploads; otherwise add the video-source seek in the per-frame `kinoSeek` hook.
- [ ] **Step 4** Run test PASS; `npm run build`; render smoke via existing mock render test path if quick.
- [ ] **Step 5** Commit — `git commit -am "feat(segment): video mask as shader texture channel"`

---

## Task 7: CoreML backend — venv + model download + image runner

**Files:**
- Create: `src/segment/coreml.ts`, `scripts/sam_runner.py`
- Modify: `src/commands/doctor.ts`

**Interfaces:**
- Consumes: `Backend`, `SegmentRequest`, `SegmentResult` (Task 2); `writeManifest` (Task 1).
- Produces: `const coremlBackend: Backend`. `ensureSamEnv()` — bootstraps `~/.kino/sam/venv` (python3 -m venv + pip install pinned deps incl. patched coremltools note) and downloads models from HF (`AllanVester/SAM3.1-CoreML-FP16` image; `sdkv2/sam3.1-coreml-tracker-spike` tracker) to `~/.kino/sam/models/`, each gated by `existsSync`. `run()` shells `python scripts/sam_runner.py --input ... --prompt ... --out ... [--video]` and reads the manifest the runner writes.

- [ ] **Step 1** Failing test (mac-gated with `it.skipIf(process.platform!=="darwin")`): image seg on a small fixture produces a non-empty `mask.png`. On CI this skips.
- [ ] **Step 2** Run — SKIP on CI, FAIL on Mac (not implemented).
- [ ] **Step 3** Implement `sam_runner.py` image path first (load AllanVester ImageEncoder+Detector+TextEncoder mlpackages, run text-prompt seg, write grayscale `mask.png` + manifest). Implement `coreml.ts` (`ensureSamEnv` + subprocess). Add doctor rows: model dir present, venv present, platform. Reuse the proven harness patterns from `scratchpad/sam3-coreml` (patched coremltools, torch 2.7.0) — but the image models don't need the tracker patch; keep the image path minimal.
- [ ] **Step 4** On a Mac: run the mac-gated test → PASS. `npm run build`; `kino doctor` shows segmentation rows.
- [ ] **Step 5** Commit — `git commit -am "feat(segment): CoreML image backend + venv/model bootstrap"`

---

## Task 8: CoreML video — tracker wiring (or documented per-frame fallback)

**Files:**
- Modify: `scripts/sam_runner.py` (video path), `src/segment/coreml.ts`
- Test: mac-gated video seg on a 1–2s fixture → `mask.mp4` + manifest with `tracked:true` (or `tracked:false` if fallback).

**Interfaces:**
- Consumes: image encoder features (Task 7) + tracker mlpackage (`sdkv2/sam3.1-coreml-tracker-spike`).
- Produces: video path in `sam_runner.py` — per frame: image encoder → features → tracker `track_step` (stateful) → per-object mask; pack ≤4 objects into RGBA `mask.mp4`. `tracked:true`. If the encoder-features→tracker-input bridge cannot be completed, fall back to per-frame image seg (`--no-track` semantics), write `tracked:false`, and log the reason. **Do not fake tracking.**

- [ ] **Step 1** Failing mac-gated test as above.
- [ ] **Step 2** Run — SKIP CI.
- [ ] **Step 3** Implement the encoder→tracker bridge (match AllanVester encoder output to the tracker's `vis72/hires0/hires1` expectations — this is the known-uncertain step; consult `scratchpad/sam3-coreml/dense_wrapper.py` `frame_inputs`/`synth_frame_features` for the exact shapes the tracker consumes). If it lands, real tracked masks. If blocked after honest effort, wire the per-frame fallback and document precisely what's missing in `docs/segmentation.md`.
- [ ] **Step 4** Mac: run test → PASS (tracked or fallback). `npm run build`.
- [ ] **Step 5** Commit — `git commit -am "feat(segment): CoreML video tracking (or per-frame fallback)"`

---

## Task 9: Docs + example shader + doctor polish

**Files:**
- Create: `docs/segmentation.md`, `assets-lib/backgrounds/mask-cutout.frag` (or the repo's shader-example location — check `kino backgrounds`/`shader-backgrounds` skill for the correct dir)
- Modify: `README.md` (one line + link if there's a feature list)

- [ ] **Step 1** Write `docs/segmentation.md`: the `kino segment` command, artifact layout, the `backgroundTextures` video/image kinds, a worked background-replace shader sampling `uTex0`, the Mac-only + SAM-License notes, and the Windows/CUDA extension seam. No test (docs).
- [ ] **Step 2** Add the example `.frag` (mask cutout / background replace) and reference it from the docs.
- [ ] **Step 3** `npm run build`; smoke: author a tiny spec using a mock mask as a video texture + the example shader, `kino build --draft` (per memory: draft, no TTS) → renders without error.
- [ ] **Step 4** Commit — `git commit -am "docs(segment): usage, artifact format, example mask shader"`

---

## Self-Review

**Spec coverage:** command surface (T4), backend seam (T2/T3/T7), author-time/cross-platform split (T7 Mac gate + T5/T6 render), mask artifact format (T1/T3/T8), shader consumption image+video (T5/T6/T9), doctor (T7), mock/CI testability (T3–T6), video tracking + honest fallback (T8), docs + example (T9), license/download notes (T7/T9). Covered.

**Placeholder scan:** T3/T7/T8 delegate full implementation bodies to the implementer with explicit constraints (line budgets, exact models, exact reference files, exact fallback behavior) rather than pasting 100+ lines — acceptable for the CoreML/ffmpeg tasks whose exact bytes depend on live probing; the deterministic TS tasks (T1/T2) have complete code. T4/T5/T6 give exact edit points and interfaces.

**Type consistency:** `MaskManifest`/`MaskObject` (T1) used verbatim in T3/T7/T8. `Backend`/`SegmentRequest`/`SegmentResult`/`SegmentBackend` (T2) consistent across T3/T4/T7/T8. `BgTexture.kind:"video"` (T5) consumed in T6. `pickBackend` signature stable. Consistent.

## Execution

Subagent-driven (user pre-authorized). Tasks 1–6 are cross-platform and land tonight with tests. Tasks 7–8 (CoreML engine) are Mac-gated; build as far as the model wiring allows, honest fallback + status otherwise. Task 9 documents final state.
