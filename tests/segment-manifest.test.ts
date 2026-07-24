import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeManifest, readManifest, type MaskManifest } from "../src/segment/manifest.js";

describe("mask manifest", () => {
  it("round-trips through disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-mask-"));
    const m: MaskManifest = {
      kind: "video", source: "clip.mp4", prompt: "the person",
      width: 1080, height: 1920, fps: 30, frames: 90,
      objects: [{ id: 0, label: "the person", channel: "r" }],
      backend: "mock", tracked: true,
    };
    writeManifest(dir, m);
    expect(readManifest(dir)).toEqual(m);
  });
  it("throws on missing manifest", () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-mask-"));
    expect(() => readManifest(dir)).toThrow();
  });
});
