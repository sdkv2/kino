// Cache-aware Blender still ensure: cache-hit (existing f*.png count === timeline.meta.frameCount)
// skips the spawn; a cache-miss or partial dir (Blender crashed mid-beat — never trust that as a
// hit) wipes and re-renders. deps are injectable so build-scene.test.ts can stub renderTimeline.
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { resolveBlender as defaultResolveBlender, renderTimeline as defaultRenderTimeline } from "../../media/blender.js";
import type { Timeline } from "./runScene.js";

const STILL_RE = /^f\d+\.png$/;

function stillCount(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => STILL_RE.test(f)).length;
}

const BLENDER_HINT =
  process.platform === "darwin"
    ? "brew install --cask blender (needs Blender ≥ 4.2)"
    : "install Blender ≥ 4.2 (https://www.blender.org/download/) — or set KINO_BLENDER to its binary";

export interface EnsureSceneStillsOpts {
  timeline: Timeline;
  hash: string; // cache key — the hash-named subdir under scene3dDir
  scene3dDir: string; // "_scene3d" root, beside "_public"
  publicDir: string;
  beatLabel: string; // names the beat in the missing-Blender error
  resolveBlender?: () => { bin: string; version: string } | null;
  renderTimeline?: (opts: { timeline: Timeline; outDir: string; publicDir: string; blenderBin: string }) => Promise<void>;
}

/** Ensure hash-named PNG stills exist for a scene timeline. Returns the sceneFrames prop shape. */
export async function ensureSceneStills(opts: EnsureSceneStillsOpts): Promise<{ dir: string; count: number }> {
  const { timeline, hash, scene3dDir, publicDir, beatLabel } = opts;
  const resolveBlender = opts.resolveBlender ?? defaultResolveBlender;
  const renderTimeline = opts.renderTimeline ?? defaultRenderTimeline;
  const dir = join(scene3dDir, hash);
  const count = timeline.meta.frameCount;

  if (stillCount(dir) === count) return { dir: hash, count };

  const blender = resolveBlender();
  if (!blender) {
    throw new Error(`3D scene beat "${beatLabel}" needs Blender to render stills — ${BLENDER_HINT}`);
  }
  rmSync(dir, { recursive: true, force: true }); // partial dir from a prior crash must not poison the cache
  mkdirSync(scene3dDir, { recursive: true });
  await renderTimeline({ timeline, outDir: dir, publicDir, blenderBin: blender.bin });

  const after = stillCount(dir);
  if (after !== count) {
    throw new Error(`3D scene beat "${beatLabel}" rendered ${after}/${count} frames — Blender may have failed partway`);
  }
  return { dir: hash, count };
}
