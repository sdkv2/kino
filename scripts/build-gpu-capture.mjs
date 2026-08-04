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

/** Every node-gyp copy that could resolve Visual Studio for this build.
 *
 *  Both are patched because the two rebuild steps below use *different* copies: `node-gyp rebuild`
 *  resolves the plain `node-gyp` dependency, while `electron-rebuild` prefers `@electron/node-gyp`.
 *  Patching only the latter looks like it works and silently does nothing when it is not installed
 *  — which is the common case, and left `build:native` failing on VS 18 with
 *  "Could not find any Visual Studio installation to use" despite a working install. */
const NODE_GYP_VS_FINDERS = [
  "node_modules/@electron/node-gyp/lib/find-visualstudio.js",
  "node_modules/node-gyp/lib/find-visualstudio.js",
];

/** node-gyp ≤11 rejects VS 18 (Visual Studio 2026); map it to 2022 + the v145 toolset. */
function patchNodeGypVs18() {
  if (process.platform !== "win32") return;
  const found = NODE_GYP_VS_FINDERS.map((rel) => join(root, rel)).filter((p) => existsSync(p));
  if (found.length === 0) {
    console.warn("build:native — no node-gyp find-visualstudio.js found; skipping VS 18 patch");
    return;
  }
  for (const p of found) patchVsFinder(p);
}

function patchVsFinder(p) {
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
  console.log(`build:native — patched ${p.slice(root.length + 1)} for VS 18 / v145`);
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
