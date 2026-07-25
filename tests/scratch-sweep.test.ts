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

  // os.tmpdir() reads TMPDIR on POSIX but TEMP then TMP on Windows. Setting only TMPDIR left the
  // Windows CI leg unisolated while every local run looked fine, so assert all three explicitly.
  it("redirects the temp env vars for every platform, not just POSIX", () => {
    const root = process.env.KINO_TEST_TMP_ROOT;
    expect(process.env.TMPDIR).toBe(root);
    expect(process.env.TEMP).toBe(root);
    expect(process.env.TMP).toBe(root);
  });

  it("teardown removes the run root and everything under it", () => {
    // setup() rebinds the temp env vars process-wide; restore all three (TEMP/TMP matter on
    // Windows) or later tests in this file point at a deleted dir.
    const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
    try {
      setup();
      const root = process.env.KINO_TEST_TMP_ROOT!;
      const leaked = mkdtempSync(join(tmpdir(), "kino-would-have-leaked-"));
      writeFileSync(join(leaked, "render.png"), "x");
      expect(existsSync(leaked)).toBe(true);
      teardown();
      expect(existsSync(leaked)).toBe(false);
      expect(existsSync(root)).toBe(false);
    } finally {
      process.env.TMPDIR = saved.TMPDIR;
      process.env.TEMP = saved.TEMP;
      process.env.TMP = saved.TMP;
      process.env.KINO_TEST_TMP_ROOT = saved.TMPDIR;
    }
  });

  it("teardown is safe to call when no run root is active", () => {
    expect(() => teardown()).not.toThrow();
  });
});
