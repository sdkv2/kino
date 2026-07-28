import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { onBeforeSweep } from "../../../scratch.js";
import { electronBinaryPath } from "../renderer.js";
import { hasDisplay } from "../sandbox.js";
import type { WorkerHandle } from "../workerHandle.js";
import { electronSpawnArgs } from "./app.js";
import type { CaptureKind, ElectronCaptureMode } from "./gpuCapture.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Electron needs a real .js entry. tsc emits beside this file in dist/; tsx from src/ falls back. */
function resolveWorkerJs(): string {
  const local = join(here, "worker.js");
  if (existsSync(local)) return local;
  const fromDist = join(here, "../../../../dist/render/native/electron/worker.js");
  if (existsSync(fromDist)) return fromDist;
  throw new Error(`electron worker.js missing (tried ${local} and ${fromDist}; run npm run build)`);
}

const workerJs = resolveWorkerJs();

type Wait =
  | { kind: "line"; resolve: (line: string) => void; reject: (e: Error) => void }
  | { kind: "frame"; resolve: (buf: Buffer | null) => void; reject: (e: Error) => void };

/**
 * One Electron subprocess hosting N offscreen windows (slots). Sharing a single Chromium GPU
 * process cuts the multi-worker contention that made c≥3 regress when each slot spawned its own
 * Electron.
 *
 * Protocol (tagged — responses may reorder vs send order when slots overlap):
 *   → boot|reload|scap|flush|profile … <id>
 *   ← L <id> <payload>\n
 *   ← F <id> <byteLength>\n + bytes
 */
class ElectronHostProc {
  private child!: ChildProcessWithoutNullStreams;
  private pending = new Map<number, Wait>();
  private nextId = 1;
  private buf = Buffer.alloc(0);
  private alive = true;
  /** After `F id len\n`, await `len` binary bytes for this id. */
  private readingFrame: { id: number; len: number } | null = null;
  /** Commands go here — stdin on posix; TCP on win32 (Electron closes piped stdin immediately). */
  private cmd: NodeJS.WritableStream | null = null;
  private readonly ready: Promise<void>;

  /** @param captureMode forced KINO_ELECTRON_CAPTURE for this host, or undefined to let the worker
   *  resolve from the ambient env. The stills path pins "page": every other kind emits annex-B
   *  H.264, which is not an image. */
  constructor(private readonly captureMode?: ElectronCaptureMode) {
    if (process.platform === "win32") {
      this.ready = new Promise((resolve, reject) => {
        const server = createServer((sock: Socket) => {
          this.cmd = sock;
          server.close();
          resolve();
        });
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address();
          if (!addr || typeof addr === "string") {
            reject(new Error("electron cmd server failed to bind"));
            return;
          }
          this.spawnChild({ KINO_ELECTRON_CMD_PORT: String(addr.port) });
        });
        setTimeout(() => reject(new Error("electron cmd socket connect timeout")), 15_000).unref?.();
      });
    } else {
      this.spawnChild();
      this.cmd = this.child.stdin;
      this.ready = Promise.resolve();
    }
  }

  private spawnChild(extraEnv: Record<string, string> = {}): void {
    // Fail fast and actionably: without a display, hardware GL is unavailable and this otherwise
    // shows up as an unexplained 60s awaitBoot timeout (--ozone-platform=headless starts Electron
    // but yields no WebGL2 on any ANGLE backend — measured on an RTX 3060 Ti, see sandbox.ts).
    if (!hasDisplay()) {
      throw new Error(
        "electron renderer needs an X display on Linux — hardware GL is unavailable headless " +
          "(--ozone-platform=headless yields no WebGL2). Run under a virtual display, e.g.\n" +
          "  xvfb-run -a --server-args='-screen 0 1280x1024x24' kino build <spec>",
      );
    }
    this.child = spawn(electronBinaryPath(), [...electronSpawnArgs(), workerJs], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        KINO_ELECTRON_WORKER: "1",
        ...(this.captureMode ? { KINO_ELECTRON_CAPTURE: this.captureMode } : {}),
        ...extraEnv,
      },
      windowsHide: true,
    });
    liveHosts.add(this.child);
    this.child.once("exit", (code, signal) => {
      this.alive = false;
      liveHosts.delete(this.child);
      const err = new Error(`electron host exited code=${code} signal=${signal ?? ""}`);
      for (const w of this.pending.values()) w.reject(err);
      this.pending.clear();
    });
    this.child.stderr.on("data", (chunk: Buffer) => {
      const s = chunk.toString("utf8");
      if (s.includes("GL_INVALID_OPERATION") || s.includes("gl_utils.cc") || s.includes("Too many GL errors")) return;
      process.stderr.write(chunk);
    });
    this.child.stdout.on("data", (chunk: Buffer) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      this.pump();
    });
  }

  private pump(): void {
    for (;;) {
      if (this.readingFrame) {
        const { id, len } = this.readingFrame;
        if (this.buf.length < len) return;
        const body = len ? this.buf.subarray(0, len) : null;
        this.buf = this.buf.subarray(len);
        this.readingFrame = null;
        const w = this.pending.get(id);
        this.pending.delete(id);
        if (w?.kind === "frame") w.resolve(body && body.length ? Buffer.from(body) : null);
        continue;
      }

      const nl = this.buf.indexOf(0x0a);
      if (nl < 0) return;
      // Windows Electron may emit CRLF; drop CR so the line protocol still matches.
      let end = nl;
      if (end > 0 && this.buf[end - 1] === 0x0d) end -= 1;
      const line = this.buf.subarray(0, end).toString("utf8");
      this.buf = this.buf.subarray(nl + 1);
      if (!line) continue;
      const m = /^(L|F|E) (\d+) (.*)$/.exec(line);
      if (!m) throw new Error(`electron host bad reply: ${JSON.stringify(line)}`);
      const kind = m[1];
      const id = Number(m[2]);
      const rest = m[3];
      // Per-request failure. The worker used to exit(1) on any of these, so a legitimate page
      // fault — a shader that will not compile, say — reached the caller as "electron host exited
      // code=1" with the actual message lost to stderr. Reject just this request instead; the host
      // stays up and the next command still works.
      if (kind === "E") {
        const w = this.pending.get(id);
        this.pending.delete(id);
        w?.reject(new Error(rest.replace(/\\n/g, "\n")));
        continue;
      }
      if (kind === "L") {
        const w = this.pending.get(id);
        this.pending.delete(id);
        if (w?.kind === "line") w.resolve(rest);
        continue;
      }
      const len = Number(rest);
      if (!Number.isFinite(len) || len < 0) throw new Error(`electron host bad frame len: ${line}`);
      this.readingFrame = { id, len };
    }
  }

  private async send(cmd: string): Promise<void> {
    await this.ready;
    if (!this.alive) throw new Error("electron host dead");
    if (!this.cmd) throw new Error("electron host cmd channel missing");
    this.cmd.write(`${cmd}\n`);
  }

  private allocId(wait: Wait): number {
    const id = this.nextId++;
    this.pending.set(id, wait);
    return id;
  }

  private async requestLine(cmdWithoutId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const id = this.allocId({ kind: "line", resolve, reject });
      void this.send(`${cmdWithoutId} ${id}`)
        .then(() => this.pump())
        .catch(reject);
    });
  }

  private async requestFrame(cmdWithoutId: string, timeoutMs = 10_000): Promise<Buffer | null> {
    return new Promise((resolve, reject) => {
      let id = 0;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("electron worker frame timeout"));
      }, timeoutMs);
      id = this.allocId({
        kind: "frame",
        resolve: (buf) => {
          clearTimeout(timer);
          resolve(buf);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      void this.send(`${cmdWithoutId} ${id}`)
        .then(() => this.pump())
        .catch(reject);
    });
  }

  boot(
    slot: number,
    url: string,
    width: number,
    height: number,
    fps: number,
  ): Promise<CaptureKind> {
    return this.requestLine(`boot ${slot} ${url} ${width} ${height} ${fps}`).then((line) => {
      if (line === "ok shared") return "shared";
      if (line === "ok readback") return "readback";
      if (line === "ok direct") return "direct";
      if (line === "ok page" || line === "ok") return "page";
      throw new Error(`electron worker boot failed: ${line}`);
    });
  }

  reload(slot: number): Promise<void> {
    return this.requestLine(`reload ${slot}`).then((line) => {
      if (line !== "ok") throw new Error(`electron worker reload failed: ${line}`);
    });
  }

  seekAndCapture(slot: number, frame: number): Promise<Buffer | null> {
    return this.requestFrame(`scap ${slot} ${frame}`);
  }

  flush(slot: number): Promise<Buffer | null> {
    return this.requestFrame(`flush ${slot}`);
  }

  profile(slot: number): Promise<Array<{ key: string; ms: number; n: number }>> {
    return this.requestLine(`profile ${slot}`).then(
      (line) => JSON.parse(line) as Array<{ key: string; ms: number; n: number }>,
    );
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(force);
        liveHosts.delete(this.child);
        resolve();
      };
      const force = setTimeout(() => {
        try {
          this.child.kill("SIGKILL");
        } catch {
          // already gone
        }
        finish();
      }, 1000);
      this.child.once("exit", finish);
      try {
        void this.send("quit").then(() => {
          try {
            this.cmd?.end();
            this.child.stdin.end();
          } catch {
            // ignore
          }
        });
      } catch {
        finish();
      }
    });
  }
}

const liveHosts = new Set<ChildProcessWithoutNullStreams>();
let killHookInstalled = false;
let host: ElectronHostProc | null = null;
/** Booted slots → the capture backend that slot reported, so a reload keeps answering with it. */
const slotted = new Map<number, CaptureKind>();

function installKillHook(): void {
  if (killHookInstalled) return;
  killHookInstalled = true;
  onBeforeSweep(() => {
    for (const child of liveHosts) {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
    }
    liveHosts.clear();
    host = null;
    slotted.clear();
  });
}

/** Capture mode the live host was spawned with, so a caller wanting a different one gets a fresh
 *  host rather than a worker that emits the wrong byte format. */
let hostMode: ElectronCaptureMode | undefined;

function getHost(captureMode?: ElectronCaptureMode): ElectronHostProc {
  installKillHook();
  if (!host) {
    host = new ElectronHostProc(captureMode);
    hostMode = captureMode;
  }
  return host;
}

/** The capture backend the worker actually resolved. The parent cannot compute it: only the worker
 *  may dlopen the native addon (Electron ABI), so a mode it resolved from `auto` can still degrade
 *  there. Feeds the render's capture log line and the frame-cache key, both of which would
 *  otherwise describe a backend that did not paint these frames. */
export interface ElectronWorkerHandle extends WorkerHandle {
  captureKind: CaptureKind;
}

export async function acquireElectronWorker(
  slot: number,
  url: string,
  width: number,
  height: number,
  fps: number,
  opts: { captureMode?: ElectronCaptureMode } = {},
): Promise<ElectronWorkerHandle> {
  // Renders are serialized by withRenderLock, so a mode change only ever crosses a stills/video
  // boundary. Drop the live host rather than hand back a worker whose capture contract differs
  // from what the caller asked for.
  if (host && hostMode !== opts.captureMode) await releaseElectronWorkers();
  const h = getHost(opts.captureMode);
  let kind = slotted.get(slot);
  if (kind) {
    await h.reload(slot);
  } else {
    kind = await h.boot(slot, url, width, height, fps);
    slotted.set(slot, kind);
  }
  return {
    captureKind: kind,
    seekAndCapture: (frame) => h.seekAndCapture(slot, frame),
    flush: () => h.flush(slot),
    dumpProfile: (frames, captureMs) => dumpElectronProfile(h, slot, frames, captureMs),
  };
}

export async function releaseElectronWorkers(): Promise<void> {
  if (host) {
    await host.close();
    host = null;
  }
  hostMode = undefined;
  slotted.clear();
}

async function dumpElectronProfile(
  proc: ElectronHostProc,
  slot: number,
  frames: number,
  captureMs: number,
): Promise<void> {
  const rows = await proc.profile(slot);
  if (!rows.length) return;
  const pageRows = rows.filter((r) => !r.key.startsWith("cap:"));
  const capRows = rows.filter((r) => r.key.startsWith("cap:"));
  const draw = pageRows.find((r) => r.key === "draw")?.ms ?? 0;
  const pageTotal = pageRows
    .filter((r) => r.key === "draw" || r.key.startsWith("prep:"))
    .reduce((a, r) => a + r.ms, 0);
  const capTotal = capRows.reduce((a, r) => a + r.ms, 0);

  console.error(`[native profile] electron offscreen (shared host), ${frames} frames`);
  if (pageRows.length) {
    console.error("  page (GL-flushed seek phases):");
    for (const r of pageRows) {
      // prefetch-wait prints even at ~0 — a missing row here has been misread as "unmeasured"
      // when it actually meant "never waited".
      if (r.ms >= 1 || r.key === "prefetch-wait") {
        const share = pageTotal > 0 ? ((r.ms / pageTotal) * 100).toFixed(1).padStart(5) : "    -";
        console.error(
          `    ${r.key.padEnd(22)} ${(r.ms / Math.max(1, r.n)).toFixed(2).padStart(7)} ms/call  ×${String(r.n).padStart(4)}  ${share}%`,
        );
      }
    }
    console.error(`    draw total ${draw.toFixed(0)}ms of ${pageTotal.toFixed(0)}ms prep+draw`);
  }
  if (capRows.length) {
    console.error("  capture (worker main process):");
    for (const r of capRows) {
      const avg = r.n > 0 ? (r.ms / r.n).toFixed(2) : "0.00";
      const share = capTotal > 0 ? ((r.ms / capTotal) * 100).toFixed(1).padStart(5) : "    -";
      console.error(`    ${r.key.slice(4).padEnd(22)} ${avg.padStart(7)} ms/call  ×${String(r.n).padStart(4)}  ${share}%`);
    }
  }
  console.error(
    `  ${"[node] capture wall".padEnd(24)} ${(captureMs / Math.max(1, frames)).toFixed(2).padStart(7)} ms/frame (seek+paint+VT+IPC)`,
  );
}
