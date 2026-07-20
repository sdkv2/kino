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

async function resolveExecutable(): Promise<string | undefined> {
  if (process.env.KINO_CHROME) return process.env.KINO_CHROME;
  try {
    const p = await puppeteer.executablePath();
    if (p && existsSync(p)) return p;
  } catch {
    // fall through to system installs
  }
  return SYSTEM_CHROME.find((p) => existsSync(p));
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
