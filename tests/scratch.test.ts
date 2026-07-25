import { describe, it, expect } from "vitest";
import { execa } from "execa";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { STALE_BYTES_WARN, STALE_COUNT_WARN, describeStaleScratch, liveScratchDirs, releaseScratch, scanStaleScratch, scratchDir } from "../src/scratch.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
// The tsx *CLI* wraps the script in a parent process that translates signals, which would hide
// whether the child was signal-terminated. Load the transform into one node process instead.
// file:// URLs, not bare paths: a Windows path like C:\... is not a valid ESM specifier.
const TSX_LOADER = pathToFileURL(join(REPO, "node_modules", "tsx", "dist", "loader.mjs")).href;

// Run a fixture script under tsx. The fixture prints its scratch dir on stdout line 1 then blocks,
// so the parent can signal it mid-flight and inspect what survived. `.mts` so the file is
// unambiguously ESM even though it lives outside the package.
async function spawnHolder(body: string): Promise<{ dir: string; kill: (sig: NodeJS.Signals) => void; done: Promise<{ signal?: string; exitCode?: number }> }> {
  const f = join(mkdtempSync(join(tmpdir(), "kino-fixture-")), "holder.mts");
  const mod = JSON.stringify(pathToFileURL(join(REPO, "src", "scratch.js")).href);
  writeFileSync(
    f,
    `import { scratchDir, releaseScratch } from ${mod};\n` +
      `import { writeFileSync } from "node:fs";\n` +
      `import { join } from "node:path";\n` +
      `void releaseScratch; void writeFileSync; void join;\n` +
      `${body}\n`,
  );
  const child = execa("node", ["--import", TSX_LOADER, f], { reject: false, all: false });
  const dir = await new Promise<string>((resolve, reject) => {
    let buf = "";
    child.stdout!.on("data", (c: Buffer) => {
      buf += c.toString();
      const nl = buf.indexOf("\n");
      if (nl >= 0) resolve(buf.slice(0, nl).trim());
    });
    // reject:false means a crashed child resolves — surface its output instead of hanging.
    child.then(
      (r) => reject(new Error(`fixture exited before printing a dir: ${r.stderr || r.stdout || "(no output)"}`)),
      reject,
    );
  });
  return {
    dir,
    kill: (sig) => child.kill(sig),
    done: child.then((r) => ({ signal: r.signal, exitCode: r.exitCode })),
  };
}

// Windows has no POSIX signal delivery: process.kill() terminates the target outright, so no
// handler runs and there is no signal-derived exit status to assert. The exit-path coverage
// below (uncaught throw) still runs everywhere.
const posixSignals = process.platform !== "win32";

describe("scratch registry", () => {
  it("creates a registered directory under tmpdir with the given prefix", () => {
    const dir = scratchDir("kino-unit-");
    try {
      expect(existsSync(dir)).toBe(true);
      expect(dir.startsWith(join(tmpdir(), "kino-unit-"))).toBe(true);
      expect(liveScratchDirs()).toContain(dir);
    } finally {
      releaseScratch(dir);
    }
  });

  it("releaseScratch removes the directory and deregisters it", () => {
    const dir = scratchDir("kino-unit-");
    writeFileSync(join(dir, "payload.bin"), "x");
    releaseScratch(dir);
    expect(existsSync(dir)).toBe(false);
    expect(liveScratchDirs()).not.toContain(dir);
  });

  // The disk-filling bug: a long render holds a scratch dir, the user hits ^C, and the
  // try/finally never unwinds. Cleanup has to survive the signal.
  it.skipIf(!posixSignals)("removes registered dirs when the process is interrupted with SIGINT", async () => {
    const h = await spawnHolder(`
      const d = scratchDir("kino-sigint-");
      writeFileSync(join(d, "big.bin"), Buffer.alloc(1024 * 1024));
      console.log(d);
      setTimeout(() => {}, 30000);
    `);
    expect(existsSync(h.dir)).toBe(true);
    h.kill("SIGINT");
    const r = await h.done;
    expect(existsSync(h.dir)).toBe(false);
    // Re-raised, not synthesized: the shell must still see a signal-terminated process.
    expect(r.signal).toBe("SIGINT");
  }, 30000);

  it.skipIf(!posixSignals)("removes registered dirs when the process is terminated with SIGTERM", async () => {
    const h = await spawnHolder(`
      const d = scratchDir("kino-sigterm-");
      console.log(d);
      setTimeout(() => {}, 30000);
    `);
    h.kill("SIGTERM");
    const r = await h.done;
    expect(existsSync(h.dir)).toBe(false);
    expect(r.signal).toBe("SIGTERM");
  }, 30000);

  it("removes registered dirs when the process dies of an uncaught exception", async () => {
    const h = await spawnHolder(`
      const d = scratchDir("kino-throw-");
      console.log(d);
      setTimeout(() => { throw new Error("boom"); }, 50);
    `);
    const r = await h.done;
    expect(existsSync(h.dir)).toBe(false);
    expect(r.exitCode).toBe(1);
  }, 30000);

  it.skipIf(!posixSignals)("leaves an already-released dir alone and still exits cleanly", async () => {
    const h = await spawnHolder(`
      const d = scratchDir("kino-rel-");
      console.log(d);
      releaseScratch(d);
      setTimeout(() => {}, 30000);
    `);
    h.kill("SIGINT");
    const r = await h.done;
    expect(existsSync(h.dir)).toBe(false);
    expect(r.signal).toBe("SIGINT");
  }, 30000);
});

describe("scanStaleScratch", () => {
  it("counts and sizes kino-* directories in the scanned root", () => {
    const root = mkdtempSync(join(tmpdir(), "kino-scanroot-"));
    try {
      for (const n of ["kino-a-aaaaaa", "kino-b-bbbbbb"]) {
        mkdirSync(join(root, n), { recursive: true });
        writeFileSync(join(root, n, "f.bin"), Buffer.alloc(4096));
      }
      const r = scanStaleScratch(root);
      expect(r.count).toBe(2);
      expect(r.bytes).toBeGreaterThanOrEqual(8192);
    } finally {
      releaseScratch(root);
    }
  });

  it("ignores non-kino entries and plain files", () => {
    const root = mkdtempSync(join(tmpdir(), "kino-scanroot-"));
    try {
      mkdirSync(join(root, "other-tool-xyz"), { recursive: true });
      writeFileSync(join(root, "kino-not-a-dir"), "x");
      expect(scanStaleScratch(root).count).toBe(0);
    } finally {
      releaseScratch(root);
    }
  });

  it("does not count dirs this process still owns", () => {
    const root = mkdtempSync(join(tmpdir(), "kino-scanroot-"));
    const mine = mkdtempSync(join(root, "kino-live-"));
    try {
      // scanStaleScratch reports what is abandoned, so a dir the caller is actively
      // using must not be reported as stale.
      expect(scanStaleScratch(root, [mine]).count).toBe(0);
      expect(scanStaleScratch(root).count).toBe(1);
    } finally {
      releaseScratch(root);
    }
  });

  it("reports zero for a root with no kino dirs", () => {
    const root = mkdtempSync(join(tmpdir(), "kino-scanroot-"));
    try {
      expect(scanStaleScratch(root)).toEqual({ count: 0, bytes: 0, truncated: false });
      expect(readdirSync(root)).toEqual([]);
    } finally {
      releaseScratch(root);
    }
  });
});

// Guards the sweep: a raw mkdtempSync in src/ is a dir the registry cannot clean on ^C, which is
// exactly how the 17 GB pile accumulated. New scratch dirs must go through scratchDir().
describe("src uses the scratch registry", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
    );

  it("has no direct mkdtempSync calls outside scratch.ts", () => {
    const offenders = walk(join(REPO, "src"))
      .filter((f) => f !== join(REPO, "src", "scratch.ts"))
      .filter((f) => /\bmkdtempSync\s*\(/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(REPO.length + 1));
    expect(offenders).toEqual([]);
  });
});

describe("describeStaleScratch", () => {
  const ROOT = "/tmp";

  it("reports ok when there is nothing stale", () => {
    const r = describeStaleScratch({ count: 0, bytes: 0, truncated: false }, ROOT);
    expect(r.level).toBe("ok");
  });

  it("reports ok for a small amount of leftover scratch", () => {
    const r = describeStaleScratch({ count: 3, bytes: 5 * 1024 * 1024, truncated: false }, ROOT);
    expect(r.level).toBe("ok");
    expect(r.message).toContain("3");
  });

  it("warns once the pile passes the size threshold", () => {
    const r = describeStaleScratch({ count: 12, bytes: STALE_BYTES_WARN + 1, truncated: false }, ROOT);
    expect(r.level).toBe("warn");
    expect(r.message).toContain("GB");
  });

  it("warns on dir count even when the pile is small on disk", () => {
    const r = describeStaleScratch({ count: STALE_COUNT_WARN + 1, bytes: 1024, truncated: false }, ROOT);
    expect(r.level).toBe("warn");
  });

  it("marks a truncated measurement as a floor", () => {
    const r = describeStaleScratch({ count: 9726, bytes: 17 * 1024 ** 3, truncated: true }, ROOT);
    expect(r.level).toBe("warn");
    expect(r.message).toContain("+");
  });

  it("tells the user how to clear it without breaking a live render", () => {
    const r = describeStaleScratch({ count: 9726, bytes: 17 * 1024 ** 3, truncated: false }, ROOT);
    expect(r.message).toContain("rm -rf");
    expect(r.message.toLowerCase()).toContain("no kino");
  });
});
