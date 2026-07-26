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
const bg = {
  kind: "custom" as const, image: null, shaderCode: null,
  customCode: "ctx.fillStyle='#000';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);",
  params: {}, keyframes: [], triggers: [],
};
const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: bg, disclosure: "",
  segments: [{
    kind: "motion",
    caption: "TOP",
    startSec: 0,
    endSec: 2,
    motion: {
      html: `<style>.bar{position:absolute;left:0;right:0;top:0;height:120px;background:#ff0000}</style><div class="bar"></div>`,
      params: {}, keyframes: [], triggers: [],
    },
  }],
};

const meanR = (png: string, crop: string) =>
  parseFloat(magick([png, "-crop", crop, "+repage", "-format", "%[fx:mean.r]", "info:"]).trim());

describe("compositor orientation", () => {
  it("keeps caption and raster layers upright on canvas capture", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-orient-"));
    const [png] = await renderStills({
      props,
      publicDir: mkdtempSync(join(tmpdir(), "orient-pub-")),
      format: "9:16",
      frames: [{ frame: 10, name: "o" }],
      outDir,
    });
    const top = meanR(png, "1080x240+0+0");
    const bottom = meanR(png, "1080x240+0+1680");
    expect(top).toBeGreaterThan(0.2);
    expect(bottom).toBeLessThan(0.05);
  }, 180000);
});
