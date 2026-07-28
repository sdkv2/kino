import { angleBackend } from "../angle.js";
import { isElectronProcess } from "../renderer.js";
import { needsNoSandbox, type SandboxProbe } from "../sandbox.js";

let ready: Promise<void> | null = null;

/** Chromium flags for the render host. Pure of env/platform so tests can assert without booting
 *  Electron. */
export function gpuSwitches(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  probe: SandboxProbe = {},
): Array<string | [string, string]> {
  const switches: Array<string | [string, string]> = [
    "enable-gpu",
    "ignore-gpu-blocklist",
    "enable-gpu-rasterization",
    "enable-zero-copy",
    "disable-gpu-vsync",
    "enable-surface-synchronization",
    "disable-background-timer-throttling",
    "disable-renderer-backgrounding",
    "disable-backgrounding-occluded-windows",
    ["force-device-scale-factor", "1"],
    ["force-color-profile", "srgb"],
    // Same backend puppeteer picks (../angle.ts) — Electron otherwise falls to a slower path.
    ["use-angle", angleBackend(platform)],
    ["use-gl", "angle"],
  ];
  // Session-0 / SSH heads often crash the GPU process (exit_code=34) unless sandbox is off.
  // Linux containers block unprivileged user namespaces, so the zygote host aborts before any
  // page loads — same rule as the puppeteer path, so both renderers agree.
  if (platform === "win32" || needsNoSandbox(env, platform, probe)) {
    switches.push("disable-gpu-sandbox", "no-sandbox");
  }
  return switches;
}

/** gpuSwitches() in argv form. Linux requires this: Chromium reads the sandbox decision in
 *  electron_main_delegate.cc and the GPU flags at GPU-process startup, both BEFORE any JS runs,
 *  so app.commandLine.appendSwitch() is too late for either. Measured: appendSwitch alone gives
 *  "FATAL: Running as root without --no-sandbox" and "WebGL2 blocklisted". */
export function electronSpawnArgs(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  probe: SandboxProbe = {},
): string[] {
  const args = gpuSwitches(env, platform, probe).map((s) =>
    Array.isArray(s) ? `--${s[0]}=${s[1]}` : `--${s}`,
  );
  // Same KINO_ELECTRON_ARGS escape hatch as appendGpuSwitches below — Linux needs it applied here,
  // at the spawn site, not there (see that function's comment); otherwise the debugging hatch is
  // silently ineffective on the platform that most needs it.
  for (const arg of (env.KINO_ELECTRON_ARGS ?? "").split(/\s+/).filter(Boolean)) {
    if (arg.startsWith("--")) args.push(arg);
  }
  return args;
}

/** Apply gpuSwitches() plus the KINO_ELECTRON_ARGS escape hatch to the app command line. Still
 *  correct and harmless on macOS/Windows, where Chromium re-reads appendSwitch before its GPU
 *  process spins up — but Linux does NOT rely on this path: see electronSpawnArgs above and its
 *  use at the spawn site (electron/slots.ts), which is what actually lands the flags there. Must
 *  run before app.whenReady() — Chromium reads its command line once, at GPU-process startup. */
function appendGpuSwitches(app: { commandLine: { appendSwitch(sw: string, value?: string): void } }): void {
  for (const s of gpuSwitches()) {
    if (Array.isArray(s)) app.commandLine.appendSwitch(s[0], s[1]);
    else app.commandLine.appendSwitch(s);
  }
  // Extra escape hatch: KINO_ELECTRON_ARGS="--flag --other=1"
  for (const arg of (process.env.KINO_ELECTRON_ARGS ?? "").split(/\s+/).filter(Boolean)) {
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq === -1) app.commandLine.appendSwitch(arg.slice(2));
    else app.commandLine.appendSwitch(arg.slice(2, eq), arg.slice(eq + 1));
  }
}

/** One Electron app per process — required before BrowserWindow. */
export function ensureElectronApp(): Promise<void> {
  if (!isElectronProcess()) {
    return Promise.reject(new Error("ensureElectronApp called outside Electron"));
  }
  if (ready) return ready;
  ready = (async () => {
    const { app } = await import("electron");
    appendGpuSwitches(app);
    await app.whenReady();
  })();
  return ready;
}

export async function quitElectronApp(): Promise<void> {
  if (!isElectronProcess()) return;
  const { app } = await import("electron");
  if (!app.isReady()) return;
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    app.once("will-quit", done);
    app.quit();
    // ponytail: Electron OSR can stall will-quit; don't block parent forever.
    setTimeout(done, 2000);
  });
}
