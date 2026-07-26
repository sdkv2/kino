import { isElectronProcess } from "../renderer.js";

let ready: Promise<void> | null = null;

/** One Electron app per process — required before BrowserWindow. */
export function ensureElectronApp(): Promise<void> {
  if (!isElectronProcess()) {
    return Promise.reject(new Error("ensureElectronApp called outside Electron"));
  }
  if (ready) return ready;
  ready = (async () => {
    const { app } = await import("electron");
    app.commandLine.appendSwitch("enable-gpu");
    app.commandLine.appendSwitch("ignore-gpu-blocklist");
    app.commandLine.appendSwitch("enable-gpu-rasterization");
    app.commandLine.appendSwitch("disable-background-timer-throttling");
    app.commandLine.appendSwitch("disable-renderer-backgrounding");
    app.commandLine.appendSwitch("force-device-scale-factor", "1");
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
