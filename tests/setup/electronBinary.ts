// Materialise the Electron binary once, before any test worker forks.
//
// Electron 42 stopped shipping an install script (`electron`'s package.json has no `scripts` at
// all), so `npm ci` no longer downloads the binary. Instead `node_modules/electron/index.js`
// downloads it lazily, from inside `require("electron")` — see its getElectronPath/downloadElectron.
//
// That is fine for one process and actively broken for a test suite: vitest forks a worker per test
// file, 14 of them reach the GL host helper (tests/helpers/glHost.ts → electronBinaryPath() →
// require("electron")), and on a fresh checkout every one of those workers starts its own download
// into the SAME node_modules/electron/dist. The losers of that race get a partially extracted tree.
//
// The failure does not look like a download problem, which is what makes it worth this file:
// - CI (all three OSes) spawned the half-written binary and it died as
//   `electron GL host exited code=null signal=SIGTRAP`, reported against whichever compositor test
//   happened to be holding it.
// - Locally the same state surfaces as install.js exiting non-zero: "Electron failed to install
//   correctly. Please delete `node_modules/electron`...".
// Both are one cause. It stayed invisible on Electron 40 because the postinstall had already put
// the binary in place before vitest started, and invisible on a dev machine because any earlier
// render or `require("electron")` had already materialised it.
//
// globalSetup runs in the main vitest process before workers fork, so resolving the path here
// serialises the download to exactly one, and every worker afterwards hits the existsSync fast path.
import { createRequire } from "node:module";

export function setup(): void {
  // KINO_SKIP_ELECTRON_FETCH is for environments that deliberately have no Electron and only run
  // the non-render tests; the suite already tolerates a missing host per-test.
  if (process.env.KINO_SKIP_ELECTRON_FETCH === "1") return;
  const require = createRequire(import.meta.url);
  try {
    // The download, if any, happens inside this require — it is the whole point of the call.
    require("electron");
  } catch (e) {
    // Don't fail the run: tests that need Electron report it themselves with far better context,
    // and the suite has plenty that don't need it at all.
    console.warn(
      `[electron] could not materialise the Electron binary up front: ${(e as Error).message}\n` +
        "  Render/GL tests will likely fail. Fix with: npx install-electron --no",
    );
  }
}
