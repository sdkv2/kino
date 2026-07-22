import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSceneStills } from "../src/render/scene/ensureStills.js";
import type { Timeline } from "../src/render/scene/runScene.js";

const tl = (frames: number): Timeline =>
  ({ meta: { frameCount: frames } } as unknown as Timeline);

describe("ensureSceneStills prepareAssets", () => {
  it("runs prepareAssets on cache miss, before renderTimeline", async () => {
    const root = mkdtempSync(join(tmpdir(), "kino-ens-"));
    const calls: string[] = [];
    await ensureSceneStills({
      timeline: tl(1), hash: "h1", scene3dDir: root, publicDir: root, beatLabel: "b",
      resolveBlender: () => ({ bin: "blender", version: "4.2" }),
      prepareAssets: async () => { calls.push("prepare"); },
      renderTimeline: async ({ outDir }) => {
        calls.push("render");
        mkdirSync(outDir, { recursive: true });
        writeFileSync(join(outDir, "f00001.png"), "");
      },
    });
    expect(calls).toEqual(["prepare", "render"]);
  });

  it("skips prepareAssets on cache hit", async () => {
    const root = mkdtempSync(join(tmpdir(), "kino-ens-"));
    const dir = join(root, "h2");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "f00001.png"), "");
    const calls: string[] = [];
    await ensureSceneStills({
      timeline: tl(1), hash: "h2", scene3dDir: root, publicDir: root, beatLabel: "b",
      resolveBlender: () => ({ bin: "blender", version: "4.2" }),
      prepareAssets: async () => { calls.push("prepare"); },
      renderTimeline: async () => { calls.push("render"); },
    });
    expect(calls).toEqual([]);
  });
});
