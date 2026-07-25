import { defineConfig } from "vitest/config";
// globalSetup redirects TMPDIR into one run-scoped root and deletes it when the run ends, so the
// suite's ~125 mkdtempSync call sites stop leaving render output in the system temp dir.
export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/setup/scratchSweep.ts"],
  },
});
