import { defineConfig } from "vitest/config";

// KINO_GPU=0 pins the suite to SwiftShader. The GL backend is otherwise auto-detected per machine
// (resolveGL: hardware ANGLE on macOS, software elsewhere), which would mean the render tests
// exercise a different backend on a Mac than in CI — and gpu/sw frames are not bit-identical, so
// any test asserting on pixels would be comparing against whichever card the author happened to
// have. The canonical path is the one the tests should hold.
export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
    env: { KINO_GPU: "0" },
  },
});
