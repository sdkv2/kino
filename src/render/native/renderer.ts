import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export function isElectronProcess(): boolean {
  return Boolean(process.versions.electron);
}

/** What the electron package looks like on disk, without running any of its code.
 *
 *  `installed` is false only when the package itself cannot be resolved. `binPath` is where the
 *  binary would live; `binOnDisk` says whether it is actually there yet — the two differ for a
 *  whole release now, see probeElectronInstall. */
export interface ElectronInstall {
  installed: boolean;
  binPath: string | null;
  binOnDisk: boolean;
  /** First line of the resolution failure, for the doctor row. */
  error?: string;
}

/**
 * Locate the Electron binary WITHOUT triggering Electron's lazy download.
 *
 * As of Electron 42 the package ships no install script at all, so `npm ci` never fetches the
 * binary; `node_modules/electron/index.js` downloads it on first `require("electron")` instead.
 * That makes `require` the wrong probe for a *diagnostic*: `kino doctor` would block on a ~100MB
 * download and then report the state it had just created, which is both a surprise and a lie about
 * what the machine looked like when the user asked.
 *
 * `require.resolve` only resolves — it does not execute index.js — so this reads the same two
 * inputs index.js does (`path.txt`, and ELECTRON_OVERRIDE_DIST_PATH for prebuilt dists) and reports
 * what is there. Nothing here downloads, writes, or spawns.
 */
export function probeElectronInstall(
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
  read: (p: string) => string = (p) => readFileSync(p, "utf8"),
): ElectronInstall {
  const require = createRequire(import.meta.url);
  let indexJs: string;
  try {
    indexJs = require.resolve("electron");
  } catch (e) {
    const error = e instanceof Error ? e.message.split("\n")[0] : String(e);
    return { installed: false, binPath: null, binOnDisk: false, error };
  }
  const pkgDir = dirname(indexJs);
  // path.txt is written by install.js and holds the dist-relative executable path
  // ("Electron.app/Contents/MacOS/Electron", "electron.exe", "electron"). No path.txt means the
  // binary has never been fetched here.
  const pathTxt = join(pkgDir, "path.txt");
  const rel = exists(pathTxt) ? read(pathTxt).trim() : "";
  // Mirror index.js's override: a prebuilt dist lives outside the package, and without this a
  // perfectly working ELECTRON_OVERRIDE_DIST_PATH setup would be reported as "not downloaded".
  const override = env.ELECTRON_OVERRIDE_DIST_PATH;
  const binPath = override ? join(override, rel || "electron") : rel ? join(pkgDir, "dist", rel) : null;
  return { installed: true, binPath, binOnDisk: binPath != null && exists(binPath) };
}

/** Path to the Electron binary this install would spawn a render host with. Throws
 *  MODULE_NOT_FOUND when the dependency is missing.
 *
 *  Parent-process only. `renderer.ts` loads inside the Electron main process too (electron/app.ts
 *  imports isElectronProcess from here), and inside that process `require("electron")` resolves to
 *  the Electron API object, not a path string — the old `String(...)` conversion turned that into a
 *  silent `"[object Object]"` instead of a loud error. Only slots.ts and doctor.ts call this today,
 *  both parent-side, so this guard is currently unreachable — it exists so a future call site from
 *  inside the Electron process fails loudly instead of confusingly. */
export function electronBinaryPath(): string {
  if (isElectronProcess()) {
    throw new Error(
      "electronBinaryPath() called from inside the Electron process — require('electron') there " +
        "resolves to the Electron API object, not this install's binary path. Call it from the " +
        "parent Node process instead (see slots.ts / doctor.ts).",
    );
  }
  const require = createRequire(import.meta.url);
  return String(require("electron")).trim();
}

/** `kino doctor` verdict for the Electron render host.
 *
 *  Electron is the only renderer, so a missing PACKAGE is fatal — there is no headless-Chrome path
 *  left to fall back to. A missing BINARY is not, and has not been since Electron 42 moved the
 *  download out of a postinstall and into `require("electron")`: the first render fetches it and
 *  succeeds. Saying "every render will fail" there would be wrong, and the old remedy ("Reinstall
 *  electron") no longer does anything, because there is no install script left for npm to run.
 *
 *  So the not-yet-downloaded case gets its own row: still a warn, because it is worth knowing
 *  before a first render on a metered or air-gapped box, but described as a pending download with a
 *  remedy that actually works. */
export function describeElectronHost(
  probe: () => ElectronInstall = () => probeElectronInstall(),
): { level: "ok" | "warn"; message: string } {
  const el = probe();
  if (!el.installed) {
    return {
      level: "warn",
      message: `electron not installed — every render will fail. Reinstall with npm install. (${el.error ?? "unresolved"})`,
    };
  }
  if (!el.binPath || !el.binOnDisk) {
    return {
      level: "warn",
      message:
        "electron is installed but its binary has not been downloaded yet — since Electron 42 that " +
        "happens on first use, not at npm install. The next render will fetch it (~100MB) and work; " +
        "pre-fetch it now with: npx install-electron --no",
    };
  }
  return { level: "ok", message: `electron render host (${el.binPath})` };
}
