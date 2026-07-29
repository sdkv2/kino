// Per-object regions through a REAL render. String assertions on the assembled source cannot tell
// a composite in array order from one in reverse order, nor a uMaskSelf that resolved to the wrong
// slot — both compile, both read fine as text. So: two OVERLAPPING image masks, a different body on
// each, and four crops that each read one of the four regions the two masks carve the frame into.
import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

// film: 0 kills the vignette+grain finishing pass, disclosure "" the corner text — both paint over
// the probe and would skew a flat-colour crop mean.
const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0 };
const bg = {
  kind: "custom" as const, image: null,
  customCode: "ctx.fillStyle='#000';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);",
  shaderCode: null,
  params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 },
  keyframes: [], triggers: [],
};

const W = 1080, H = 1920;
// mask0 = x 100..600, mask1 = x 400..900, both y 400..1500 → they overlap on x 400..600.
const M0 = { x0: 100, x1: 600 }, M1 = { x0: 400, x1: 900 }, Y0 = 400, Y1 = 1500;

const RED = "void mainImage(out vec4 c, in vec2 f){ c = vec4(1.0, 0.0, 0.0, 1.0); }";
// Green, with the SELF-distance in blue: 1 deeper than 40px inside THIS mask, 0 elsewhere. If
// uMaskSelf resolved to uMask0 instead of uMask1, the mask1-only crop (100px clear of mask0, so
// d = +48 there) would read blue 0. Called unconditionally — kinoMaskDist reads derivatives, which
// are undefined under non-uniform control flow.
const GREEN_SELF =
  "void mainImage(out vec4 c, in vec2 f){\n" +
  "  float d = kinoMaskDist(uMaskSelf, uChannelSelf, f, 48.0);\n" +
  "  c = vec4(0.0, 1.0, 1.0 - step(-40.0, d), 1.0);\n}";
const BLUE = "void mainImage(out vec4 c, in vec2 f){ c = vec4(0.0, 0.0, 1.0, 1.0); }";

const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, background: bg, disclosure: "",
  segments: [{
    kind: "video", source: "asset.png", caption: "", startSec: 0, endSec: 2,
    regionShader: {
      masks: [
        { maskSrc: "mask0.png", maskKind: "image" as const, channel: "gray" as const, subjectCode: RED },
        { maskSrc: "mask1.png", maskKind: "image" as const, channel: "gray" as const, subjectCode: GREEN_SELF },
      ],
      subjectCode: null,
      backgroundCode: BLUE,
    },
  }],
};

// Mean rgb of one crop (ImageMagick geometry: WxH+X+Y).
const cropRgb = (p: string, w: number, h: number, x: number, y: number): number[] =>
  magick([p, "-crop", `${w}x${h}+${x}+${y}`, "+repage", "-format", "%[fx:mean.r] %[fx:mean.g] %[fx:mean.b]", "info:"])
    .trim().split(/\s+/).map(Number);
const meanDiff = (a: string, b: string) =>
  parseFloat(magick([a, b, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim());

describe("per-object region shaders", () => {
  it("shades each mask with its own body and paints later masks over earlier ones", async () => {
    const publicDir = mkdtempSync(join(tmpdir(), "kino-perobject-"));
    const rect = (x0: number, x1: number, out: string) =>
      magick(["-size", `${W}x${H}`, "xc:black", "-fill", "white",
              "-draw", `rectangle ${x0},${Y0} ${x1},${Y1}`, join(publicDir, out)]);
    rect(M0.x0, M0.x1, "mask0.png");
    rect(M1.x0, M1.x1, "mask1.png");
    magick(["-size", `${W}x${H}`, "xc:#333333", join(publicDir, "asset.png")]);

    const out = await renderStills({
      props, publicDir, format: "9:16",
      frames: [{ frame: 10, name: "probe" }, { frame: 10, name: "probe2" }],
      outDir: mkdtempSync(join(tmpdir(), "kino-perobject-out-")),
    });
    // All crops sit at y 800..1000 — 400px clear of both horizontal mask edges — and 50px+ clear of
    // every vertical boundary, so no crop straddles an antialiased seam.
    const only0 = cropRgb(out[0], 150, 200, 200, 800);
    const overlap = cropRgb(out[0], 100, 200, 450, 800);
    const only1 = cropRgb(out[0], 150, 200, 700, 800);
    const outside = cropRgb(out[0], 100, 200, 950, 800);
    console.log(`per-object crops: only0=${only0} overlap=${overlap} only1=${only1} outside=${outside}`);

    // mask0 alone → its own body (red). Proves entry 0 got ITS body, not the shared or last one.
    expect(only0[0]).toBeGreaterThan(0.9);
    expect(only0[1]).toBeLessThan(0.1);
    expect(only0[2]).toBeLessThan(0.1);

    // mask1 alone → green, and blue = 1 from kinoMaskDist(uMaskSelf) reading MASK 1's edge.
    expect(only1[1]).toBeGreaterThan(0.9);
    expect(only1[0]).toBeLessThan(0.1);
    expect(only1[2]).toBeGreaterThan(0.9);

    // THE OVERLAP RULE. Both masks cover this crop; masks[1] is later, so green wins outright.
    // Reverse the composite order and this crop reads red; average the two and it reads yellow.
    expect(overlap[1]).toBeGreaterThan(0.9);
    expect(overlap[0]).toBeLessThan(0.1);

    // Neither mask → the background body. Also rules out the night fill (b would be 0.13).
    expect(outside[2]).toBeGreaterThan(0.9);
    expect(outside[0]).toBeLessThan(0.1);
    expect(outside[1]).toBeLessThan(0.1);

    // Two seeks to the same frame index are byte-identical — no wall clock in the composite.
    expect(meanDiff(out[0], out[1])).toBe(0);
  }, 240000);
});
