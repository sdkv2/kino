import { describe, it, expect } from "vitest";
import { execa } from "execa";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CHROME_PROFILE_PREFIX,
  describeOrphanBrowsers,
  scanOrphanBrowsers,
} from "../src/render/native/browser.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const TSX_LOADER = pathToFileURL(join(REPO, "node_modules", "tsx", "dist", "loader.mjs")).href;

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// A SIGKILLed parent runs no exit handler, so nothing in-process can reap Chrome. Chrome has to
// notice on its own — which is what the CDP pipe transport gives us, since the pipe closes when the
// parent dies. Without it, an interrupted render strands a ~70-170 MB browser tree indefinitely;
// that is how 437 orphaned processes holding 15.8 GB accumulated over one afternoon.
describe("orphaned Chrome", () => {
  it("exits on its own when its parent node process is SIGKILLed", async () => {
    const childTmp = mkdtempSync(join(tmpdir(), "kino-orphantmp-"));
    const f = join(mkdtempSync(join(tmpdir(), "kino-orphanfix-")), "holder.mts");
    writeFileSync(
      f,
      `import { launchBrowser } from ${JSON.stringify(pathToFileURL(join(REPO, "src", "render", "native", "browser.js")).href)};\n` +
        `const b = await launchBrowser();\n` +
        `console.log(JSON.stringify({ chromePid: b.process()?.pid }));\n` +
        `setTimeout(() => { void b; }, 120000);\n`,
    );
    const child = execa("node", ["--import", TSX_LOADER, f], {
      reject: false,
      env: { TMPDIR: childTmp },
      extendEnv: true,
    });
    const chromePid = await new Promise<number>((resolve, reject) => {
      let buf = "";
      child.stdout!.on("data", (c: Buffer) => {
        buf += c.toString();
        const line = buf.split("\n").find((l) => l.trim().startsWith("{"));
        if (line) resolve(JSON.parse(line).chromePid as number);
      });
      child.then((r) => reject(new Error(`fixture died early: ${r.stderr || r.stdout}`)), reject);
    });
    expect(chromePid).toBeGreaterThan(0);
    expect(alive(chromePid)).toBe(true);
    try {
      child.kill("SIGKILL");
      await child;
      // Poll: Chrome notices the closed pipe and tears down asynchronously.
      for (let i = 0; i < 100 && alive(chromePid); i++) await sleep(100);
      expect(alive(chromePid)).toBe(false);
    } finally {
      // Never leak a browser out of this test, pass or fail.
      if (alive(chromePid)) {
        try {
          process.kill(chromePid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
  }, 120000);
});

describe("scanOrphanBrowsers", () => {
  // Build a fake profile dir carrying a pidfile, the way launchBrowser does.
  const profile = (root: string, name: string, pid: string | null): string => {
    const dir = join(root, `${CHROME_PROFILE_PREFIX}${name}`);
    mkdirSync(dir, { recursive: true });
    if (pid !== null) writeFileSync(join(dir, ".kino-chrome.pid"), pid);
    return dir;
  };

  it("reports a profile dir whose recorded pid is still alive", () => {
    const root = mkdtempSync(join(tmpdir(), "kino-orphanroot-"));
    // This test process is guaranteed alive, so it stands in for a stranded browser.
    profile(root, "live", String(process.pid));
    const r = scanOrphanBrowsers(root, []);
    expect(r.count).toBe(1);
    expect(r.pids).toEqual([process.pid]);
  });

  it("ignores a profile dir whose recorded pid is gone", () => {
    const root = mkdtempSync(join(tmpdir(), "kino-orphanroot-"));
    // Max pid + 1 is never live.
    profile(root, "dead", "4194305");
    expect(scanOrphanBrowsers(root, []).count).toBe(0);
  });

  it("ignores dirs with a missing or unparseable pidfile", () => {
    const root = mkdtempSync(join(tmpdir(), "kino-orphanroot-"));
    profile(root, "nopid", null);
    profile(root, "garbage", "not-a-pid");
    profile(root, "negative", "-1");
    expect(scanOrphanBrowsers(root, []).count).toBe(0);
  });

  it("ignores non-profile dirs", () => {
    const root = mkdtempSync(join(tmpdir(), "kino-orphanroot-"));
    mkdirSync(join(root, "kino-native-still-abc"), { recursive: true });
    writeFileSync(join(root, "kino-native-still-abc", ".kino-chrome.pid"), String(process.pid));
    expect(scanOrphanBrowsers(root, []).count).toBe(0);
  });

  // doctor launches a browser of its own for the Chrome health check; that profile must not be
  // reported as an orphan while this process still owns it.
  it("excludes profile dirs this process still owns", () => {
    const root = mkdtempSync(join(tmpdir(), "kino-orphanroot-"));
    const mine = profile(root, "mine", String(process.pid));
    expect(scanOrphanBrowsers(root, [mine]).count).toBe(0);
  });

  it("returns zero for a missing root instead of throwing", () => {
    expect(scanOrphanBrowsers(join(tmpdir(), "kino-nope-nope"), []).count).toBe(0);
  });
});

describe("describeOrphanBrowsers", () => {
  it("reports ok when there are none", () => {
    expect(describeOrphanBrowsers({ count: 0, pids: [] }).level).toBe("ok");
  });

  it("warns and lists the pids so the user can act", () => {
    const r = describeOrphanBrowsers({ count: 2, pids: [4833, 4835] });
    expect(r.level).toBe("warn");
    expect(r.message).toContain("4833");
    expect(r.message).toContain("kill ");
  });

  it("truncates a long pid list but keeps the total count", () => {
    const pids = [1, 2, 3, 4, 5, 6, 7, 8];
    const r = describeOrphanBrowsers({ count: pids.length, pids });
    expect(r.message).toContain("8");
    expect(r.message).toContain("…");
  });
});
