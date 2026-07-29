import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#000000", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0,
};
const blackBg = { kind: "custom" as const, image: null, shaderCode: null,
  customCode: "ctx.fillStyle='#000000';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);",
  params: {}, keyframes: [], triggers: [] };

// Fullscreen white graphic.
const fullMotion = {
  html: `<style>.h{position:absolute;inset:0;background:#fff}</style><div class="h"></div>`,
  params: {}, keyframes: [], triggers: [],
};

const props = (mask: unknown): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
  background: blackBg, disclosure: "",
  segments: [{ kind: "motion", caption: "", startSec: 0, endSec: 2, motion: fullMotion, mask } as never],
});

describe("layer-as-mask", () => {
  it("clips a layer to a shape mask on s.mask", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      const outDir = mkdtempSync(join(tmpdir(), "kino-lmask-"));
      const [png] = await renderStills({
        props: props({ source: { kind: "shape", shape: { kind: "rect", x: 0, y: 0, w: 540, h: 1920 } } }),
        publicDir: mkdtempSync(join(tmpdir(), "lmask-pub-")),
        format: "9:16", frames: [{ frame: 10, name: "masked" }], outDir,
      });
      // Left half (0..540) masked white, right half (540..1080) black background.
      const left = parseFloat(magick([png, "-crop", "540x1920+0+0", "+repage", "-format", "%[fx:mean]", "info:"]).trim());
      const right = parseFloat(magick([png, "-crop", "540x1920+540+0", "+repage", "-format", "%[fx:mean]", "info:"]).trim());
      console.log("PNG DIMENSIONS:", magick([png, "-format", "%wx%h", "info:"]).trim());
      console.log("TEST OUTPUT - left:", left, "right:", right);
      expect(left).toBeGreaterThan(0.9);
      expect(right).toBeLessThan(0.1);
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 300000);

  it("clips a layer to another layer's coverage", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      const halfMotion = {
        html: `<div style="position:absolute;left:0;top:0;width:50%;height:100%;background:#fff"></div>`,
        params: {}, keyframes: [], triggers: [],
      };
      const layerProps: KinoProps = {
        theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
        background: blackBg, disclosure: "",
        segments: [{
          kind: "motion", caption: "", startSec: 0, endSec: 2,
          motion: halfMotion,
          motionOverlay: fullMotion,
          mask: { source: { kind: "layer", layerId: "motion0", channel: "a" } },
        } as never],
      };
      const outDir = mkdtempSync(join(tmpdir(), "kino-lmask-"));
      const [png] = await renderStills({
        props: layerProps,
        publicDir: mkdtempSync(join(tmpdir(), "lmask-pub-")),
        format: "9:16", frames: [{ frame: 10, name: "masked" }], outDir,
      });
      const left = parseFloat(magick([png, "-crop", "540x1920+0+0", "+repage", "-format", "%[fx:mean]", "info:"]).trim());
      const right = parseFloat(magick([png, "-crop", "540x1920+540+0", "+repage", "-format", "%[fx:mean]", "info:"]).trim());
      console.log("TEST OUTPUT - left:", left, "right:", right);
      expect(left).toBeGreaterThan(0.9);
      expect(right).toBeLessThan(0.1);
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 300000);

  it("clips a text layer behind a subject layer using inverted layer mask", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      // Presenter / subject covering left half of screen (0..540)
      const subjectMotion = {
        html: `<div style="position:absolute;left:0;top:0;width:50%;height:100%;background:#fff"></div>`,
        params: {}, keyframes: [], triggers: [],
      };
      // Fullscreen text overlay, masked by inverted subject layer (so text only shows where subject is NOT)
      const textBehindProps: KinoProps = {
        theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
        background: blackBg, disclosure: "",
        segments: [{
          kind: "motion", caption: "TITLE BEHIND SUBJECT", startSec: 0, endSec: 2,
          motion: subjectMotion,
          mask: { source: { kind: "layer", layerId: "motion0", channel: "a" }, invert: true },
        } as never],
      };
      const outDir = mkdtempSync(join(tmpdir(), "kino-lmask-text-"));
      const [png] = await renderStills({
        props: textBehindProps,
        publicDir: mkdtempSync(join(tmpdir(), "lmask-pub-text-")),
        format: "9:16", frames: [{ frame: 10, name: "text_behind" }], outDir,
      });
      const left = parseFloat(magick([png, "-crop", "540x1920+0+0", "+repage", "-format", "%[fx:mean]", "info:"]).trim());
      const right = parseFloat(magick([png, "-crop", "540x1920+540+0", "+repage", "-format", "%[fx:mean]", "info:"]).trim());
      console.log("TEXT BEHIND TEST OUTPUT - left:", left, "right:", right);
      // Left side is subject (white, unmasked). Right side has title text on black bg (> 0).
      expect(left).toBeGreaterThan(0.9);
      expect(right).toBeGreaterThan(0.01);
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 300000);

  it("correctly samples right-half layer mask at supersample SS=2", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      // Right-half white graphic (540..1080)
      const rightHalfMotion = {
        html: `<div style="position:absolute;left:50%;top:0;width:50%;height:100%;background:#fff"></div>`,
        params: {}, keyframes: [], triggers: [],
      };
      const layerProps: KinoProps = {
        theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
        background: blackBg, disclosure: "",
        segments: [{
          kind: "motion", caption: "", startSec: 0, endSec: 2,
          motion: rightHalfMotion,
          motionOverlay: fullMotion,
          mask: { source: { kind: "layer", layerId: "motion0", channel: "a" } },
        } as never],
      };
      const outDir = mkdtempSync(join(tmpdir(), "kino-lmask-ss-"));
      const [png] = await renderStills({
        props: layerProps,
        publicDir: mkdtempSync(join(tmpdir(), "lmask-pub-ss-")),
        format: "9:16", frames: [{ frame: 10, name: "right_mask" }], outDir,
      });
      const left = parseFloat(magick([png, "-crop", "540x1920+0+0", "+repage", "-format", "%[fx:mean]", "info:"]).trim());
      const right = parseFloat(magick([png, "-crop", "540x1920+540+0", "+repage", "-format", "%[fx:mean]", "info:"]).trim());
      console.log("RIGHT MASK TEST OUTPUT - left:", left, "right:", right);
      expect(left).toBeLessThan(0.1);
      expect(right).toBeGreaterThan(0.9);
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 300000);
});
