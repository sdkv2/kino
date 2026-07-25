import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0,
};
// A flat magenta background: unmistakable, and any compositing mistake shows immediately.
const flat = "ctx.fillStyle='#ff00ff';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);";
const bg = {
  kind: "custom" as const, image: null, customCode: flat, shaderCode: null,
  params: {}, keyframes: [], triggers: [],
};

const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: bg, disclosure: "",
  segments: [{ kind: "scene", caption: "", startSec: 0, endSec: 2 }],
};

const meanOf = (png: string, channel: "r" | "g" | "b") =>
  parseFloat(magick([png, "-format", `%[fx:mean.${channel}]`, "info:"]).trim());

describe("compositor stage", () => {
  it("renders the background through the GL stage when KINO_COMPOSITOR=1", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      const outDir = mkdtempSync(join(tmpdir(), "kino-stage-"));
      const [png] = await renderStills({
        props, publicDir: mkdtempSync(join(tmpdir(), "stage-pub-")),
        format: "9:16", frames: [{ frame: 10, name: "stage" }], outDir,
      });
      expect(existsSync(png)).toBe(true);
      // Magenta: red and blue saturated (darkened slightly by scrim in center), green empty.
      expect(meanOf(png, "r")).toBeGreaterThan(0.75);
      expect(meanOf(png, "b")).toBeGreaterThan(0.75);
      expect(meanOf(png, "g")).toBeLessThan(0.05);
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 180000);

  it("renders the same frame twice identically", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      const outDir = mkdtempSync(join(tmpdir(), "kino-stage-det-"));
      const pngs = await renderStills({
        props, publicDir: mkdtempSync(join(tmpdir(), "stage-det-pub-")),
        format: "9:16", frames: [{ frame: 10, name: "a" }, { frame: 10, name: "b" }], outDir,
      });
      const diff = parseFloat(
        magick([pngs[0], pngs[1], "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim(),
      );
      expect(diff).toBe(0);
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 180000);
});
