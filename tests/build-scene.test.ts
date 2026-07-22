import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSceneStills } from "../src/render/scene/ensureStills.js";
import type { Timeline } from "../src/render/scene/runScene.js";

function fakeTimeline(frameCount: number): Timeline {
  return {
    meta: {
      width: 108, height: 192, fps: 30, frameCount, quality: "draft",
      kinoVersion: "0", source: "", params: {}, words: [],
    },
    objects: [],
    world: "none",
    post: null,
    fontPath: null,
    frames: Array.from({ length: frameCount }, () => ({
      transforms: {},
      camera: { p: [0, 0, 5], lookAt: [0, 0, 0], fov: 40, zoom: 1 },
    })),
  };
}

describe("ensureSceneStills", () => {
  it("cache-hit skips renderTimeline", async () => {
    const root = mkdtempSync(join(tmpdir(), "kino-ens-"));
    const scene3dDir = join(root, "_scene3d");
    const hash = "hit123";
    const dir = join(scene3dDir, hash);
    mkdirSync(dir, { recursive: true });
    for (let i = 1; i <= 3; i++) writeFileSync(join(dir, `f${String(i).padStart(5, "0")}.png`), "x");
    const renderTimeline = vi.fn(async () => {});
    const out = await ensureSceneStills({
      timeline: fakeTimeline(3),
      hash,
      scene3dDir,
      publicDir: root,
      beatLabel: "t",
      resolveBlender: () => ({ bin: "blender", version: "5.2" }),
      renderTimeline,
    });
    expect(out).toEqual({ dir: hash, count: 3 });
    expect(renderTimeline).not.toHaveBeenCalled();
  });

  it("cache-miss spawns renderTimeline once", async () => {
    const root = mkdtempSync(join(tmpdir(), "kino-ensm-"));
    const scene3dDir = join(root, "_scene3d");
    const hash = "miss99";
    const renderTimeline = vi.fn(async ({ outDir }: { outDir: string }) => {
      mkdirSync(outDir, { recursive: true });
      for (let i = 1; i <= 2; i++) writeFileSync(join(outDir, `f${String(i).padStart(5, "0")}.png`), "y");
    });
    const out = await ensureSceneStills({
      timeline: fakeTimeline(2),
      hash,
      scene3dDir,
      publicDir: root,
      beatLabel: "t",
      resolveBlender: () => ({ bin: "blender", version: "5.2" }),
      renderTimeline,
    });
    expect(out).toEqual({ dir: hash, count: 2 });
    expect(renderTimeline).toHaveBeenCalledOnce();
    expect(existsSync(join(scene3dDir, hash, "f00001.png"))).toBe(true);
  });

  it("partial dir is treated as miss (re-render)", async () => {
    const root = mkdtempSync(join(tmpdir(), "kino-ensp-"));
    const scene3dDir = join(root, "_scene3d");
    const hash = "partial";
    const dir = join(scene3dDir, hash);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "f00001.png"), "old"); // only 1 of 3
    const renderTimeline = vi.fn(async ({ outDir }: { outDir: string }) => {
      mkdirSync(outDir, { recursive: true });
      for (let i = 1; i <= 3; i++) writeFileSync(join(outDir, `f${String(i).padStart(5, "0")}.png`), "new");
    });
    await ensureSceneStills({
      timeline: fakeTimeline(3),
      hash,
      scene3dDir,
      publicDir: root,
      beatLabel: "t",
      resolveBlender: () => ({ bin: "blender", version: "5.2" }),
      renderTimeline,
    });
    expect(renderTimeline).toHaveBeenCalledOnce();
  });

  it("missing Blender throws brew hint naming the beat", async () => {
    const root = mkdtempSync(join(tmpdir(), "kino-ensb-"));
    await expect(
      ensureSceneStills({
        timeline: fakeTimeline(1),
        hash: "x",
        scene3dDir: join(root, "_scene3d"),
        publicDir: root,
        beatLabel: "phone-orbit",
        resolveBlender: () => null,
        renderTimeline: async () => {},
      }),
    ).rejects.toThrow(/phone-orbit.*[Bb]lender/);
  });
});
