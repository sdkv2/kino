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
const magenta = { kind: "custom" as const, image: null, shaderCode: null,
  customCode: "ctx.fillStyle='#ff00ff';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);",
  params: {}, keyframes: [], triggers: [] };
const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: magenta, disclosure: "",
  segments: [{ kind: "scene", caption: "", startSec: 0, endSec: 2 }],
};

const render = async (capture: string, name: string) => {
  process.env.KINO_COMPOSITOR = "1";
  process.env.KINO_CAPTURE = capture;
  try {
    const [png] = await renderStills({
      props, publicDir: mkdtempSync(join(tmpdir(), "cap-pub-")),
      format: "9:16", frames: [{ frame: 5, name }],
      outDir: mkdtempSync(join(tmpdir(), "cap-out-")),
    });
    return png;
  } finally {
    delete process.env.KINO_COMPOSITOR;
    delete process.env.KINO_CAPTURE;
  }
};

describe("capture paths agree", () => {
  it("cdp and canvas capture produce the same pixels", async () => {
    const [a, b] = [await render("cdp", "cdp"), await render("canvas", "canvas")];
    const diff = parseFloat(
      magick([a, b, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim(),
    );
    expect(diff).toBeLessThan(0.001);
  }, 300000);
});
