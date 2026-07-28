#!/usr/bin/env node
// Build gpu_capture.node for Electron's Node ABI (macOS VT / Windows NVENC / Linux NVENC).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nativeDir = join(root, "src/render/native/electron/native");

if (process.platform !== "darwin" && process.platform !== "win32" && process.platform !== "linux") {
  console.log("build:native — skip (gpu_capture is macOS/Windows/Linux only)");
  process.exit(0);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/** node-gyp ≤10 rejects VS 18; map it to 2022 + v145 toolset. */
function patchNodeGypVs18() {
  if (process.platform !== "win32") return;
  const p = join(root, "node_modules/@electron/node-gyp/lib/find-visualstudio.js");
  if (!existsSync(p)) return;
  let c = readFileSync(p, "utf8");
  if (c.includes("ret.versionMajor === 18")) return;
  const needle = `    if (ret.versionMajor === 17) {
      ret.versionYear = 2022
      return ret
    }
    this.log.silly('- unsupported version:', ret.versionMajor)`;
  const insert = `    if (ret.versionMajor === 17) {
      ret.versionYear = 2022
      return ret
    }
    if (ret.versionMajor === 18) {
      ret.versionYear = 2022
      return ret
    }
    this.log.silly('- unsupported version:', ret.versionMajor)`;
  if (!c.includes(needle)) return;
  c = c.replace(needle, insert);
  c = c.replace(
    `    } else if (versionYear === 2022) {
      return 'v143'
    }`,
    `    } else if (versionYear === 2022) {
      return 'v145'
    }`,
  );
  writeFileSync(p, c);
  console.log("build:native — patched @electron/node-gyp for VS 18 / v145");
}

patchNodeGypVs18();
run("npm", ["exec", "--", "node-gyp", "rebuild"], { cwd: nativeDir });

let electronVersion = "33.4.11";
try {
  electronVersion = JSON.parse(readFileSync(join(root, "node_modules/electron/package.json"), "utf8")).version;
} catch {
  // optional dep may be missing in CI
}

run("npm", ["exec", "--", "electron-rebuild", "-f", "-v", electronVersion, "-m", nativeDir], { cwd: root });

const built = join(nativeDir, "build/Release/gpu_capture.node");
const distDir = join(root, "dist/render/native/electron/native/build/Release");
mkdirSync(distDir, { recursive: true });
copyFileSync(built, join(distDir, "gpu_capture.node"));

console.log("build:native — gpu_capture.node ready for Electron", electronVersion);
