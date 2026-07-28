import { existsSync } from "node:fs";
import { createRequire } from "node:module";

export function isElectronProcess(): boolean {
  return Boolean(process.versions.electron);
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
 *  Electron is the only renderer, so an absent or broken install is fatal rather than degrading —
 *  there is no headless-Chrome path left to fall back to. Resolving the package is not enough
 *  either: it resolves to a path inside itself, which is missing if the binary download failed
 *  while the package install succeeded. */
export function describeElectronHost(
  resolveBin: () => string = electronBinaryPath,
  exists: (p: string) => boolean = existsSync,
): { level: "ok" | "warn"; message: string } {
  let bin: string;
  try {
    bin = resolveBin();
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
    return {
      level: "warn",
      message: `electron not installed — every render will fail. Reinstall with npm install. (${msg})`,
    };
  }
  if (!bin || !exists(bin)) {
    return {
      level: "warn",
      message:
        `electron resolves but its binary is missing (${bin || "empty path"}) — the package installed ` +
        "and its binary download did not. Reinstall electron.",
    };
  }
  return { level: "ok", message: `electron render host (${bin})` };
}
