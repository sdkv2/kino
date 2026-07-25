import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Scratch-directory registry.
 *
 * Every temp dir kino creates goes through `scratchDir()` so it is tracked, and cleanup runs even
 * when the normal `try`/`finally` never unwinds. A bare `try`/`finally` around `mkdtempSync` is NOT
 * enough: Node's default signal disposition terminates the process without unwinding, so a `^C`
 * during a multi-minute render leaks the whole scratch tree (frames, PCM, encoded segments). That
 * leak is what filled a dev machine's /var/folders with ~9.7k dirs / 17 GB.
 */

const live = new Set<string>();
let hooked = false;

/** Create a registered temp dir. Prefer this over `mkdtempSync(join(tmpdir(), ...))`. */
export function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  live.add(dir);
  installHooks();
  return dir;
}

// A dir can still be gaining entries while we delete it — a closing Chrome flushing its profile, or
// an ffmpeg child mid-write — which surfaces as ENOTEMPTY/EBUSY. Retry briefly instead of failing.
const RM = { recursive: true, force: true, maxRetries: 5, retryDelay: 50 } as const;

/**
 * Remove a scratch dir and stop tracking it. Safe to call twice.
 * Deregisters only after a successful removal, so a dir that loses the race with a child process
 * stays registered and the exit sweep retries it.
 */
export function releaseScratch(dir: string): void {
  rmSync(dir, RM);
  live.delete(dir);
}

/** Scratch dirs this process still owns (introspection for tests and `kino doctor`). */
export function liveScratchDirs(): string[] {
  return [...live];
}

const beforeSweep = new Set<() => void>();

/**
 * Register a synchronous callback to run immediately before the exit/signal sweep.
 * Use it to kill child processes that would otherwise keep writing into a scratch dir while it is
 * being removed — a live Chrome recreates its profile files faster than rmSync deletes them, which
 * leaves a residual dir behind on every interrupt.
 */
export function onBeforeSweep(fn: () => void): void {
  beforeSweep.add(fn);
}

// Sync on purpose: async cleanup cannot run from an `exit` handler.
function sweep(): void {
  for (const fn of beforeSweep) {
    try {
      fn();
    } catch {
      // A failed pre-sweep hook must not stop the removal below.
    }
  }
  for (const dir of live) {
    try {
      rmSync(dir, RM);
    } catch {
      // Best effort — a dir we cannot remove must not mask the original exit reason.
    }
  }
  live.clear();
}

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

function installHooks(): void {
  if (hooked) return;
  hooked = true;
  // Covers normal return, an uncaught throw, and explicit process.exit(). This is also the only
  // hook that does real work on Windows, where a kill terminates the target outright and the signal
  // listeners below never run.
  process.on("exit", sweep);
  for (const sig of SIGNALS) {
    const onSignal = (): void => {
      sweep();
      // Drop only OUR listener (not other subscribers'), restoring the default disposition when we
      // were the only one, then re-raise. Callers must still observe a signal-terminated process —
      // synthesizing process.exit(130) would report WIFEXITED where the shell expects WIFSIGNALED.
      process.off(sig, onSignal);
      process.kill(process.pid, sig);
    };
    process.on(sig, onSignal);
  }
}

export interface StaleScratch {
  count: number;
  bytes: number;
  /** Size walk stopped early on a very large pile; `bytes` is a floor, `count` is exact. */
  truncated: boolean;
}

// Bounds the walk so `kino doctor` stays fast even against a pathological pile.
const MAX_ENTRIES = 20_000;

/**
 * Measure abandoned `kino-*` scratch dirs under `root`, excluding any this process still owns.
 * Drives the `kino doctor` warning so a slow leak surfaces before it fills the disk.
 */
export function scanStaleScratch(
  root: string = tmpdir(),
  exclude: readonly string[] = liveScratchDirs(),
): StaleScratch {
  const skip = new Set(exclude);
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return { count: 0, bytes: 0, truncated: false };
  }
  let count = 0;
  let bytes = 0;
  let truncated = false;
  let visited = 0;
  for (const e of entries) {
    if (!e.name.startsWith("kino-") || !e.isDirectory()) continue;
    const abs = join(root, e.name);
    if (skip.has(abs)) continue;
    count++;
    if (truncated) continue; // keep counting dirs, stop measuring bytes
    const stack = [abs];
    while (stack.length) {
      if (visited >= MAX_ENTRIES) {
        truncated = true;
        break;
      }
      const cur = stack.pop()!;
      let kids;
      try {
        kids = readdirSync(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const k of kids) {
        visited++;
        const p = join(cur, k.name);
        if (k.isDirectory()) stack.push(p);
        else {
          try {
            bytes += statSync(p).size;
          } catch {
            // Vanished mid-walk (another kino process cleaning up) — skip it.
          }
        }
      }
    }
  }
  return { count, bytes, truncated };
}

/** Warn past ~1 GB of abandoned scratch — well before it can fill a working disk. */
export const STALE_BYTES_WARN = 1024 ** 3;
/** Or past this many dirs, since thousands of small ones also exhaust inodes. */
export const STALE_COUNT_WARN = 500;

function human(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/** Render a `kino doctor` verdict for abandoned scratch dirs. */
export function describeStaleScratch(s: StaleScratch, root: string): { level: "ok" | "warn"; message: string } {
  if (s.count === 0) return { level: "ok", message: `temp scratch clean (no stale kino-* dirs in ${root})` };
  const size = `${human(s.bytes)}${s.truncated ? "+" : ""}`;
  const where = `${s.count} stale kino-* temp dir${s.count === 1 ? "" : "s"} (${size}) in ${root}`;
  if (s.bytes <= STALE_BYTES_WARN && s.count <= STALE_COUNT_WARN) {
    return { level: "ok", message: `temp scratch: ${where}` };
  }
  // Deliberately not auto-deleted: a dir here may belong to a render running right now.
  return {
    level: "warn",
    message: `${where} — leftover render scratch. With no kino render running: rm -rf ${join(root, "kino-*")}`,
  };
}
