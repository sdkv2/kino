// Cutout compositing through a REAL render: the subject region shows the BEAT's clip, the
// background region shows a DIFFERENT clip, and — the assertion this file exists for — BOTH
// ANIMATE. The capability was missing precisely because the generic video-texture path renders
// frame 0 forever and looks entirely plausible, so a test that only checked "those pixels came from
// the other clip" would pass against exactly that bug. This sequence has also shipped a helper
// wrong by 3x and a clock bug that survived a 30fps test, so every number below is predicted from
// the geometry, not read off the output.
//
// Both sources are frame-indexed ffmpeg ramps in DISJOINT channels, so a crop's HUE says which clip
// it came from and its VALUE says which frame:
//   asset    R = 40 + 7N,  G = B = 0
//   backdrop B = 40 + 7N,  R = 0, plus a green stripe at source x in [0.55, 0.60]
// The stripe pins the FIT: the backdrop is 16:9 in a 9:16 frame, so cover-fit shows only the middle
// 31.6% of its width and puts source u = 0.575 at x = 796; a naive stretch would put it at 621.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderStills } from "../src/render/render.js";
import { FFMPEG_PATH } from "../src/media/binPaths.js";
import { magick } from "./magick.js";
import type { KinoProps } from "../src/render/props.js";

const W = 1080, H = 1920; // composition
const BW = 1280, BH = 720; // backdrop — deliberately a different aspect
const F0 = 0, F1 = 20;
const lvl = (n: number) => (40 + 7 * n) / 255;

// Cover-fit of BW x BH into W x H: ra = 0.5625, ta = 1.7778, so uv.x is scaled by ra/ta about 0.5.
const COVER_SX = (W / H) / (BW / BH);
const STRIPE_U = 0.575; // centre of the source stripe
const STRIPE_X = W * (0.5 + (STRIPE_U - 0.5) / COVER_SX); // 796 — a stretch would say 621

// film: 0 kills the vignette+grain pass and disclosure "" the corner text — both would paint over
// the probe crops and skew a flat-colour mean.
const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0 };
const bg = {
  kind: "custom" as const, image: null, shaderCode: null,
  customCode: "ctx.fillStyle='#000';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);",
  params: {}, keyframes: [], triggers: [],
};

const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, background: bg, disclosure: "",
  segments: [{
    kind: "video", source: "asset.mp4", caption: "", startSec: 0, endSec: 2,
    // No subject/background body at all: mask + backdrop IS the cutout spec.
    regionShader: {
      masks: [{ maskSrc: "mask.png", maskKind: "image" as const, channel: "gray" as const, subjectCode: null }],
      subjectCode: null, backgroundCode: null, backdrop: "backdrop.mp4",
    },
  }],
};

const cropRgb = (p: string, w: number, h: number, x: number, y: number): number[] =>
  magick([p, "-crop", `${w}x${h}+${x}+${y}`, "+repage", "-format", "%[fx:mean.r] %[fx:mean.g] %[fx:mean.b]", "info:"])
    .trim().split(/\s+/).map(Number);
const meanDiff = (a: string, b: string) =>
  parseFloat(magick([a, b, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim());

describe("cutout compositing", () => {
  it("puts a different, ANIMATING clip behind the masked subject, cover-fit", async () => {
    const pub = mkdtempSync(join(tmpdir(), "kino-backdrop-"));

    // Beat asset: red ramp, frame-indexed by N. Composition-sized, so no fit question arises here.
    execFileSync(FFMPEG_PATH, ["-y", "-loglevel", "error",
      "-f", "lavfi", "-i", `color=black:s=${W}x${H}:r=30:d=2`,
      "-vf", "format=gbrp,geq=r='40+7*N':g='0':b='0'",
      "-c:v", "libx264", "-pix_fmt", "yuv444p", "-crf", "12", join(pub, "asset.mp4")]);

    // Backdrop: blue ramp + a green stripe at source x in [0.55, 0.60]. 16:9 on purpose.
    execFileSync(FFMPEG_PATH, ["-y", "-loglevel", "error",
      "-f", "lavfi", "-i", `color=black:s=${BW}x${BH}:r=30:d=2`,
      "-vf", `format=gbrp,geq=r='0':g='if(between(X,${Math.round(0.55 * BW)},${Math.round(0.6 * BW)}),255,0)':b='40+7*N'`,
      "-c:v", "libx264", "-pix_fmt", "yuv444p", "-crf", "12", join(pub, "backdrop.mp4")]);

    // Static mask: one rectangle. Static so the crops below are fixed and anything that changes
    // over time is a SOURCE moving, never the mask.
    magick(["-size", `${W}x${H}`, "xc:black", "-fill", "white",
            "-draw", "rectangle 240,600 840,1320", join(pub, "mask.png")]);

    const out = await renderStills({
      props, publicDir: pub, format: "9:16",
      frames: [{ frame: F0, name: "a" }, { frame: F1, name: "b" }, { frame: F0, name: "a2" }],
      outDir: mkdtempSync(join(tmpdir(), "kino-backdrop-out-")),
    });

    // 200x200 crops well clear of every seam. The subject crop sits inside the mask rectangle; the
    // background crop sits top-left, outside the mask AND clear of the stripe (cover-fit puts that
    // at x ≈ 711..881).
    const subj = (p: string) => cropRgb(p, 200, 200, 440, 860);
    const back = (p: string) => cropRgb(p, 200, 200, 100, 100);
    const s0 = subj(out[0]), s1 = subj(out[1]), b0 = back(out[0]), b1 = back(out[1]);
    console.log(`subject f${F0}=${s0} f${F1}=${s1} | background f${F0}=${b0} f${F1}=${b1}`);

    // 1. The subject region is the BEAT's clip (red), at the right frame.
    expect(Math.abs(s0[0] - lvl(F0))).toBeLessThan(0.035);
    expect(Math.abs(s1[0] - lvl(F1))).toBeLessThan(0.035);
    expect(s0[2]).toBeLessThan(0.06); // no blue — the subject is not the backdrop
    expect(s1[2]).toBeLessThan(0.06);

    // 2. The background region is the OTHER clip (blue), not the beat's asset.
    expect(b0[0]).toBeLessThan(0.06); // no red — the background is not the beat's plate
    expect(b1[0]).toBeLessThan(0.06);

    // 3. THE ASSERTION THIS FILE EXISTS FOR. The backdrop ADVANCES: a backdrop frozen at frame 0 —
    //    the bug this feature routes around — reads lvl(0) at both times and collapses this to 0.
    expect(Math.abs(b0[2] - lvl(F0))).toBeLessThan(0.035);
    expect(Math.abs(b1[2] - lvl(F1))).toBeLessThan(0.035);
    expect(b1[2] - b0[2]).toBeGreaterThan(0.45); // predicted 140/255 = 0.549
    expect(b1[2] - b0[2]).toBeLessThan(0.65);

    // 4. And the subject advanced too, by the same amount — BOTH regions moved, not just one.
    expect(s1[0] - s0[0]).toBeGreaterThan(0.45);
    expect(s1[0] - s0[0]).toBeLessThan(0.65);

    // 5. FIT. Cover-fit scales uv.x by ra/ta = 0.3164 about 0.5, so the source stripe's centre lands
    //    at x = 796 of 1080; a stretch (which is what an unuploaded uTexSize1 gives) says 621.
    //    Measured on the green channel in the top band, which is entirely background region.
    const sb = magick([out[1], "-crop", `${W}x400+0+0`, "+repage", "-channel", "G", "-separate",
                       "-threshold", "50%", "-format", "%@", "info:"]).trim();
    const [, sw, , sx] = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(sb)!.map(Number);
    console.log(`stripe bbox ${sb} centre ${sx + sw / 2} (cover-fit expects ${STRIPE_X.toFixed(0)}, stretch would be ${(W * STRIPE_U).toFixed(0)})`);
    expect(Math.abs(sx + sw / 2 - STRIPE_X)).toBeLessThan(25);

    // Determinism: two seeks to the same frame index are byte-identical.
    expect(meanDiff(out[0], out[2])).toBe(0);
  }, 300000);
});
