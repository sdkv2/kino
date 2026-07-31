// Regression test for the windows-latest CI failure where all 166 files and 1431 tests passed and
// the run still exited 1:
//
//   Uncaught Exception: read ECONNRESET
//    ❯ TCP.onStreamRead node:internal/stream_base_commons:216:20
//
// The GL host's command socket had no 'error' listener, so the RST that Windows sends when close()
// kills the child mid-connection became an uncaught exception. It was blamed on a different
// compositor test file each run — the error carries no user frames, so vitest attributes it to
// whichever file was in flight.
//
// The control case is the point of this file: it asserts the UNGUARDED socket still dies, so a
// future edit that drops guardCmdStream fails here loudly instead of going back to a flake that
// only reproduces on a Windows runner a few runs in ten.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "helpers/cmdSocketReset.fixture.ts");

function runFixture(mode: "guard" | "bare"): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", FIXTURE, mode], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let out = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, out }));
  });
}

describe("GL host command socket", () => {
  it("survives a peer reset when guarded", async () => {
    const { code, out } = await runFixture("guard");
    expect(out).toContain("SURVIVED");
    expect(code).toBe(0);
  }, 30_000);

  it("would die on that reset unguarded — the bug this guards", async () => {
    const { code, out } = await runFixture("bare");
    expect(out).toContain("UNCAUGHT ECONNRESET");
    expect(code).toBe(9);
  }, 30_000);
});
