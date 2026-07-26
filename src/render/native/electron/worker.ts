import { connect } from "node:net";
import { createInterface, type Interface } from "node:readline";
import { OffscreenRenderWindow } from "./offscreenWindow.js";

if (!process.versions.electron) {
  console.error("kino electron worker must run under the electron binary");
  process.exit(1);
}

/** One Chromium GPU process, many offscreen windows — avoids N× Electron GPU contention. */
const wins = new Map<number, OffscreenRenderWindow>();
/** Per-slot serial queues so scap on slot 0∥1 can overlap; boot/quit stay ordered per slot. */
const chains = new Map<number, Promise<void>>();
let globalChain = Promise.resolve();
/** stdout is multiplexed — serialize tagged replies so length-prefixed frames never interleave. */
let outLock = Promise.resolve();

function withStdout(fn: () => void): Promise<void> {
  const run = outLock.then(fn);
  outLock = run.then(
    () => {},
    () => {},
  );
  return run;
}

function writeLine(id: number, payload: string): Promise<void> {
  return withStdout(() => {
    process.stdout.write(`L ${id} ${payload}\n`);
  });
}

function writeFrame(id: number, buf: Buffer | null): Promise<void> {
  return withStdout(() => {
    const len = buf?.length ?? 0;
    process.stdout.write(`F ${id} ${len}\n`);
    if (len && buf) process.stdout.write(buf);
  });
}

function writeErr(msg: string): void {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

function enqueueSlot(slot: number, fn: () => Promise<void>): void {
  const prev = chains.get(slot) ?? Promise.resolve();
  const next = prev.then(fn).catch((e) => writeErr((e as Error).stack ?? String(e)));
  chains.set(slot, next);
}

function enqueueGlobal(fn: () => Promise<void>): void {
  globalChain = globalChain.then(fn).catch((e) => writeErr((e as Error).stack ?? String(e)));
}

async function shutdown(): Promise<void> {
  await Promise.all([...wins.values()].map((w) => w.close()));
  wins.clear();
  chains.clear();
  const { quitElectronApp } = await import("./app.js");
  await quitElectronApp();
  process.exit(0);
}

function bindCommands(rl: Interface): void {
  rl.on("close", () => {
    void shutdown();
  });
  rl.on("line", (line) => {
    handleLine(line);
  });
}

function handleLine(line: string): void {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  switch (cmd) {
    case "boot": {
      // boot <slot> <url> <w> <h> <fps> <id>
      const slot = Number(rest[0]);
      const url = rest[1];
      const w = Number(rest[2]);
      const h = Number(rest[3]);
      const fps = Number(rest[4]) || 30;
      const id = Number(rest[5]);
      enqueueSlot(slot, async () => {
        const existing = wins.get(slot);
        if (existing) {
          await existing.reloadConfig();
          await writeLine(id, `ok ${existing.captureKind()}`);
          return;
        }
        const win = new OffscreenRenderWindow(url, w, h, fps);
        await win.boot();
        wins.set(slot, win);
        await writeLine(id, `ok ${win.captureKind()}`);
      });
      break;
    }
    case "reload": {
      // reload <slot> <id>
      const slot = Number(rest[0]);
      const id = Number(rest[1]);
      enqueueSlot(slot, async () => {
        const win = wins.get(slot);
        if (!win) throw new Error(`reload: no window for slot ${slot}`);
        await win.reloadConfig();
        await writeLine(id, "ok");
      });
      break;
    }
    case "scap": {
      // scap <slot> <frame> <id> — concurrent across slots
      const slot = Number(rest[0]);
      const frame = Number(rest[1]);
      const id = Number(rest[2]);
      enqueueSlot(slot, async () => {
        const win = wins.get(slot);
        if (!win) throw new Error(`scap: no window for slot ${slot}`);
        const buf = await win.seekAndCapture(frame);
        await writeFrame(id, buf);
      });
      break;
    }
    case "flush": {
      // flush <slot> <id>
      const slot = Number(rest[0]);
      const id = Number(rest[1]);
      enqueueSlot(slot, async () => {
        const win = wins.get(slot);
        if (!win) throw new Error(`flush: no window for slot ${slot}`);
        const buf = await win.flush();
        await writeFrame(id, buf);
      });
      break;
    }
    case "profile": {
      // profile <slot> <id>
      const slot = Number(rest[0] ?? 0);
      const id = Number(rest[1]);
      enqueueSlot(slot, async () => {
        const win = wins.get(slot);
        if (!win) throw new Error(`profile: no window for slot ${slot}`);
        const rows = await win.profile();
        await writeLine(id, JSON.stringify(rows));
      });
      break;
    }
    case "quit":
      enqueueGlobal(() => shutdown());
      break;
    default:
      writeErr(`unknown worker cmd: ${cmd}`);
  }
}

const cmdPort = Number(process.env.KINO_ELECTRON_CMD_PORT ?? "");
if (Number.isFinite(cmdPort) && cmdPort > 0) {
  // Windows: Electron EOF's piped stdin immediately — parent speaks TCP instead.
  const sock = connect({ host: "127.0.0.1", port: cmdPort }, () => {
    bindCommands(createInterface({ input: sock, terminal: false }));
  });
  sock.on("error", (e) => writeErr(`cmd socket: ${(e as Error).message}`));
} else {
  if (typeof process.stdin.resume === "function") process.stdin.resume();
  bindCommands(createInterface({ input: process.stdin, terminal: false }));
}
