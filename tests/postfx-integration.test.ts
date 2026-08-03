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

// The add-back, through the REAL render path.
//
// `postFx.bloom` was a no-op in every render for as long as it has existed, while its unit tests
// stayed green: `probeEffect` runs a single pass at the default `axis`, so it only ever exercised
// the blur. The add-back lived in a third branch of the same shader, and on the ANGLE/Metal
// backend the `uSrc` fetch in that branch returned zero whenever `uOriginal` was sampled beside
// it — so `base + bloom` evaluated to `base`.
//
// It has to be asserted HERE, on a real render, because the bug was backend-specific: the same
// chain driven through a plain webgl2 context in the glProbe host produced correct pixels. A
// logical test of the composite cannot catch a miscompile the real backend has and the test host
// does not.
describe("postFx.bloom add-back", () => {
  // A bright disc on a dark field: outside the disc the source is dark, so anything there came
  // from the bloom. The background draw fn paints the whole frame, so the disc is the caption.
  const disc = {
    kind: "custom" as const, image: null, shaderCode: null,
    customCode:
      "const w=ctx.canvas.width,h=ctx.canvas.height;ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);" +
      "ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(w/2,h/2,w/16,0,Math.PI*2);ctx.fill();",
    params: {}, keyframes: [], triggers: [],
  };
  const mkDisc = (postFx?: unknown): KinoProps => ({
    theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
    background: disc, disclosure: "",
    segments: [{ kind: "scene", caption: "", startSec: 0, endSec: 2 }],
    ...(postFx ? { postFx: postFx as KinoProps["postFx"] } : {}),
  });

  // Sampled 107px below centre: outside the disc (radius w/16 = 67px), inside the 60px bloom.
  const SAMPLE_Y = 960 + 107;
  const redAt = (png: string, y: number): number =>
    Number(magick([png, "-crop", `1x1+540+${y}`, "+repage", "-format", "%[fx:int(255*r+0.5)]", "info:"]));

  it("puts light outside the source, where the frame was black", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      const off = await render(mkDisc(), "bloom-off");
      const on = await render(mkDisc({ bloom: { threshold: 0, intensity: 4, radius: 60 } }), "bloom-on");
      expect(redAt(off, SAMPLE_Y)).toBeLessThan(8);
      // ~23/255 here with the add-back working, <8 without it — a 3x separation, not a hair.
      expect(redAt(on, SAMPLE_Y)).toBeGreaterThan(15);
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 300000);

  it("scales with intensity", async () => {
    process.env.KINO_COMPOSITOR = "1";
    try {
      const lo = await render(mkDisc({ bloom: { threshold: 0, intensity: 1, radius: 60 } }), "bloom-lo");
      const hi = await render(mkDisc({ bloom: { threshold: 0, intensity: 6, radius: 60 } }), "bloom-hi");
      expect(redAt(hi, SAMPLE_Y)).toBeGreaterThan(redAt(lo, SAMPLE_Y));
    } finally {
      delete process.env.KINO_COMPOSITOR;
    }
  }, 300000);
});
