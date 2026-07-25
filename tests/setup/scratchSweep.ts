// Run-scoped temp isolation for the test suite.
//
// The suite has ~125 mkdtempSync call sites across ~35 files, and they hold real render output
// (PNGs, MP4s, raw PCM) — one full run leaves ~87 MB behind. Left unswept that accumulated to
// ~9.7k dirs / 17 GB and filled a dev machine's disk.
//
// Rather than bolt an afterEach onto 125 call sites (and rely on every future test remembering),
// point os.tmpdir() at one run-scoped root for the whole run and delete that root at the end.
// os.tmpdir() re-reads TMPDIR on every call, and globalSetup runs before the test workers are
// forked, so every existing call site is covered with no test-file changes.
//
// afterEach would be wrong here regardless: several files (frames.test.ts, brand.test.ts) mkdtemp
// at module scope and share that dir across every test in the file, so per-test cleanup would
// delete a dir still in use. A single teardown also avoids concurrent workers racing to sweep
// each other's dirs, and never touches a real render's scratch dir running on the same machine.
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Directory name every run root sits under, so an interrupted run leaves one identifiable dir. */
export const TESTRUN_DIRNAME = "kino-testrun";

// Resolved inside setup(), never at import time: in a forked worker TMPDIR is already redirected,
// so an import-time tmpdir() would resolve the base *inside* the run root.
let base: string | undefined;
let runRoot: string | undefined;

export function setup(): void {
  base = join(tmpdir(), TESTRUN_DIRNAME);
  mkdirSync(base, { recursive: true });
  runRoot = mkdtempSync(join(base, "run-"));
  // Workers are forked after globalSetup, so they inherit these and every tmpdir() call in a test
  // (and in src code under test) resolves inside runRoot.
  // All three: os.tmpdir() reads TMPDIR on POSIX but TEMP then TMP on Windows, so setting only
  // TMPDIR would silently leave the Windows CI leg unisolated.
  process.env.TMPDIR = runRoot;
  process.env.TEMP = runRoot;
  process.env.TMP = runRoot;
  process.env.KINO_TEST_TMP_ROOT = runRoot;
}

export function teardown(): void {
  if (!runRoot || !base) return;
  // Retry + swallow: a Chrome from the last render test can still be flushing its profile dir in
  // here (ENOTEMPTY), and a cleanup failure must never fail an otherwise-green run.
  try {
    rmSync(runRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (e) {
    console.warn(`[scratch] could not remove test temp root ${runRoot}: ${(e as Error).message}`);
  }
  runRoot = undefined;
  // Drop the shared base once it is empty. A run killed before teardown (^C) leaves its run-* dir
  // behind on purpose — sweeping siblings here would delete the root of a concurrent vitest run.
  // Those strays stay under one kino-testrun/ dir and are what `kino doctor` reports.
  try {
    if (!readdirSync(base).length) rmSync(base, { recursive: true, force: true });
  } catch {
    // base already gone
  }
  base = undefined;
}
