// Child process for tests/glhost-cmd-socket.test.ts. Reproduces the shutdown race that failed CI:
// the parent accepts the host's command socket and is reading from it, the peer dies abruptly, and
// the socket is reset. Run with `guard` to route the socket through the real guardCmdStream.
//
// Must be a separate process because the defect IS an uncaught exception — the only honest
// assertion is on the exit code of a process that took it.
import { createServer, type Socket } from "node:net";
import { spawn } from "node:child_process";
import { guardCmdStream } from "./glHost.js";

const guarded = process.argv[2] === "guard";

// resetAndDestroy() puts an RST on the wire, which is what Windows does when kill()
// (TerminateProcess) tears down a child holding an open socket. Portable stand-in for the platform
// behaviour, so this test is not itself Windows-only.
const peer = `
  const { connect } = require("node:net");
  const s = connect(Number(process.env.PORT), "127.0.0.1", () => {});
  s.on("error", () => {});
  setTimeout(() => s.resetAndDestroy(), 100);
`;

const server = createServer((sock: Socket) => {
  if (guarded) guardCmdStream(sock);
  sock.write(JSON.stringify({ cmd: "quit" }) + "\n");
  server.close();
});

server.listen(0, "127.0.0.1", () => {
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("fixture failed to bind");
  spawn(process.execPath, ["-e", peer], {
    env: { ...process.env, PORT: String(addr.port) },
    stdio: "ignore",
  }).unref();
});

process.on("uncaughtException", (e: NodeJS.ErrnoException) => {
  process.stdout.write(`UNCAUGHT ${e.code}\n`);
  process.exit(9);
});

setTimeout(() => {
  process.stdout.write("SURVIVED\n");
  process.exit(0);
}, 2000);
