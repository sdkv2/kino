import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { TESTRUN_DIRNAME, setup, teardown } from "./setup/scratchSweep.js";

// The 17 GB pile was mostly test debris: 125 mkdtemp call sites across 35 files, essentially none
// cleaned up. Rather than trusting 125 hand-written afterEach hooks, the whole run is redirected
// into one run-scoped temp root that is removed wholesale when the run ends.
describe("test temp isolation", () => {
  it("routes test temp dirs into a run-scoped root", () => {
    const root = process.env.KINO_TEST_TMP_ROOT;
    expect(root, "globalSetup should export KINO_TEST_TMP_ROOT").toBeTruthy();
    expect(tmpdir()).toBe(root);
    // A plain mkdtempSync — the shape used by all 125 existing test call sites — must land inside
    // the run-scoped root without the test file doing anything special.
    const d = mkdtempSync(join(tmpdir(), "kino-routed-"));
    expect(d.startsWith(root!)).toBe(true);
  });

  it("keeps every run root under one identifiable base dir", () => {
    expect(basename(dirname(process.env.KINO_TEST_TMP_ROOT!))).toBe(TESTRUN_DIRNAME);
  });

  it("teardown removes the run root and everything under it", () => {
    // setup() rebinds TMPDIR process-wide, so restore it or later tests in this file lose their
    // temp dir.
    const saved = process.env.TMPDIR;
    try {
      setup();
      const root = process.env.TMPDIR!;
      const leaked = mkdtempSync(join(tmpdir(), "kino-would-have-leaked-"));
      writeFileSync(join(leaked, "render.png"), "x");
      expect(existsSync(leaked)).toBe(true);
      teardown();
      expect(existsSync(leaked)).toBe(false);
      expect(existsSync(root)).toBe(false);
    } finally {
      process.env.TMPDIR = saved;
    }
  });

  it("teardown is safe to call when no run root is active", () => {
    const saved = process.env.TMPDIR;
    try {
      expect(() => teardown()).not.toThrow();
    } finally {
      process.env.TMPDIR = saved;
    }
  });
});
