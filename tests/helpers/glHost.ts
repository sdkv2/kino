// Parent side of the compositor GL test harness.
//
// The compositor tests need a real WebGL2 context to assert on pixels. They used to get one by
// calling `puppeteer.launch()` per probe — a browser process per assertion. This boots one Electron
// host per test file instead and reuses it for every probe in that file.
//
// Scope note: the host is a module singleton, so it is per *test file*, not per run — vitest gives
// each file its own worker process and a module singleton cannot span them. Sharing one host across
// the whole run would mean a globalSetup-owned process plus a socket for workers to reach it; the
// per-file host already collapses N browser launches per file down to one, which is where the cost
// was.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Socket } from "node:net";
import { createInterface } from "node:readline";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { electronBinaryPath } from "../../src/render/native/renderer.js";

const here = dirname(fileURLToPath(import.meta.url));
const MAIN = join(here, "glHost.main.cjs");
const TAG = "@KINOGL ";

/** SwiftShader, not this machine's GPU. These are the flags the puppeteer harness passed, kept
 *  verbatim: the compositor tests assert on exact pixel values, so they must run on the one
 *  rasteriser that is identical on every OS and every card. */
const GL_ARGS = [
  "--no-sandbox",
  "--disable-gpu-sandbox",
  "--use-gl=angle",
  "--use-angle=swiftshader-webgl",
  "--enable-unsafe-swiftshader",
];

const BOOT_TIMEOUT_MS = 60_000;
const PROBE_TIMEOUT_MS = 120_000;

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

class GlHost {
  private child!: ChildProcessWithoutNullStreams;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private cmd: NodeJS.WritableStream | null = null;
  private readonly booted: Promise<void>;
  private readonly scratch = mkdtempSync(join(tmpdir(), "kino-glhost-"));
  private closed = false;

  constructor() {
    this.booted = new Promise<void>((resolve, reject) => {
      const onReady = () => resolve();
      const fail = (e: Error) => reject(e);
      const timer = setTimeout(() => fail(new Error("electron GL host did not boot within 60s")), BOOT_TIMEOUT_MS);
      timer.unref?.();

      const afterReady = () => {
        clearTimeout(timer);
        onReady();
      };

      if (process.platform === "win32") {
        // Electron closes piped stdin immediately on Windows, so commands go over TCP instead —
        // the same split src/render/native/electron/slots.ts makes for the render host.
        const server = createServer((sock: Socket) => {
          this.cmd = sock;
          server.close();
        });
        server.once("error", fail);
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address();
          if (!addr || typeof addr === "string") {
            fail(new Error("GL host cmd server failed to bind"));
            return;
          }
          this.spawnChild({ KINO_GLHOST_CMD_PORT: String(addr.port) }, afterReady, fail);
        });
      } else {
        this.spawnChild({}, afterReady, fail);
        this.cmd = this.child.stdin;
      }
    });
  }

  private spawnChild(extraEnv: Record<string, string>, onReady: () => void, onFail: (e: Error) => void): void {
    this.child = spawn(electronBinaryPath(), [...GL_ARGS, MAIN], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv },
      windowsHide: true,
    });

    this.child.once("error", onFail);
    this.child.once("exit", (code, signal) => {
      const err = new Error(`electron GL host exited code=${code} signal=${signal ?? ""}`);
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      this.pending.clear();
      if (!this.closed) onFail(err);
    });

    // SwiftShader is loud and Electron is louder. Only surface stderr that is not the known noise,
    // so a genuine page error stays visible without burying the run in GL chatter.
    this.child.stderr.on("data", (chunk: Buffer) => {
      const s = chunk.toString("utf8");
      // Benign Chromium/Electron teardown and GPU-plumbing chatter. command_buffer_proxy_impl and
      // process_mac fire when a hidden window's context is torn down at quit; they are not probe
      // failures (a real one arrives as a rejected probe, with the page's own message).
      if (
        /GL_INVALID_OPERATION|gl_utils\.cc|Too many GL errors|swiftshader|GPU stall/i.test(s) ||
        /command_buffer_proxy_impl\.cc|task_policy_set|process_mac\.cc/i.test(s)
      ) {
        return;
      }
      process.stderr.write(chunk);
    });

    createInterface({ input: this.child.stdout }).on("line", (line: string) => {
      if (!line.startsWith(TAG)) return; // Chromium chatter — not ours
      let msg: { id: number; ok: boolean; value?: unknown; error?: string };
      try {
        msg = JSON.parse(line.slice(TAG.length));
      } catch {
        return;
      }
      if (msg.id === 0) {
        onReady();
        return;
      }
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.value);
      else p.reject(new Error(msg.error ?? "GL probe failed"));
    });
  }

  async send(req: Record<string, unknown>): Promise<unknown> {
    await this.booted;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`GL probe ${id} timed out after ${PROBE_TIMEOUT_MS}ms`));
      }, PROBE_TIMEOUT_MS);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.cmd!.write(JSON.stringify({ ...req, id }) + "\n");
    });
  }

  htmlFile(html: string, n: number): string {
    const p = join(this.scratch, `probe-${n}.html`);
    writeFileSync(p, html);
    return p;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.cmd?.write(JSON.stringify({ cmd: "quit" }) + "\n");
    } catch {
      /* already gone */
    }
    this.child?.kill();
    rmSync(this.scratch, { recursive: true, force: true });
  }
}

let host: GlHost | null = null;
let probeSeq = 0;

function getHost(): GlHost {
  if (!host) {
    host = new GlHost();
    const bye = () => host?.close();
    process.once("exit", bye);
    process.once("SIGINT", bye);
  }
  return host;
}

/** Tear the host down. Call from an afterAll when a file wants the process reclaimed early. */
export function closeGlHost(): void {
  host?.close();
  host = null;
}

const bundles = new Map<string, Promise<string>>();

/** esbuild the module under test into an IIFE, once per (entry, globalName) per test file. */
function bundleOnce(entry: string, globalName: string): Promise<string> {
  const key = `${entry}::${globalName}`;
  let b = bundles.get(key);
  if (!b) {
    b = build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: "iife",
      globalName,
      platform: "browser",
      target: "chrome120",
      logLevel: "silent",
    }).then((r) => r.outputFiles[0].text);
    bundles.set(key, b);
  }
  return b;
}

export interface GlProbeOpts<A extends unknown[]> {
  /** Module to bundle and expose on `window[globalName]`. */
  entry: string;
  globalName: string;
  /** Page markup — normally a single <canvas id="c">. */
  html: string;
  /** Evaluated in the page. Must be self-contained: it is serialised via toString(), so it cannot
   *  close over anything in the test file. Pass values through `args` instead. */
  fn: (...args: A) => unknown;
  args?: A;
}

/**
 * Run one probe in a real WebGL2 page and return its (JSON-round-tripped) result.
 *
 * Replaces the `puppeteer.launch` → `newPage` → `setContent` → `addScriptTag` → `evaluate` chain
 * the compositor tests used to repeat inline.
 */
export async function glProbe<A extends unknown[], T = unknown>(opts: GlProbeOpts<A>): Promise<T> {
  const h = getHost();
  const script = await bundleOnce(opts.entry, opts.globalName);
  const htmlPath = h.htmlFile(opts.html, probeSeq++);
  return (await h.send({
    htmlPath,
    script,
    fn: opts.fn.toString(),
    args: opts.args ?? [],
  })) as T;
}
