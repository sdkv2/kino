import { configDefaults, defineConfig } from "vitest/config";

// Files that drive a real Chrome + SwiftShader WebGL context and probe the resulting pixels with
// ImageMagick (or, for the compositor-* entries, with the glProbe helper's direct pixel reads).
// They are ~93% of the suite's cost, and platform-independent by construction: KINO_GPU=0 below
// pins every one of them to SwiftShader, so a Windows runner renders the same frames a Linux
// runner does. (Counts used to be quoted here and drifted three times — read the array instead.)
//
// THEY ARE OFF THE DEFAULT PATH. `npm test` excludes them; `npm run test:gpu` is the only thing
// that runs them, and it runs them with fileParallelism OFF. That split exists because the cost was
// never the whole problem — CONTENTION was. Vitest runs test files in parallel, so N of these files
// meant N Electron GL hosts rasterising SwiftShader at once, and the loser of that fight failed on
// whichever assertion it happened to be holding. compositor-orientation is the worked example: 4 of
// its 6 tests failed reproducibly in a full parallel run and passed 6/6 when the file ran alone;
// serialised, the whole scope is green. KINO_CONCURRENCY=1 does not fix this — it caps workers
// WITHIN one render call, not the number of concurrent render calls. Serialising the files does.
//
// So: do not "fix" a flaky pixel test by deleting it or by loosening its threshold until the
// serialised run also fails. See the 2026-07-28 quarantine note below — three files were excluded
// as flaky GPU tests and all three were real, different bugs.
//
// Adding to this list is the right move for any test that drives a real render: whatever lands here
// stops costing PR time entirely, so the bar is "does it render pixels", not "is it slow enough".
//
// segment-mock is deliberately NOT in this list. It is one full Chrome render -> ffmpeg encode ->
// magick probe, and that single path is what catches the per-OS integration breaks this matrix
// exists to find (binary discovery, argv quoting, sandbox flags) — the rest only re-prove
// compositor maths that SwiftShader already makes identical everywhere.
//
// draft-canvas-render / format-4k-render are split out of draft-canvas / format-4k-parity: those
// two files also carry cheap pure-logic unit tests (scaledDims, compDims) that light scope should
// still run, so only the render+magick half moved here.
//
// capture-path / compositor-transitions / compositor-film-pass were added 2026-07-30: they were
// always real-render/glProbe pixel tests (together with the two split-out above, ~137s of a
// ~307s light-scope run on this machine) but had been missed when this list was first curated.
const GPU_PIXEL_TESTS = [
  "tests/appclip-frames.test.ts",
  "tests/capture-path.test.ts",
  "tests/compositor-effects.test.ts",
  "tests/compositor-film-pass.test.ts",
  "tests/compositor-glass-composite.test.ts",
  "tests/compositor-layer-mask.test.ts",
  "tests/compositor-orientation.test.ts",
  "tests/compositor-ss.test.ts",
  "tests/compositor-stage.test.ts",
  "tests/compositor-transitions.test.ts",
  "tests/draft-canvas-render.test.ts",
  "tests/format-4k-render.test.ts",
  "tests/layers-declared-pixel.test.ts",
  "tests/postfx-integration.test.ts",
  "tests/render-compositor-parity.test.ts",
  "tests/render-glass.test.ts",
  "tests/render-guides.test.ts",
  "tests/render-lottie.test.ts",
  "tests/render-maskdist-multiobject.test.ts",
  "tests/render-maskdist-video.test.ts",
  "tests/render-maskdist.test.ts",
  "tests/render-mock.test.ts",
  "tests/render-motion.test.ts",
  "tests/render-region-backdrop.test.ts",
  "tests/render-region-crosssample.test.ts",
  "tests/render-region-params.test.ts",
  "tests/render-region-perobject.test.ts",
  "tests/render-region-reuse.test.ts",
  "tests/render-region-textures.test.ts",
];

// globalSetup redirects TMPDIR into one run-scoped root and deletes it when the run ends, so the
// suite's ~125 mkdtempSync call sites stop leaving render output in the system temp dir.
//
// KINO_GPU=0 pins the suite to SwiftShader. The GL backend is otherwise auto-detected per machine
// (resolveGL: hardware ANGLE on macOS, software elsewhere), which would mean the render tests
// exercise a different backend on a Mac than in CI — and gpu/sw frames are not bit-identical, so
// any test asserting on pixels would be comparing against whichever card the author happened to
// have. The canonical path is the one the tests should hold.

// Three files were briefly quarantined here on 2026-07-28 and all three are back. Recorded because
// each had a different real cause, and none of them was the one the quarantine assumed:
//
//   • glass-shape   — genuinely broken, and NOT a flaky threshold. `c13f72f` renamed the lens author
//                     contract from `kino-glass`/`kino-glass-shape` to `kino-lens`/`kino-lens-shape`
//                     but migrated only ONE of the eleven motion fixtures. The other ten kept the old
//                     class names, so the engine (zero remaining `kino-glass` references) stopped
//                     treating them as lenses: no silhouette, no path morph, no SMIL exemption —
//                     exactly what the assertions said, with both morphs differing by EXACTLY 0.
//                     Fixed by renaming the class in those ten fixtures; the `--glass-*` CSS knobs
//                     are unchanged engine API and must NOT be renamed with them.
//   • compositor-ss — never broken. Collateral damage from Electron hosts sharing one profile
//                     directory, whose block-file HTTP cache corrupts under concurrent access and
//                     then segfaults every later launch. Fixed in the engine, not here.
//   • render-lottie — one over-specified test, since removed: it pinned a colour fade to hard-coded
//                     8-bit channel levels and `late` landed on exactly its `>190` bound.
//
// The lesson worth keeping: every one of these looked like "flaky GPU test, exclude it", and none of
// them was. The fixtures live under gitignored `projects/`, which is why a repo-wide rename missed
// them silently and why no CI run could have caught it.

// CoreML segmentation tests. These drive CoreML → Espresso → MetalPerformanceShadersGraph, i.e. a
// SECOND heavyweight Metal consumer alongside the Electron GL hosts the render tests spin up. Run
// them concurrently on one machine and CoreML dies: SIGABRT out of
//
//   MTLReportFailure → __assert_rtn → abort
//   ← -[MPSGraphTensorData initWithMTLBuffer:shape:strides:interleaves:dataType:]
//   ← E5RT::Ops::MpsGraphInferenceOperation::Impl::EncodeMemoryBuffers
//
// (seven Python crash reports on 2026-07-30, every one that signature). It is a Metal resource
// failure inside Apple's frameworks, not a kino defect and not a flaky assertion — the test's own
// expectations never even run.
//
// Not fixable by avoiding Metal: `KINO_SAM_COMPUTE` already exposes the compute unit, and both
// non-GPU settings are worse — CPU_ONLY and CPU_AND_NE each SIGSEGV outright on this model. Only
// CPU_AND_GPU and ALL produce a mask at all.
//
// A later `groupOrder` was the first attempt and was not enough: even with group 0 carrying no GPU
// pixel tests at all, the image test still took the SIGABRT in a default run and still passed on its
// own. Running strictly after group 0's assertions finish is not the same as running after every
// Electron host group 0 started has actually released the GPU.
//
// So they now get the same treatment as the GPU pixel tests: off the default path, in their own
// scope (`npm run test:metal`). They stay RUNNABLE — they are the only coverage of the real CoreML
// pipeline, and the note above is explicit that excluding a test is not how you fix one. Nothing is
// lost in CI either way: these self-skip unless the machine is a Mac with a SAM venv configured, so
// they have never executed on a runner. This is about `npm test` being trustworthy on a dev Mac.
const METAL_TESTS = [
  "tests/segment-coreml.test.ts",
  "tests/segment-coreml-track.test.ts",
  "tests/segment-coreml-video.test.ts",
];

/** Which slice of the suite to run. The two heavyweight GPU consumers each get their own scope, so
 *  the default run never has two of them competing for one machine's GPU.
 *
 *  default — everything except the GPU pixel tests and the CoreML tests. `npm test`, every CI job.
 *  gpu     — ONLY the GPU pixel tests, one file at a time (`npm run test:gpu`).
 *  metal   — ONLY the CoreML tests (`npm run test:metal`). Mac with a SAM venv; skips elsewhere.
 *  full    — everything in one parallel run. Kept for a deliberate local sweep; this is the
 *            combination that produces the contention failures described above, so it is not what
 *            CI runs and not what to trust a red result from.
 *
 *  `light` is accepted as a synonym of the default: it was the opt-in name back when GPU tests ran
 *  by default, and old invocations should not silently start running something else. */
type Scope = "default" | "gpu" | "metal" | "full";
const SCOPES: Scope[] = ["gpu", "metal", "full"];
const asked = process.env.KINO_TEST_SCOPE;
const scope: Scope = SCOPES.find((s) => s === asked) ?? "default";

const exclude = scope === "full" ? configDefaults.exclude : [...configDefaults.exclude, ...GPU_PIXEL_TESTS];

export default defineConfig({
  test: {
    globals: true,
    globalSetup: ["tests/setup/scratchSweep.ts"],
    env: { KINO_GPU: "0" },
    projects: projectsFor(scope),
  },
});

function projectsFor(s: Scope) {
  const base = { globals: true, env: { KINO_GPU: "0" } };
  // Both dedicated scopes run one file at a time — serialising the files is the actual fix for the
  // contention, and it is affordable because nothing on the PR path waits for either of them.
  if (s === "gpu") {
    return [{ test: { ...base, name: "gpu", include: GPU_PIXEL_TESTS, fileParallelism: false } }];
  }
  if (s === "metal") {
    return [{ test: { ...base, name: "metal", include: METAL_TESTS, fileParallelism: false } }];
  }
  // default / full. `full` keeps the old shape — metal in a later group — because that is the
  // "run absolutely everything on this machine" escape hatch, and a later group is still better
  // than none. `default` excludes METAL_TESTS outright (see the note above them).
  const suiteExclude = s === "full" ? exclude : [...exclude, ...METAL_TESTS];
  const projects: Array<{ test: Record<string, unknown> }> = [
    { test: { ...base, name: "suite", include: ["tests/**/*.test.ts"], exclude: suiteExclude, sequence: { groupOrder: 0 } } },
  ];
  if (s === "full") {
    projects.push({ test: { ...base, name: "metal", include: METAL_TESTS, exclude, sequence: { groupOrder: 1 } } });
  }
  return projects;
}
