// Headless-Chrome lifecycle for the native engine. puppeteer manages its own Chrome-for-Testing
// install; KINO_CHROME (or a system Chrome) overrides for environments where that download is
// unavailable. Flags pin the deterministic surface: sRGB color, fixed scale; the GL backend is
// resolved per machine by resolveGL — hardware ANGLE on macOS, SwiftShader elsewhere, either one
// forced with KINO_GPU=1/0.
import puppeteer, { type Browser } from "puppeteer";
import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { liveScratchDirs, onBeforeSweep, releaseScratch, scratchDir } from "../../scratch.js";

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

/** Which GL backend this machine renders with. Explicit `KINO_GPU=1` / `KINO_GPU=0` always wins;
 *  with neither set the backend is auto-detected.
 *
 *  The detection is a platform rule, not a runtime probe, and that is deliberate. macOS ships
 *  Metal, so hardware ANGLE is always there. A Linux or Windows box is a coin flip — the same code
 *  runs on a workstation with a discrete card and on a CI runner or a Pi with no usable GL at all —
 *  and a probe that guessed wrong would fail SILENTLY: a dead GL context renders a flat wash, not
 *  an error. So only the known-good platform auto-enables, and everywhere else opts in explicitly.
 *
 *  Consequence worth knowing: two machines can now choose different backends, and gpu/sw frames are
 *  not bit-identical. `frameCacheKeys` keys the two apart so they never cross-serve, and the
 *  resolved backend is printed on every render. Pin `KINO_GPU=0` wherever output must match
 *  byte-for-byte across machines (CI comparisons, golden frames). */
export function resolveGL(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): "gpu" | "sw" {
  if (env.KINO_GPU === "1") return "gpu";
  if (env.KINO_GPU === "0") return "sw";
  return platform === "darwin" ? "gpu" : "sw";
}

/** GL + determinism launch flags. Pure of env/platform so tests can assert without launching. */
export function launchArgs(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] {
  const shared = [
    "--force-color-profile=srgb",
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
    "--disable-gpu-vsync",
    "--enable-surface-synchronization",
    "--disable-dev-shm-usage",
  ];
  // Hardware ANGLE (Metal on darwin) — auto on macOS, opt-in elsewhere via KINO_GPU=1. Trades
  // cross-machine bit-determinism for speed on raymarch/SSAA. See resolveGL.
  if (resolveGL(env, platform) === "gpu") {
    return [
      ...shared,
      "--use-gl=angle",
      platform === "darwin" ? "--use-angle=metal" : "--use-angle",
    ];
  }
  return [
    ...shared,
    // Software WebGL2 — --disable-gpu alone blocks all GL contexts; shaders need this.
    "--use-gl=angle",
    "--use-angle=swiftshader-webgl",
    "--enable-unsafe-swiftshader",
  ];
}

/** Cache / signature tag for the active GL backend. */
export function glMode(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): "gpu" | "sw" {
  return resolveGL(env, platform);
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

/** Scratch prefix for Chrome profile dirs. Also the marker `kino doctor` scans for. */
export const CHROME_PROFILE_PREFIX = "kino-chrome-profile-";
/** Written inside a profile dir so an abandoned one can be traced back to its Chrome process. */
const PIDFILE = ".kino-chrome.pid";

/**
 * CDP transport. Pipe by default so Chrome dies with its parent; KINO_CHROME_TRANSPORT=ws opts back
 * into the websocket port, which is what `chrome://inspect` needs to attach to a live render.
 *
 * The escape hatch reintroduces the orphan: verified that with `ws` a SIGKILLed parent strands
 * Chrome, while pipe reaps it. Use it for a debugging session, not for batch renders.
 */
function usePipeTransport(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.KINO_CHROME_TRANSPORT !== "ws";
}

// Browsers this process launched, tracked so the pre-sweep hook can reach them synchronously (the
// pool holds Promises, which a signal handler cannot await).
const liveBrowsers = new Set<Browser>();
let killHookInstalled = false;

/**
 * SIGKILL a Chrome process tree, synchronously and in full.
 *
 * Signalling the pid alone is not enough: that is only the browser process, and Chrome runs a whole
 * tree (zygote, GPU, renderers, utility) beside it — six processes for a bare launch here. Those
 * descendants do die on their own once the browser process goes, because their mojo IPC channel
 * breaks, but they die ASYNCHRONOUSLY, and the scratch sweep that follows is synchronous. Measured
 * at the instant the sweep began removing the profile dir: 6 of 6 processes still alive. Every one
 * of them can still write into the dir being deleted, which is how an interrupted render left a
 * residual `kino-chrome-profile-*` behind.
 *
 * puppeteer spawns Chrome `detached` on POSIX, so the browser process is its own process-group
 * leader and the negated pid addresses the entire tree in one syscall — the same mechanism
 * puppeteer's own kill path uses. After it returns, no process in the tree can execute another
 * instruction, so nothing can recreate what the sweep is about to remove.
 */
export function killBrowserTree(proc: ChildProcess | null | undefined): void {
  const pid = proc?.pid;
  if (proc == null || pid == null) return;
  // SIGKILL, not close(): close() is async and cannot complete inside an exit handler, and SIGKILL
  // gives Chrome no chance to rewrite the profile files we are about to delete.
  if (process.platform !== "win32") {
    try {
      // Negated pid = the process group led by Chrome's browser process, i.e. the whole tree.
      process.kill(-pid, "SIGKILL");
      return;
    } catch {
      // Not a group leader (a browser we connected to rather than spawned), the group is already
      // gone, or we may not signal it. Fall through and at least take the process we do own.
    }
  }
  try {
    // Windows has no process groups to signal; Node maps this onto TerminateProcess. Chrome's
    // children are left to the pipe-close teardown, and the sweep there runs from `exit` — after
    // a normal unwind — rather than from a signal, so it is not racing an interrupt.
    proc.kill("SIGKILL");
  } catch {
    // already gone
  }
}

/** SIGKILL every Chrome we launched, so nothing is writing into a profile dir during the sweep. */
function installKillHook(): void {
  if (killHookInstalled) return;
  killHookInstalled = true;
  onBeforeSweep(() => {
    for (const b of liveBrowsers) killBrowserTree(b.process());
    liveBrowsers.clear();
  });
}

export async function launchBrowser(): Promise<Browser> {
  const executablePath = await resolveExecutable();
  installKillHook();
  // Own Chrome's profile dir rather than letting puppeteer pick its own temp one. puppeteer deletes
  // its default profile *asynchronously* from browser.close(), so it survives both a ^C and any exit
  // that beats releaseBrowser's unref'd close timer — that leaked GBs of
  // puppeteer_dev_chrome_profile-* dirs alongside kino's own scratch. Registered here, it is removed
  // synchronously on exit like every other scratch dir.
  const userDataDir = scratchDir(CHROME_PROFILE_PREFIX);
  try {
    const browser = await puppeteer.launch({
      headless: true,
      executablePath,
      protocolTimeout: 120000,
      args: launchArgs(),
      userDataDir,
      // CDP over a stdio pipe rather than a websocket port. This is the ONLY thing that reaps Chrome
      // when the parent dies without unwinding — a SIGKILL, or a test runner tearing down a worker,
      // runs no exit handler, so nothing in-process can do it. Chrome exits by itself when the pipe
      // closes. Measured identical screenshot throughput to the websocket transport, and kino never
      // uses wsEndpoint()/connect(), so it is a drop-in.
      pipe: usePipeTransport(),
      // Own signal handling instead of puppeteer's. Its handlers call process.exit(), which both
      // pre-empts the re-raise that keeps kino's exit status signal-derived, and races the scratch
      // sweep with an async profile cleanup — leaving a residual profile dir on every ^C.
      // killChildBrowsers() below replaces them, synchronously, before the sweep runs.
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
    liveBrowsers.add(browser);
    browser.once("disconnected", () => liveBrowsers.delete(browser));
    // Record the pid inside the profile dir. An orphan is exactly the case where the sweep never
    // ran, so the dir survives with this file in it — which is what lets `kino doctor` tell a live
    // stranded browser (hundreds of MB of RAM) apart from a merely leftover dir (harmless disk).
    const pid = browser.process()?.pid;
    if (pid != null) {
      try {
        writeFileSync(join(userDataDir, PIDFILE), String(pid));
      } catch {
        // Diagnostics only — never fail a render because the pidfile could not be written.
      }
    }
    // Release on the Chrome PROCESS exiting, not on "disconnected": disconnect fires when the CDP
    // connection drops, which precedes process exit, so Chrome is often still flushing its profile
    // and the removal loses the race (ENOTEMPTY). Waiting for exit means nothing can be writing.
    // Guarded: this runs off an event, where a throw would be an uncaught exception that takes down
    // the render. If it still fails, the dir stays registered and the exit sweep gets it.
    const release = (): void => {
      try {
        releaseScratch(userDataDir);
      } catch {
        // keep it registered for the exit sweep
      }
    };
    const proc = browser.process();
    if (proc) proc.once("exit", release);
    else browser.once("disconnected", release); // browser we connected to, not spawned

    return browser;
  } catch (e) {
    releaseScratch(userDataDir);
    throw e;
  }
}

export interface OrphanBrowsers {
  count: number;
  pids: number[];
}

// EPERM means the pid exists but belongs to another user — still alive. ESRCH means gone.
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Find headless Chrome processes stranded by an interrupted render: a leftover profile dir whose
 * recorded pid is still running. Dirs this process still owns are excluded, so `kino doctor`'s own
 * Chrome health check never reports itself.
 *
 * Caveat: `kill(pid, 0)` cannot tell a recycled pid from the original, so this can over-report. The
 * alternative — enumerating processes per platform — is not worth it for a diagnostic row.
 */
export function scanOrphanBrowsers(
  root: string = tmpdir(),
  exclude: readonly string[] = liveScratchDirs(),
): OrphanBrowsers {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return { count: 0, pids: [] };
  }
  const skip = new Set(exclude);
  const pids: number[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || !e.name.startsWith(CHROME_PROFILE_PREFIX)) continue;
    const dir = join(root, e.name);
    if (skip.has(dir)) continue;
    let raw: string;
    try {
      raw = readFileSync(join(dir, PIDFILE), "utf8");
    } catch {
      continue; // no pidfile — pre-fix dir, or Chrome never started
    }
    const pid = Number(raw.trim());
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (pidAlive(pid)) pids.push(pid);
  }
  return { count: pids.length, pids };
}

/** Render a `kino doctor` verdict for stranded browsers. Reports only — never kills. */
export function describeOrphanBrowsers(o: OrphanBrowsers): { level: "ok" | "warn"; message: string } {
  if (o.count === 0) return { level: "ok", message: "no orphaned render browsers" };
  const shown = o.pids.slice(0, 6);
  const list = shown.join(" ") + (o.pids.length > shown.length ? " …" : "");
  return {
    level: "warn",
    message:
      `${o.count} orphaned headless Chrome process${o.count === 1 ? "" : "es"} from interrupted ` +
      `renders (pid ${list}) — each holds ~70-170 MB. Stop them with: kill ${o.pids.join(" ")}`,
  };
}
