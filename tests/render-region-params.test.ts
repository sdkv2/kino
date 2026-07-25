// Region-shader params through a REAL render. A string assertion that a keyframe parsed proves
// nothing — it cannot tell a tween from a constant, nor a beat-relative clock from an absolute one.
// So: one beat that STARTS AT 2s (absolute and beat-relative therefore disagree), a param tweened
// 0->1 over beat-relative 0..1s, and three frames read off the rendered pixels.
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
const MX0 = 100, MX1 = 600, MY0 = 400, MY1 = 1500; // mask rect

// Subject reads the tweened param straight out to greyscale. Background is a constant blue control:
// it must stay pinned across all three frames, so movement there would mean something OTHER than
// the param changed.
const SUBJ = "void mainImage(out vec4 c, in vec2 f){ c = vec4(vec3(u_lift), 1.0); }";
const BG = "void mainImage(out vec4 c, in vec2 f){ c = vec4(0.0, 0.0, 1.0, 1.0); }";

// The beat starts at 2s. Under BEAT-relative timing, composition frame 60 is beat t=0 -> lift 0.
// Under ABSOLUTE timing it would be t=2, past the last keyframe -> lift 1. The t0 assertion below
// is what separates the two.
const START = 2;
const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "",
  segments: [{
    kind: "video", source: "asset.png", caption: "", startSec: START, endSec: START + 3,
    regionShader: {
      masks: [{ maskSrc: "mask0.png", maskKind: "image" as const, channel: "gray" as const, subjectCode: null }],
      subjectCode: SUBJ,
      backgroundCode: BG,
      params: { lift: 0 },
      keyframes: [{ at: 0, params: { lift: 0 } }, { at: 1, params: { lift: 1 } }],
    },
  }],
};

// Mean rgb of one crop (ImageMagick geometry: WxH+X+Y).
const cropRgb = (p: string, w: number, h: number, x: number, y: number): number[] =>
  magick([p, "-crop", `${w}x${h}+${x}+${y}`, "+repage", "-format", "%[fx:mean.r] %[fx:mean.g] %[fx:mean.b]", "info:"])
    .trim().split(/\s+/).map(Number);
const meanDiff = (a: string, b: string) =>
  parseFloat(magick([a, b, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim());

describe("region shader params", () => {
  it("tweens a param over the beat on a beat-relative clock", async () => {
    const publicDir = mkdtempSync(join(tmpdir(), "kino-rparams-"));
    magick(["-size", `${W}x${H}`, "xc:black", "-fill", "white",
            "-draw", `rectangle ${MX0},${MY0} ${MX1},${MY1}`, join(publicDir, "mask0.png")]);
    magick(["-size", `${W}x${H}`, "xc:#333333", join(publicDir, "asset.png")]);

    const f = (s: number) => Math.round(s * 30);
    const out = await renderStills({
      props, publicDir, format: "9:16",
      frames: [
        { frame: f(START), name: "t0" },        // beat t = 0.0 -> lift 0
        { frame: f(START + 0.5), name: "t05" }, // beat t = 0.5 -> lift 0.5
        { frame: f(START + 1), name: "t1" },    // beat t = 1.0 -> lift 1
        { frame: f(START + 1), name: "t1b" },   // determinism repeat
      ],
      outDir: mkdtempSync(join(tmpdir(), "kino-rparams-out-")),
    });

    // Subject crop: well inside the mask, 100px+ clear of every edge, so it never straddles the
    // antialiased seam. Background crop: outside the mask entirely.
    const sub = (p: string) => cropRgb(p, 300, 300, 200, 700);
    const back = (p: string) => cropRgb(p, 200, 300, 750, 700);
    const [s0, s05, s1] = [sub(out[0]), sub(out[1]), sub(out[2])];
    console.log(`region params subject: t0=${s0} t0.5=${s05} t1=${s1}`);
    console.log(`region params background: t0=${back(out[0])} t1=${back(out[2])}`);

    // The endpoints. t0 near BLACK is also the beat-relative proof: an absolute clock would be at
    // t=2 here, past the last keyframe, and render white.
    expect(s0[0]).toBeLessThan(0.02);
    expect(s1[0]).toBeGreaterThan(0.98);

    // THE TWEEN. A param that merely held its base value, or jumped between keyframe values, would
    // read 0 or 1 here — not the midpoint. This is the assertion the whole test exists for.
    expect(s05[0]).toBeGreaterThan(0.45);
    expect(s05[0]).toBeLessThan(0.55);

    // Grey, not tinted — all three channels track the one param.
    expect(Math.abs(s05[0] - s05[1])).toBeLessThan(0.01);
    expect(Math.abs(s05[0] - s05[2])).toBeLessThan(0.01);

    // The control: the background body reads no param, so it must not move at all. Also rules out
    // the night fill (b would be 0.13) — i.e. proves the program actually compiled.
    expect(back(out[0])[2]).toBeGreaterThan(0.98);
    expect(back(out[2])[2]).toBeGreaterThan(0.98);

    // Two seeks to the same frame index are byte-identical — no wall clock in the tween.
    expect(meanDiff(out[2], out[3])).toBe(0);
  }, 240000);
});
