// Headless-Chrome lifecycle for the native engine. puppeteer manages its own Chrome-for-Testing
// install; KINO_CHROME (or a system Chrome) overrides for environments where that download is
// unavailable. Flags pin the deterministic surface: sRGB color, software raster, fixed scale.
import puppeteer, { type Browser } from "puppeteer";
import { existsSync } from "node:fs";

const SYSTEM_CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

export async function resolveExecutable(): Promise<string | undefined> {
  if (process.env.KINO_CHROME) return process.env.KINO_CHROME;
  // Chrome-for-Testing has no linux-arm64 builds; puppeteer downloads an x86-64 binary there
  // (crashes at launch with free(): invalid pointer). Use the system's native Chromium instead.
  if (process.platform === "linux" && process.arch === "arm64") {
    return SYSTEM_CHROME.find((p) => existsSync(p));
  }
  try {
    const p = await puppeteer.executablePath();
    if (p && existsSync(p)) return p;
  } catch {
    // fall through to system installs
  }
  return SYSTEM_CHROME.find((p) => existsSync(p));
}

// Browser pool with an idle grace period. One browser per render WORKER, not per render: CDP
// screenshot capture serializes inside a browser process, so page-level workers in one browser
// gain nothing — process-level parallelism is what makes the frame loop scale. Launch costs ~1s
// per browser; each slot closes 1.5s after its last release (the CDP socket would otherwise hold
// the CLI process open forever, and an immediate close would forfeit reuse across render calls).
// Idle timers are unref'd so they never block exit by themselves.
interface Slot {
  browser: Browser;
  refs: number;
  closeTimer: NodeJS.Timeout | null;
}
const pool = new Map<number, Promise<Slot>>();

export async function acquireBrowser(slot = 0): Promise<Browser> {
  const existing = pool.get(slot);
  if (existing) {
    const s = await existing.catch(() => null);
    if (s && s.browser.connected) {
      if (s.closeTimer) clearTimeout(s.closeTimer);
      s.closeTimer = null;
      s.refs++;
      return s.browser;
    }
    pool.delete(slot);
  }
  const created = launchBrowser().then((browser): Slot => ({ browser, refs: 1, closeTimer: null }));
  pool.set(slot, created);
  return (await created).browser;
}

export async function releaseBrowser(slot = 0): Promise<void> {
  const s = await pool.get(slot)?.catch(() => null);
  if (!s) return;
  s.refs = Math.max(0, s.refs - 1);
  if (s.refs > 0) return;
  if (s.closeTimer) clearTimeout(s.closeTimer);
  s.closeTimer = setTimeout(() => {
    pool.delete(slot);
    void s.browser.close().catch(() => {});
  }, 1500);
  s.closeTimer.unref();
}

export async function launchBrowser(): Promise<Browser> {
  const executablePath = await resolveExecutable();
  return puppeteer.launch({
    headless: true,
    executablePath,
    protocolTimeout: 120000,
    args: [
      "--force-color-profile=srgb",
      "--disable-gpu",
      "--force-device-scale-factor=1",
      "--hide-scrollbars",
      "--mute-audio",
      "--disable-extensions",
      "--no-default-browser-check",
      "--disable-background-networking",
      // Worker pages are background tabs; without these Chrome throttles their timers/rAF and a
      // non-frontmost page can stall indefinitely.
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
    ],
  });
}
