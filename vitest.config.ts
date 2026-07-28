import { configDefaults, defineConfig } from "vitest/config";

// Files that drive a real Chrome + SwiftShader WebGL context and probe the resulting pixels with
// ImageMagick. They are 26 of ~136 test files but ~93% of the suite's cost (545s of 586s on a
// 4-core runner), and they are platform-independent by construction: KINO_GPU=0 below pins every
// one of them to SwiftShader, so a Windows runner renders the same frames a Linux runner does.
// KINO_TEST_SCOPE=light skips them; CI runs the light scope on the macOS/Windows PR jobs and the
// full scope on Linux and on every push to main (see .github/workflows/ci.yml).
//
// segment-mock is deliberately NOT in this list. It is one full Chrome render -> ffmpeg encode ->
// magick probe, and that single path is what catches the per-OS integration breaks this matrix
// exists to find (binary discovery, argv quoting, sandbox flags) — the other 26 only re-prove
// compositor maths that SwiftShader already makes identical everywhere.
const GPU_PIXEL_TESTS = [
  "tests/appclip-frames.test.ts",
  "tests/compositor-effects.test.ts",
  "tests/compositor-glass-composite.test.ts",
  "tests/compositor-layer-mask.test.ts",
  "tests/compositor-motion-shader.test.ts",
  "tests/compositor-orientation.test.ts",
  "tests/compositor-ss.test.ts",
  "tests/compositor-stage.test.ts",
  "tests/glass-shape.test.ts",
  "tests/liquid-glass-showcase.test.ts",
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

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
    exclude:
      process.env.KINO_TEST_SCOPE === "light"
        ? [...configDefaults.exclude, ...GPU_PIXEL_TESTS]
        : configDefaults.exclude,
    globalSetup: ["tests/setup/scratchSweep.ts"],
    env: { KINO_GPU: "0" },
  },
});
