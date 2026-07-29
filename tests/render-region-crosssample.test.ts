// Cross-region sampling through a REAL render. A string assertion cannot tell a background sample
// from a subject sample, nor an offset one from a same-pixel one — and this sequence has twice
// shipped tests that passed against broken code (phase 1's helper was wrong by 3x; phase 3's clock
// bug survived a 30fps test because 30/30 is 1 either way).
//
// So the background body is a MONOTONE VERTICAL RAMP, value == y / H. Its output at a pixel is then
// an exact invertible function of y, which makes an offset sample numerically separable from a
// same-pixel one instead of a thing you judge by eye. One frame, one mask; the subject body splits
// on x — left half samples at offset 0, right half at +D px in y — so three crops at the SAME y pin
// all three claims at once.
import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

// film: 0 kills the vignette+grain finishing pass, disclosure "" the corner text — both paint over
// the probe crops and would skew a flat-colour mean.
const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0 };
const bg = {
  kind: "custom" as const, image: null,
  customCode: "ctx.fillStyle='#000';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);",
  shaderCode: null,
  params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 },
  keyframes: [], triggers: [],
};

const W = 1080, H = 1920;
const D = 192; // offset in px. D / H = 0.1 exactly — a round number to assert against.

// The ramp. Deliberately NOT a function of uTex0: a subject that read the plate instead of the
// background body would not track this at all.
const BG = "void mainImage(out vec4 c, in vec2 f){ c = vec4(vec3(f.y / iResolution.y), 1.0); }";

// Left half offset 0, right half +D in y. Both go through kinoBackground, so the ONLY difference
// between the two crops is the coordinate handed to it. The branch selects a VALUE, not whether the
// call happens — kinoBackground stays in uniform control flow, as its contract requires.
const SUBJ = `
void mainImage(out vec4 c, in vec2 f){
  float dy = f.x < iResolution.x * 0.5 ? 0.0 : ${D}.0;
  kinoBackground(c, f + vec2(0.0, dy));
}`;

const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, background: bg, disclosure: "",
  segments: [{
    kind: "video", source: "asset.png", caption: "", startSec: 0, endSec: 2,
    regionShader: {
      masks: [{ maskSrc: "mask0.png", maskKind: "image" as const, channel: "gray" as const, subjectCode: null }],
      subjectCode: SUBJ, backgroundCode: BG, params: {}, keyframes: [],
    },
  }],
};

const cropRgb = (p: string, w: number, h: number, x: number, y: number): number[] =>
  magick([p, "-crop", `${w}x${h}+${x}+${y}`, "+repage", "-format", "%[fx:mean.r] %[fx:mean.g] %[fx:mean.b]", "info:"])
    .trim().split(/\s+/).map(Number);
const meanDiff = (a: string, b: string) =>
  parseFloat(magick([a, b, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim());

describe("cross-region sampling", () => {
  it("samples the shaded background body at an offset", async () => {
    const publicDir = mkdtempSync(join(tmpdir(), "kino-xregion-"));
    // Mask: a wide band spanning both halves of the frame, so one crop lands in the offset-0 half
    // and one in the offset-D half at the SAME y.
    magick(["-size", `${W}x${H}`, "xc:black", "-fill", "white",
            "-draw", `rectangle 80,700 ${W - 80},1200`, join(publicDir, "mask0.png")]);
    magick(["-size", `${W}x${H}`, "xc:#333333", join(publicDir, "asset.png")]);

    const out = await renderStills({
      props, publicDir, format: "9:16",
      frames: [{ frame: 15, name: "x" }, { frame: 15, name: "xb" }],
      outDir: mkdtempSync(join(tmpdir(), "kino-xregion-out-")),
    });

    // All three crops are 100px+ clear of every mask edge and of the x=540 split, so none straddles
    // an antialiased seam. The two inside-mask crops share the y band 860..1060, centre y = 960.
    const Y = 860, CH = 200;
    const left = cropRgb(out[0], 300, CH, 120, Y);      // inside mask, offset 0
    const right = cropRgb(out[0], 300, CH, 660, Y);     // inside mask, offset +D
    // gl_FragCoord.y counts from the BOTTOM, ImageMagick crops from the TOP. The crop's centre image
    // row is Y + CH/2 = 960, i.e. gl_FragCoord.y = H - 960 = 960, so the ramp reads 960/1920 = 0.5.
    const expectLeft = (H - (Y + CH / 2)) / H;
    console.log(`xregion left=${left} right=${right} expect left≈${expectLeft} delta≈${D / H}`);

    // 1. kinoBackground IS the background body: at offset 0 the subject must read exactly what the
    //    background renders at that pixel.
    expect(Math.abs(left[0] - expectLeft)).toBeLessThan(0.01);

    // 2. THE ASSERTION THIS PHASE EXISTS FOR. Offsetting the lookup by +D px in gl_FragCoord.y moves
    //    the sampled ramp by exactly D/H = 0.1, and upward in fragCoord space.
    expect(right[0] - left[0]).toBeGreaterThan(0.09);
    expect(right[0] - left[0]).toBeLessThan(0.11);

    // 3. Self-contained bite for #2: both crops come from the same call, differing ONLY in the
    //    coordinate argument, so an implementation that dropped the offset collapses them together.
    expect(Math.abs(right[0] - left[0])).toBeGreaterThan(0.05);

    // Grey, not tinted — the ramp writes all three channels equally, so a colour shift would mean
    // something other than the background body produced these pixels.
    expect(Math.abs(left[0] - left[2])).toBeLessThan(0.01);

    // Rules out the night fill (#0b1020 → r≈0.04, b≈0.13), i.e. proves the program actually compiled
    // rather than the beat falling back to the theme colour.
    expect(left[0]).toBeGreaterThan(0.2);

    // Determinism: two seeks to the same frame index are byte-identical.
    expect(meanDiff(out[0], out[1])).toBe(0);
  }, 240000);
});
