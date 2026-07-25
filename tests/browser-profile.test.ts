import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { execa } from "execa";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { launchBrowser } from "../src/render/native/browser.js";
import { liveScratchDirs } from "../src/scratch.js";

const listing = (): string[] => {
  try {
    return readdirSync(tmpdir());
  } catch {
    return [];
  }
};

// Chrome's profile dir is the same class of leak as kino's own scratch: puppeteer removes its
// default temp profile asynchronously from browser.close(), so a ^C (or an exit before the pool's
// unref'd close timer fires) leaves it behind. 338 of them / 4.1 GB had piled up next to the
// kino-* dirs. Owning the dir puts it under the registry's synchronous exit cleanup.
describe("chrome profile dir", () => {
  it("uses a registered scratch dir instead of puppeteer's default temp profile", async () => {
    // Snapshot first: sibling tests may launch raw puppeteer into the shared tmpdir.
    const before = new Set(listing().filter((n) => n.startsWith("puppeteer_dev_chrome_profile-")));
    const browser = await launchBrowser();
    try {
      const mine = liveScratchDirs().filter((d) => d.includes("kino-chrome-profile-"));
      expect(mine.length).toBeGreaterThan(0);
      expect(existsSync(mine[0])).toBe(true);
      const after = listing().filter((n) => n.startsWith("puppeteer_dev_chrome_profile-"));
      expect(after.filter((n) => !before.has(n))).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 60000);

  it("removes the profile dir once the browser disconnects", async () => {
    const browser = await launchBrowser();
    const mine = liveScratchDirs().filter((d) => d.includes("kino-chrome-profile-"));
    expect(mine.length).toBeGreaterThan(0);
    const dir = mine[mine.length - 1];
    await browser.close();
    // Poll rather than sleep a fixed amount: the disconnect handler retries against Chrome's last
    // profile writes, so the removal lands a variable moment after close() resolves.
    for (let i = 0; i < 100 && existsSync(dir); i++) await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(dir)).toBe(false);
    expect(liveScratchDirs()).not.toContain(dir);
  }, 60000);
});

// The signal sweep removes dirs synchronously, but a still-running Chrome keeps writing into its
// profile dir while we delete it — leaving a residual dir behind on every ^C. Child processes that
// can write into scratch have to be killed before the sweep, not after.
describe("chrome profile dir on SIGINT", () => {
  it.skipIf(process.platform === "win32")("leaves no profile dir behind when a render is interrupted", async () => {
    const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
    const loader = pathToFileURL(join(REPO, "node_modules", "tsx", "dist", "loader.mjs")).href;
    const fixtureDir = mkdtempSync(join(tmpdir(), "kino-browserfix-"));
    // Own TMPDIR so this assertion sees only what this child created.
    const childTmp = mkdtempSync(join(tmpdir(), "kino-browsertmp-"));
    const f = join(fixtureDir, "holder.mts");
    writeFileSync(
      f,
      `import { launchBrowser } from ${JSON.stringify(pathToFileURL(join(REPO, "src", "render", "native", "browser.js")).href)};\n` +
        `const b = await launchBrowser();\n` +
        `console.log("ready");\n` +
        `setTimeout(() => { void b; }, 60000);\n`,
    );
    const child = execa("node", ["--import", loader, f], {
      reject: false,
      env: { TMPDIR: childTmp },
      extendEnv: true,
    });
    await new Promise<void>((resolve, reject) => {
      child.stdout!.on("data", (c: Buffer) => c.toString().includes("ready") && resolve());
      child.then((r) => reject(new Error(`fixture died early: ${r.stderr}`)), reject);
    });
    expect(readdirSync(childTmp).filter((n) => n.startsWith("kino-chrome-profile-"))).toHaveLength(1);
    child.kill("SIGINT");
    const r = await child;
    // puppeteer's own SIGINT handling is disabled, so the process stays signal-terminated.
    expect(r.signal).toBe("SIGINT");
    // Only kino's own scratch is in scope here — tsx drops an unrelated `tsx-<uid>` cache dir in
    // whatever TMPDIR it is given.
    expect(readdirSync(childTmp).filter((n) => n.startsWith("kino-"))).toEqual([]);
  }, 90000);
});
