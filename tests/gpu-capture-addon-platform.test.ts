import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addonPlatform } from "../src/render/native/electron/gpuCapture.js";

// The committed gpu_capture.node is built for whatever machine last ran `build:native`, so every
// OTHER platform gets an addon that cannot load. Until 2026-08-03 that failed silently: the loader
// swallowed the error, reconcileCapture degraded `auto` to `direct`, and the render just ran at a
// fraction of the speed with nothing said. This detector is what turns that into an actionable
// message, so it needs to identify the foreign build rather than shrug.
describe("addonPlatform — identifies which OS a .node was built for", () => {
  let dir: string;
  const write = (name: string, bytes: number[]): string => {
    const p = join(dir, name);
    writeFileSync(p, Buffer.from(bytes));
    return p;
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "kino-addon-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects a Linux ELF build", () => {
    expect(addonPlatform(write("elf.node", [0x7f, 0x45, 0x4c, 0x46]))).toBe("linux");
  });

  it("detects a macOS Mach-O build, both endiannesses", () => {
    // 0xcffaedfe is what a real arm64 .node reads as — the exact bytes of the committed artifact.
    expect(addonPlatform(write("macho-le.node", [0xcf, 0xfa, 0xed, 0xfe]))).toBe("darwin");
    expect(addonPlatform(write("macho-be.node", [0xfe, 0xed, 0xfa, 0xcf]))).toBe("darwin");
  });

  it("detects a macOS universal binary", () => {
    expect(addonPlatform(write("fat.node", [0xca, 0xfe, 0xba, 0xbe]))).toBe("darwin");
  });

  it("detects a Windows PE build", () => {
    expect(addonPlatform(write("pe.node", [0x4d, 0x5a, 0x90, 0x00]))).toBe("win32");
  });

  it("returns null for an unrecognised file rather than guessing", () => {
    expect(addonPlatform(write("junk.node", [0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });

  it("returns null for a missing file instead of throwing — this runs inside a catch", () => {
    expect(addonPlatform(join(dir, "does-not-exist.node"))).toBeNull();
  });

  it("returns null for a truncated file instead of throwing", () => {
    expect(addonPlatform(write("short.node", [0x7f]))).toBeNull();
  });
});
