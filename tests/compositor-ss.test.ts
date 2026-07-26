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
const diagonal = { kind: "custom" as const, image: null, shaderCode: null,
  customCode: "const w=ctx.canvas.width,h=ctx.canvas.height;ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);ctx.fillStyle='#fff';ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(w,h);ctx.lineTo(w,0);ctx.closePath();ctx.fill();",
  params: {}, keyframes: [], triggers: [] };

const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: diagonal, disclosure: "",
  segments: [{ kind: "scene", caption: "", startSec: 0, endSec: 2 }],
};

const render = async (ss: string, name: string) => {
  process.env.KINO_COMPOSITOR = "1";
  process.env.KINO_SHADER_SSAA = ss;
  process.env.KINO_SHADER_FXAA = "0";
  try {
    const [png] = await renderStills({
      props, publicDir: mkdtempSync(join(tmpdir(), "ss-pub-")),
      format: "9:16", frames: [{ frame: 5, name }],
      outDir: mkdtempSync(join(tmpdir(), "ss-out-")),
    });
    return png;
  } finally {
    delete process.env.KINO_COMPOSITOR;
    delete process.env.KINO_SHADER_SSAA;
    delete process.env.KINO_SHADER_FXAA;
  }
};

const edgePixels = (png: string) =>
  parseFloat(magick([png, "-colorspace", "gray", "-solarize", "50%", "-format", "%[fx:mean]", "info:"]).trim());

describe("supersampling at the composite", () => {
  it("SS=2 antialiases the frame differently than SS=1", async () => {
    const [one, two] = [await render("1", "ss1"), await render("2", "ss2")];
    const diff = parseFloat(
      magick([one, two, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim(),
    );
    expect(diff).toBeGreaterThan(0.0001);
    expect(edgePixels(two)).not.toBe(edgePixels(one));
  }, 300000);

  it("stays deterministic at SS=2", async () => {
    const [a, b] = [await render("2", "a"), await render("2", "b")];
    const diff = parseFloat(
      magick([a, b, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim(),
    );
    expect(diff).toBe(0);
  }, 300000);
});
