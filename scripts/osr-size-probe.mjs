// TEMPORARY diagnostic launcher — delete with scripts/osr-size-probe.cjs.
//
// Spawns the probe under the same Electron binary and the same argv the real render host uses
// (electronSpawnArgs), because that is load-bearing: applying --force-device-scale-factor=1 via
// app.commandLine.appendSwitch inside the probe was TOO LATE — the display still reported
// scaleFactor 2 on a retina Mac and every capturePage came back at 2x, which the real path does
// not do. Needs dist/ (npm run build).
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { electronBinaryPath } from "../dist/render/native/renderer.js";
import { electronSpawnArgs } from "../dist/render/native/electron/app.js";

const here = dirname(fileURLToPath(import.meta.url));
const args = [...electronSpawnArgs(process.env, process.platform, {}), join(here, "osr-size-probe.cjs")];
console.log(`[probe] ${electronBinaryPath()} ${args.join(" ")}`);
const child = spawn(electronBinaryPath(), args, { stdio: "inherit" });
child.on("exit", (code, signal) => {
  console.log(`[probe] electron exited code=${code} signal=${signal ?? ""}`);
  process.exit(code ?? 1);
});
