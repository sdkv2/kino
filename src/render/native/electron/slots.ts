import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { onBeforeSweep } from "../../../scratch.js";
import type { WorkerHandle } from "../workerHandle.js";

const here = dirname(fileURLToPath(import.meta.url));
const workerJs = join(here, "worker.js");

function electronBin(): string {
  const require = createRequire(import.meta.url);
  return (require("electron") as string).trim();
}

type LineWait = { kind: "line"; resolve: (line: string) => void; reject: (e: Error) => void };
type FrameWait = { kind: "frame"; resolve: (buf: Buffer | null) => void; reject: (e: Error) => void };
type Wait = LineWait | FrameWait;

const liveWorkers = new Set<ChildProcessWithoutNullStreams>();
let killHookInstalled = false;

function installKillHook(): void {
  if (killHookInstalled) return;
  killHookInstalled = true;
  onBeforeSweep(() => {
    for (const child of liveWorkers) {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
    }
    liveWorkers.clear();
  });
}

/** One electron subprocess — offscreen paint capture over length-prefixed stdin/stdout. */
class ElectronWorkerProc {
  private child: ChildProcessWithoutNullStreams;
  private queue: Wait[] = [];
  private buf = Buffer.alloc(0);

  constructor() {
    installKillHook();
    this.child = spawn(electronBin(), [workerJs], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, KINO_ELECTRON_WORKER: "1" },
    });
    liveWorkers.add(this.child);
    this.child.once("exit", () => liveWorkers.delete(this.child));
    this.child.stderr.on("data", (chunk: Buffer) => {
      const s = chunk.toString("utf8");
      // Drop Chromium GL spam; keep worker diagnostics.
      if (s.includes("GL_INVALID_OPERATION") || s.includes("gl_utils.cc") || s.includes("Too many GL errors")) return;
      process.stderr.write(chunk);
    });
    this.child.stdout.on("data", (chunk: Buffer) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      this.pump();
    });
    this.child.on("exit", (code) => {
      const err = new Error(`electron worker exited ${code ?? "?"}`);
      for (const w of this.queue) w.reject(err);
      this.queue = [];
    });
  }

  private pump(): void {
    while (this.queue.length) {
      const head = this.queue[0];
      if (head.kind === "line") {
        const nl = this.buf.indexOf(0x0a);
        if (nl < 0) return;
        const line = this.buf.subarray(0, nl).toString("utf8");
        this.buf = this.buf.subarray(nl + 1);
        this.queue.shift();
        head.resolve(line);
        continue;
      }
      if (this.buf.length < 4) return;
      const len = this.buf.readUInt32BE(0);
      if (this.buf.length < 4 + len) return;
      const body = len ? this.buf.subarray(4, 4 + len) : null;
      this.buf = this.buf.subarray(4 + len);
      this.queue.shift();
      head.resolve(body);
    }
  }

  private send(cmd: string): void {
    this.child.stdin.write(`${cmd}\n`);
  }

  private waitLine(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.queue.push({ kind: "line", resolve, reject });
      this.pump();
    });
  }

  private waitFrame(timeoutMs = 10_000): Promise<Buffer | null> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("electron worker frame timeout")), timeoutMs);
      this.queue.push({
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
      this.pump();
    });
  }

  async boot(url: string, width: number, height: number, fps: number): Promise<"shared" | "page"> {
    this.send(`boot ${url} ${width} ${height} ${fps}`);
    const line = await this.waitLine();
    if (line === "ok shared") return "shared";
    if (line === "ok page" || line === "ok") return "page";
    throw new Error(`electron worker boot failed: ${line}`);
  }

  async reload(): Promise<void> {
    this.send("reload");
    const line = await this.waitLine();
    if (line !== "ok") throw new Error(`electron worker reload failed: ${line}`);
  }

  async seekAndCapture(frame: number): Promise<Buffer | null> {
    this.send(`scap ${frame}`);
    const buf = await this.waitFrame();
    return buf;
  }

  async flush(): Promise<Buffer | null> {
    this.send("flush");
    return this.waitFrame();
  }

  async profile(): Promise<Array<{ key: string; ms: number; n: number }>> {
    this.send("profile");
    const line = await this.waitLine();
    return JSON.parse(line) as Array<{ key: string; ms: number; n: number }>;
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(force);
        liveWorkers.delete(this.child);
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
        this.send("quit");
        this.child.stdin.end();
      } catch {
        finish();
      }
    });
  }
}

const workers = new Map<number, ElectronWorkerProc>();

export async function acquireElectronWorker(
  slot: number,
  url: string,
  width: number,
  height: number,
  fps: number,
): Promise<WorkerHandle> {
  let proc = workers.get(slot) ?? null;
  if (!proc) {
    proc = new ElectronWorkerProc();
    await proc.boot(url, width, height, fps);
    workers.set(slot, proc);
  } else {
    await proc.reload();
  }
  const p = proc;
  return {
    seekAndCapture: (frame) => p.seekAndCapture(frame),
    flush: () => p.flush(),
    dumpProfile: (frames, captureMs) => dumpElectronProfile(p, frames, captureMs),
  };
}

export async function releaseElectronWorkers(): Promise<void> {
  await Promise.all([...workers.values()].map((p) => p.close()));
  workers.clear();
}

async function dumpElectronProfile(
  proc: ElectronWorkerProc,
  frames: number,
  captureMs: number,
): Promise<void> {
  const rows = await proc.profile();
  if (!rows.length) return;
  const pageRows = rows.filter((r) => !r.key.startsWith("cap:"));
  const capRows = rows.filter((r) => r.key.startsWith("cap:"));
  const draw = pageRows.find((r) => r.key === "draw")?.ms ?? 0;
  const pageTotal = pageRows
    .filter((r) => r.key === "draw" || r.key.startsWith("prep:"))
    .reduce((a, r) => a + r.ms, 0);
  const capTotal = capRows.reduce((a, r) => a + r.ms, 0);

  console.error(`[native profile] electron offscreen, ${frames} frames`);
  if (pageRows.length) {
    console.error("  page (GL-flushed seek phases):");
    for (const r of pageRows) {
      if (r.ms >= 1) {
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
