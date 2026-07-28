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
// Flat grey background: anything the glass refracts must come from the layer ABOVE it.
const grey = { kind: "custom" as const, image: null, shaderCode: null,
  customCode: "ctx.fillStyle='#808080';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);",
  params: {}, keyframes: [], triggers: [] };

// Stripes drawn by a motion layer BELOW the glass card — invisible to the old
// registerBackdrop path, which only ever saw the background canvas.
const stripes = {
  html: `<style>.s{position:absolute;inset:0;background:repeating-linear-gradient(90deg,#000 0 32px,#fff 32px 64px)}</style><div class="s"></div>`,
  params: {}, keyframes: [], triggers: [],
};
const card = {
  html: `<style>.c{position:absolute;left:14%;right:14%;top:36%;bottom:36%;border-radius:48px;background:transparent;--glass-strength:48px;--glass-band:120px}</style><div class="c kino-lens"></div>`,
  params: {}, keyframes: [], triggers: [],
};

const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: grey, disclosure: "",
  segments: [
    { kind: "motion", caption: "", startSec: 0, endSec: 2, motion: stripes, motionOverlay: card },
  ],
};

const meanDiff = (a: string, b: string) =>
  parseFloat(magick([a, b, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim());

describe("glass on the true composite", () => {
  it("refracts a layer above the background, which the DOM path cannot", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      const outDir = mkdtempSync(join(tmpdir(), "kino-lenscomp-"));
      const pngs = await renderStills({
        props, publicDir: mkdtempSync(join(tmpdir(), "glasscomp-pub-")),
        format: "9:16", frames: [{ frame: 20, name: "a" }, { frame: 20, name: "b" }], outDir,
      });
      // Deterministic first — a flaky GL path would make the next assertion meaningless.
      expect(meanDiff(pngs[0], pngs[1])).toBe(0);

      // The card region must not be a flat grey plate: it has to carry displaced stripe edges.
      const stddev = parseFloat(
        magick([pngs[0], "-crop", "760x760+160+580", "+repage", "-format", "%[fx:standard_deviation]", "info:"]).trim(),
      );
      expect(stddev).toBeGreaterThan(0.05);
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 300000);

  it("multi-panel GPU: two kino-lens cards both refract the under-layer", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      const dual = {
        html:
          `<style>
            .a,.b{position:absolute;left:10%;right:10%;height:22%;border-radius:36px;background:transparent;
              --glass-strength:48px;--glass-band:100px}
            .a{top:18%}.b{top:58%}
          </style>
          <div class="a kino-lens"></div><div class="b kino-lens"></div>`,
        params: {}, keyframes: [], triggers: [],
      };
      const dualProps: KinoProps = {
        ...props,
        segments: [{ kind: "motion", caption: "", startSec: 0, endSec: 2, motion: stripes, motionOverlay: dual }],
      };
      const outDir = mkdtempSync(join(tmpdir(), "kino-lensdual-"));
      const pngs = await renderStills({
        props: dualProps, publicDir: mkdtempSync(join(tmpdir(), "glassdual-pub-")),
        format: "9:16", frames: [{ frame: 20, name: "d" }], outDir,
      });
      const topStd = parseFloat(
        magick([pngs[0], "-crop", "760x360+160+320", "+repage", "-format", "%[fx:standard_deviation]", "info:"]).trim(),
      );
      const botStd = parseFloat(
        magick([pngs[0], "-crop", "760x360+160+1100", "+repage", "-format", "%[fx:standard_deviation]", "info:"]).trim(),
      );
      expect(topStd).toBeGreaterThan(0.05);
      expect(botStd).toBeGreaterThan(0.05);
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 300000);

  it("frame 0 has lens composite after kinoLoad boot seek (no poisoned texture cache)", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      const outDir = mkdtempSync(join(tmpdir(), "kino-lensf0-"));
      const pngs = await renderStills({
        props,
        publicDir: mkdtempSync(join(tmpdir(), "glasscomp-f0-pub-")),
        format: "9:16",
        frames: [{ frame: 0, name: "f0" }, { frame: 1, name: "f1" }],
        outDir,
      });
      const std = (p: string) =>
        parseFloat(
          magick([p, "-crop", "760x760+160+580", "+repage", "-format", "%[fx:standard_deviation]", "info:"]).trim(),
        );
      expect(std(pngs[0])).toBeGreaterThan(0.05);
      expect(Math.abs(std(pngs[0]) - std(pngs[1]))).toBeLessThan(0.04);
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 300000);
});
