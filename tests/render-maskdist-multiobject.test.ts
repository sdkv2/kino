// kinoMaskDist on a PACKED MULTI-OBJECT mask — three objects in R/G/B, which is what both SAM
// runners write for --objects > 1. tests/render-maskdist-video.test.ts covers the single-object
// grayscale case only, where coverage rides luma and 4:2:0 never touches it, so the packed case
// shipped unverified and measurably broken: flat-region coverage gradient reached 0.85 against a
// 0.05 analytic-branch gate, and thousands of deep-interior pixels per frame took the analytic
// branch and answered 0.5/g instead of the -radius they owe.
//
// Three independent lossy stages had to go, each individually enough to break the gate: 4:2:0
// subsampling (survives even lossless coding), lossy 4:4:4 coding, and JPEG re-extraction at
// -q:v 2.
//
// This rims OBJECT 1, the G channel — the per-object-regions feature's most natural use, and the
// channel that lives in subsampled chroma.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderStills } from "../src/render/render.js";
import { writeManifest } from "../src/segment/manifest.js";
import { FFMPEG_PATH } from "../src/media/binPaths.js";
import { magick } from "./magick.js";
import type { KinoProps } from "../src/render/props.js";

const W = 1080, H = 1920, DISC_R = 300;
// Object 1 (G) is the disc under test. It MOVES: a static clip codes every frame after the first
// as a near-free P-frame and badly understates the residual ringing a tracked mask carries.
// Frame-indexed, so the fixture is deterministic — no wall clock, no RNG.
const cx = (n: number) => 540 + n * 3;
const cy = (n: number) => 960 + n * 2;
const FRAME = 10;

// Large on purpose, same rationale as the single-object test: a flat pixel that wrongly takes the
// analytic branch answers 0.5/g, which only differs from the spiral's -radius when 0.5/g < radius.
// This is a detector, not a recommended radius.
const RADIUS = 64;

// green = |d| normalised over the radius, so green >= 0.5 IS the |d| = radius/2 isoline and its
// bounding box measures where that isoline landed. red is the documented thin rim.
const body =
  "void mainImage(out vec4 c, in vec2 f){\n" +
  `  float d = kinoMaskDist(uMask0, uChannel0, f, ${RADIUS.toFixed(1)});\n` +
  `  c = vec4(1.0 - smoothstep(0.0, 3.0, -d), clamp(-d / ${RADIUS.toFixed(1)}, 0.0, 1.0), 0.0, 1.0);\n}`;

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0 };
const bg = {
  kind: "custom" as const, image: null, shaderCode: null,
  customCode: "ctx.fillStyle='#000';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);",
  params: {}, keyframes: [], triggers: [],
};

/** mask.mp4 with THREE objects packed one per channel, as sam_runner*.py writes for n > 1.
 *  R (a sweeping bar) and B (a 24px comb, the finest structure in the frame) are the neighbours
 *  whose edges ring into G when the mask rides subsampled chroma. */
function writeMaskAsset(dir: string): void {
  const g = `if(lt(pow(X-(540+N*3),2)+pow(Y-(960+N*2),2),${DISC_R * DISC_R}),255,0)`;
  const r = `if(between(X-N*4,120,420)*between(Y,200,1700),255,0)`;
  const b = `if(gt(X,700)*lt(mod(X+N*2,48),24)*between(Y,300,1600),255,0)`;
  execFileSync(FFMPEG_PATH, [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", `color=black:s=${W}x${H}:r=30:d=1`,
    // geq needs an RGB layout to take r/g/b expressions; gbrp is the planar RGB ffmpeg offers.
    "-vf", `format=gbrp,geq=r='${r}':g='${g}':b='${b}'`,
    // Exactly the mask encode scripts/sam_runner_cuda.py writes. Swap this back to
    // `yuv420p -crf 16` and the speckle assertion below fails at 1280 — proof this test bites on
    // the encode stage. Reverting the PNG extraction in videoFrames.ts instead fails it at 528,
    // proof it bites on the extraction stage too. Both stages are load-bearing.
    "-c:v", "libx264", "-pix_fmt", "yuv444p", "-qp", "0",
    join(dir, "mask.mp4"),
  ]);
  writeManifest(dir, {
    kind: "video", source: "input.mp4", prompt: "three", width: W, height: H, fps: 30, frames: 30,
    objects: [
      { id: 0, label: "bar", channel: "r" },
      { id: 1, label: "disc", channel: "g" },
      { id: 2, label: "comb", channel: "b" },
    ],
    backend: "test", tracked: true,
  });
  magick(["-size", `${W}x${H}`, "xc:#333333", join(dir, "asset.png")]);
}

const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, background: bg, disclosure: "",
  segments: [{
    kind: "video", source: "asset.png", caption: "", startSec: 0, endSec: 2,
    regionShader: {
      masks: [{ maskSrc: "mask.mp4", maskKind: "video" as const, channel: "g" as const }],
      subjectCode: body, backgroundCode: body,
    },
  }],
};

describe("kinoMaskDist on a packed multi-object mask", () => {
  it("keeps chroma ringing out of the analytic branch on the G channel", async () => {
    const publicDir = mkdtempSync(join(tmpdir(), "kino-maskmulti-"));
    writeMaskAsset(publicDir);
    const out = await renderStills({
      props, publicDir, format: "9:16",
      frames: [{ frame: FRAME, name: "probe" }],
      outDir: mkdtempSync(join(tmpdir(), "kino-maskmulti-out-")),
    });

    const bbox = magick([out[0], "-channel", "G", "-separate", "-threshold", "50%", "-format", "%@", "info:"]).trim();
    const [, bw, bh, bx, by] = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(bbox)!.map(Number);
    const isoline = 2 * (DISC_R - RADIUS / 2);

    // Deep interior: a square inscribed well inside the disc, every pixel further than RADIUS from
    // the edge, so the whole crop owes a saturated -RADIUS. THIS is where the speckle lives.
    const side = 320;
    const crop = `${side}x${side}+${Math.round(cx(FRAME) - side / 2)}+${Math.round(cy(FRAME) - side / 2)}`;
    const meanG = parseFloat(magick([out[0], "-crop", crop, "+repage", "-format", "%[fx:mean.g]", "info:"]).trim());
    // Count of interior pixels that are NOT saturated — the direct speckle measure, and the one
    // assertion that separates a working analytic gate from a broken one.
    const speckle = Number(magick([out[0], "-crop", crop, "+repage", "-channel", "G", "-separate",
                                   "-threshold", "99%", "-negate", "-format", "%[fx:mean*w*h]", "info:"]).trim());
    console.log(`multi-object isoline bbox ${bbox} (expect ~${isoline}px, centred ${cx(FRAME)},${cy(FRAME)}) meanG=${meanG} speckle=${speckle}`);

    // Geometry. Also pins the mask decode AND the G-channel binding: had uChannel0 selected the
    // wrong channel, the bbox would be the bar (301x1501) or the comb, not a ~536px disc.
    expect(Math.abs(bx + bw / 2 - cx(FRAME))).toBeLessThan(6);
    expect(Math.abs(by + bh / 2 - cy(FRAME))).toBeLessThan(6);
    expect(Math.abs(bw - isoline)).toBeLessThan(30);
    expect(Math.abs(bh - isoline)).toBeLessThan(30);

    // THE regression bound. 0 speckled pixels once the mask is out of subsampled chroma and off
    // the JPEG re-extraction path; thousands while either stage remains.
    expect(speckle).toBeLessThan(50);
    expect(meanG).toBeGreaterThan(0.999);
  }, 240000);
});
