import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9 };
const bg = { kind: "solid" as const, image: null, customCode: null, params: {}, keyframes: [], triggers: [] };

const center = (png: string) => magick([png, "-format", "%[pixel:p{540,960}]", "info:"]).trim();
const rgb = (s: string) => {
  const m = s.match(/srgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) throw new Error(`Unexpected pixel format: ${s}`);
  return { r: +m[1], g: +m[2], b: +m[3] };
};
const expectMint = (px: string) => {
  const { r, g, b } = rgb(px);
  expect(g).toBeGreaterThan(180);
  expect(g).toBeGreaterThan(r);
  expect(g).toBeGreaterThan(b);
  expect(r).toBeGreaterThan(100);
};

describe("3d scene stills compositing (SceneFrames)", () => {
  it("composites pre-rendered mint stills over the backdrop", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-3d-"));
    const scene3dDir = join(outDir, "_scene3d");
    const hash = "testhash";
    const dir = join(scene3dDir, hash);
    mkdirSync(dir, { recursive: true });
    // Solid mint PNGs — no Blender needed; proves the SceneFrames <img> path composites.
    for (let i = 1; i <= 3; i++) {
      magick(["-size", "1080x1920", "xc:#80e2b4", join(dir, `f${String(i).padStart(5, "0")}.png`)]);
    }
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg,
      disclosure: "test",
      segments: [
        {
          kind: "motion", caption: "", startSec: 0, endSec: 0.1,
          motion: {
            html: "",
            sceneFrames: { dir: hash, count: 3 },
            params: {}, keyframes: [], triggers: [],
          },
        },
      ],
    };
    const outs = await renderStills({
      props, publicDir: outDir, scene3dDir, format: "9:16",
      frames: [{ frame: 0, name: "s" }], outDir,
    });
    expect(outs).toHaveLength(1);
    expectMint(center(outs[0]));
  }, 120000);
});
