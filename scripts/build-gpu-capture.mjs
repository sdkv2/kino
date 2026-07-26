#!/usr/bin/env node
// Build gpu_capture.node for Electron's Node ABI (macOS IOSurface path only).
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nativeDir = join(root, "src/render/native/electron/native");

if (process.platform !== "darwin") {
  console.log("build:native — skip (gpu_capture is macOS-only for now)");
  process.exit(0);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

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
