import { isElectronProcess } from "../renderer.js";

let ready: Promise<void> | null = null;

/** Chromium flags stolen from the puppeteer path (browser.ts) — must run before ready. */
function appendGpuSwitches(app: { commandLine: { appendSwitch(sw: string, value?: string): void } }): void {
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
    // Match puppeteer's macOS ANGLE backend — without this Electron can pick a slower path.
    ["use-angle", process.platform === "darwin" ? "metal" : process.platform === "win32" ? "d3d11" : "vulkan"],
    ["use-gl", "angle"],
  ];
  // Session-0 / SSH heads often crash the GPU process (exit_code=34) unless sandbox is off.
  if (process.platform === "win32") {
    switches.push("disable-gpu-sandbox", "no-sandbox");
  }
  for (const s of switches) {
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
