import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { execa } from "execa";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { killBrowserTree, launchBrowser } from "../src/render/native/browser.js";
import { liveScratchDirs } from "../src/scratch.js";

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

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
    const browser = await launchBrowser();
    try {
      const mine = liveScratchDirs().filter((d) => d.includes("kino-chrome-profile-"));
      expect(mine.length).toBeGreaterThan(0);
      expect(existsSync(mine[0])).toBe(true);
      expect(listing().filter((n) => n.startsWith("puppeteer_dev_chrome_profile-"))).toEqual([]);
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

// The pre-sweep kill has to leave NOTHING running that can write into the profile dir, and Chrome
// is a tree, not a process — a bare launch here is six of them. Signalling the browser pid alone
// only breaks the descendants' IPC channel; they then exit on their own schedule, which is a race
// the synchronous sweep can lose. Stand-in for that tree: a detached shell holding a grandchild
// that nothing else would ever reap, so a leader-only kill leaves it behind indefinitely rather
// than intermittently.
describe("killBrowserTree", () => {
  it.skipIf(process.platform === "win32")("kills the whole process tree, not just the leader", async () => {
    // `wait` keeps the shell alive as group leader instead of exec'ing away into the child.
    const proc = spawn("/bin/sh", ["-c", "sleep 120 & echo $!; wait"], {
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const leader = proc.pid!;
    const grandchild = await new Promise<number>((resolve, reject) => {
      proc.stdout!.on("data", (c: Buffer) => resolve(Number(c.toString().trim())));
      proc.once("error", reject);
      proc.once("exit", () => reject(new Error("fixture shell exited before reporting its child")));
    });
    try {
      expect(grandchild).toBeGreaterThan(0);
      expect(alive(leader)).toBe(true);
      expect(alive(grandchild)).toBe(true);

      killBrowserTree(proc);

      // Both are gone the moment SIGKILL lands, but the pids linger until they are reaped — the
      // leader by this process's event loop, the grandchild by init once it is re-parented. Poll
      // for the reap rather than asserting on that bookkeeping delay.
      for (let i = 0; i < 200 && (alive(leader) || alive(grandchild)); i++) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(alive(leader)).toBe(false);
      expect(alive(grandchild)).toBe(false);
    } finally {
      // Never strand the stand-in tree, pass or fail.
      for (const pid of [leader, grandchild]) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
  }, 30000);

  it("is a no-op for a browser that never got a process", () => {
    expect(() => killBrowserTree(null)).not.toThrow();
    expect(() => killBrowserTree(undefined)).not.toThrow();
  });
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
    // Deliberately NOT polled. The child has fully exited by the time `await child` resolves, and
    // it was the only process that would ever remove this dir — its scratch sweep runs
    // synchronously, before the re-raised signal terminates it. So there is nothing left to wait
    // for: a dir still here is a real leak, and a retry loop would only hide it.
    //
    // Only kino's own scratch is in scope here — tsx drops an unrelated `tsx-<uid>` cache dir in
    // whatever TMPDIR it is given.
    const left = readdirSync(childTmp).filter((n) => n.startsWith("kino-"));
    // Assert on the contents, not just the names: a survivor means something was still writing
    // into the dir while the sweep deleted it, and the residue says what.
    expect(left.map((n) => `${n} -> ${readdirSync(join(childTmp, n)).join(" ") || "(empty)"}`)).toEqual([]);
  }, 90000);
});
