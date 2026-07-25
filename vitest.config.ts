import { defineConfig } from "vitest/config";

// globalSetup redirects TMPDIR into one run-scoped root and deletes it when the run ends, so the
// suite's ~125 mkdtempSync call sites stop leaving render output in the system temp dir.
//
// KINO_GPU=0 pins the suite to SwiftShader. The GL backend is otherwise auto-detected per machine
// (resolveGL: hardware ANGLE on macOS, software elsewhere), which would mean the render tests
// exercise a different backend on a Mac than in CI — and gpu/sw frames are not bit-identical, so
// any test asserting on pixels would be comparing against whichever card the author happened to
// have. The canonical path is the one the tests should hold.
export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/setup/scratchSweep.ts"],
    env: { KINO_GPU: "0" },
  },
});
