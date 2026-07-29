import { describe, it, expect, afterAll } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

// Two independent markers, at different heights, so a vertical mirror cannot be mistaken for a
// correct render: the backdrop paints a RED band across the top eighth, and the motion raster a
// GREEN band a quarter of the way down. A flip sends each to a different (and wrong) band.
const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0,
};
const bg = {
  kind: "custom" as const, image: null, shaderCode: null,
  customCode:
    "const c=ctx.canvas;ctx.fillStyle='#000';ctx.fillRect(0,0,c.width,c.height);" +
    "ctx.fillStyle='#ff0000';ctx.fillRect(0,0,c.width,c.height*0.125);",
  params: {}, keyframes: [], triggers: [],
};

const motionHtml = (extraStyle = "") =>
  `<style>.bar{position:absolute;left:0;right:0;top:480px;height:240px;background:#00ff00;${extraStyle}}</style><div class="bar"></div>`;

/** A caption alongside the motion makes the beat group multi-layer, which routes the group
 *  through the offscreen-target blit — the path that used to mirror it. */
const propsFor = (opts: { effect?: boolean } = {}): KinoProps =>
  ({
    theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
    background: bg, disclosure: "",
    segments: [{
      kind: "motion",
      caption: "CAP",
      startSec: 0,
      endSec: 2,
      motion: { html: motionHtml(), params: {}, keyframes: [], triggers: [] },
      ...(opts.effect ? { effects: [{ kind: "glow", params: { radius: 4, intensity: 0.6 } }] } : {}),
    }],
  }) as KinoProps;

const band = (png: string, y: number, channel: "r" | "g") =>
  parseFloat(
    magick([png, "-crop", `1080x240+0+${y}`, "+repage", "-format", `%[fx:mean.${channel}]`, "info:"]).trim(),
  );

const render = async (props: KinoProps, ss: string) => {
  process.env.KINO_SHADER_SSAA = ss;
  const [png] = await renderStills({
    props,
    publicDir: mkdtempSync(join(tmpdir(), "orient-pub-")),
    format: "9:16",
    frames: [{ frame: 10, name: "o" }],
    outDir: mkdtempSync(join(tmpdir(), "kino-orient-")),
  });
  return png!;
};

const prevSS = process.env.KINO_SHADER_SSAA;
afterAll(() => {
  if (prevSS === undefined) delete process.env.KINO_SHADER_SSAA;
  else process.env.KINO_SHADER_SSAA = prevSS;
});

describe("compositor orientation", () => {
  for (const ss of ["1", "2"]) {
    it(`keeps backdrop and motion rasters upright at SS=${ss}`, async () => {
      const png = await render(propsFor(), ss);
      // Backdrop red band is authored across rows 0–240.
      expect(band(png, 0, "r")).toBeGreaterThan(0.8);
      expect(band(png, 1680, "r")).toBeLessThan(0.05);
      // Motion green band is authored across rows 480–720; its mirror would be rows 1200–1440.
      expect(band(png, 480, "g")).toBeGreaterThan(0.8);
      expect(band(png, 1200, "g")).toBeLessThan(0.05);
    }, 180000);

    it(`keeps effect-filtered motion layers upright at SS=${ss}`, async () => {
      const png = await render(propsFor({ effect: true }), ss);
      expect(band(png, 480, "g")).toBeGreaterThan(0.8);
      expect(band(png, 1200, "g")).toBeLessThan(0.05);
    }, 180000);
  }
});
