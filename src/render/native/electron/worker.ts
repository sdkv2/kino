import { createInterface } from "node:readline";
import { OffscreenRenderWindow } from "./offscreenWindow.js";

if (!process.versions.electron) {
  console.error("kino electron worker must run under the electron binary");
  process.exit(1);
}

let win: OffscreenRenderWindow | null = null;
let chain = Promise.resolve();

function writeFrame(buf: Buffer | null): void {
  const hdr = Buffer.alloc(4);
  hdr.writeUInt32BE(buf?.length ?? 0, 0);
  process.stdout.write(hdr);
  if (buf?.length) process.stdout.write(buf);
}

function writeErr(msg: string): void {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

function enqueue(fn: () => Promise<void>): void {
  chain = chain.then(fn).catch((e) => writeErr((e as Error).stack ?? String(e)));
}

async function shutdown(): Promise<void> {
  await win?.close();
  win = null;
  const { quitElectronApp } = await import("./app.js");
  await quitElectronApp();
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("close", () => {
  void shutdown();
});
rl.on("line", (line) => {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  enqueue(async () => {
    switch (cmd) {
      case "boot": {
        const [url, w, h, fps] = rest;
        win = new OffscreenRenderWindow(url, Number(w), Number(h), Number(fps) || 30);
        await win.boot();
        process.stdout.write(win.usesSharedTexture() ? "ok shared\n" : "ok page\n");
        break;
      }
      case "reload":
        await win!.reloadConfig();
        process.stdout.write("ok\n");
        break;
      case "scap": {
        const buf = await win!.seekAndCapture(Number(rest[0]));
        writeFrame(buf);
        break;
      }
      case "flush": {
        const buf = await win!.flush();
        writeFrame(buf);
        break;
      }
      case "profile": {
        const rows = await win!.profile();
        process.stdout.write(`${JSON.stringify(rows)}\n`);
        break;
      }
      case "quit":
        await shutdown();
        break;
      default:
        writeErr(`unknown worker cmd: ${cmd}`);
    }
  });
});
