import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0,
};
const grey = { kind: "custom" as const, image: null, shaderCode: null,
  customCode: "ctx.fillStyle='#808080';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);",
  params: {}, keyframes: [], triggers: [] };

const mk = (postFx?: unknown): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
  background: grey, disclosure: "",
  segments: [{ kind: "scene", caption: "", startSec: 0, endSec: 2 }],
  ...(postFx ? { postFx: postFx as KinoProps["postFx"] } : {}),
});

const render = async (props: KinoProps, name: string) => {
  const [png] = await renderStills({
    props, publicDir: mkdtempSync(join(tmpdir(), "postfx-pub-")),
    format: "9:16", frames: [{ frame: 10, name }],
    outDir: mkdtempSync(join(tmpdir(), "postfx-out-")),
  });
  return png;
};
const meanOf = (png: string) => parseFloat(magick([png, "-format", "%[fx:mean]", "info:"]).trim());

describe("postFx end to end", () => {
  it("a grade actually changes the frame", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      const plain = await render(mk(), "plain");
      const graded = await render(mk({ grade: { brightness: 0.5 } }), "graded");
      expect(meanOf(graded)).toBeLessThan(meanOf(plain) - 0.05);
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 300000);

  it("postFx renders deterministically", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      const props = mk({ grade: { saturation: 0.2 }, film: { intensity: 1 } });
      const a = await render(props, "a");
      const b = await render(props, "b");
      const diff = parseFloat(
        magick([a, b, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim(),
      );
      expect(diff).toBe(0);
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 300000);
});
