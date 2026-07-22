import { describe, it, expect } from "vitest";
import { moveFile } from "../src/render/native/engine.js";

describe("moveFile", () => {
  it("falls back to copy + delete when rename fails with EXDEV (tmpfs scratch → out dir)", () => {
    const calls: string[] = [];
    const exdev = Object.assign(new Error("cross-device link"), { code: "EXDEV" });
    moveFile("/a", "/b", {
      renameSync: () => {
        calls.push("rename");
        throw exdev;
      },
      copyFileSync: () => calls.push("copy"),
      rmSync: () => calls.push("rm"),
    } as never);
    expect(calls).toEqual(["rename", "copy", "rm"]);
  });
  it("rethrows non-EXDEV rename errors without copying", () => {
    const eacces = Object.assign(new Error("permission denied"), { code: "EACCES" });
    expect(() =>
      moveFile("/a", "/b", {
        renameSync: () => {
          throw eacces;
        },
        copyFileSync: () => {
          throw new Error("must not copy");
        },
        rmSync: () => {},
      } as never),
    ).toThrow("permission denied");
  });
});
