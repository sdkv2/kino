// kinoMaskDist against a REAL compressed VIDEO mask — the input every other test of this helper
// leaves out. tests/render-maskdist.test.ts draws a lossless PNG disc, so it can never observe
// what lossy coding does to the analytic branch's gradient gate, and that gap is how the gate
// constant shipped twice without a measurement. This builds a mask.mp4 the way
// scripts/sam_runner_cuda.py does (libx264, yuv420p, crf 16) and lets the renderer re-extract it
// to JPEG q:v 2 exactly as src/render/native/videoFrames.ts does, so the texture the shader
// samples carries genuine DCT ringing.
//
// What it pins: codec ringing must not reach the analytic branch. A pixel further from the edge
// than `radius` owes -radius from either regime. Ringing gives such a pixel a small spurious
// coverage gradient; if the gate lets that through, the analytic branch answers 0.5/g instead, and
// every isoline of the distance field — every rim, erode and glow — moves. Measured here as the
// position of the |d| = radius/2 isoline: 551x554 at the shipped gate, 596x598 at the old 0.01
// (~22px of erode error). See docs/superpowers/specs/2026-07-24-maskdist-gate-measurement.md.
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
// Disc centre at mask frame N. It MOVES: a static clip codes every frame after the first as a
// near-free P-frame and badly understates the residual ringing a tracked mask actually carries.
const cx = (n: number) => 540 + n * 3;
const cy = (n: number) => 960 + n * 2;
const FRAME = 10;

// Large on purpose. A flat pixel that wrongly takes the analytic branch answers 0.5/g, which only
// differs from the spiral's -radius when 0.5/g < radius — so the misroute is invisible at a small
// radius (at 4, the worst measured gradient of 0.044 still clamps) and plain at a large one. This
// is a detector, not a recommended radius; real effects should pass the smallest radius they need.
const RADIUS = 64;

// green = |d| normalised over the radius, so the green >= 0.5 contour IS the |d| = radius/2
// isoline and its bounding box measures where that isoline landed. red is the documented thin rim,
// kept as a sanity view of the same field.
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

/** mask.mp4 + manifest.json, the shape `kino segment` writes for a tracked single-object video. */
function writeMaskAsset(dir: string): void {
  // One ffmpeg call, one geq expression, frame-indexed by N — deterministic, no wall clock.
  // cb/cr are pinned neutral ON PURPOSE: geq given only a `lum` expression fills the CHROMA planes
  // from that same expression at chroma resolution, which paints a coloured blob into the corner
  // and stops the mask being grayscale at all. sam_runner writes R=G=B frames, i.e. neutral
  // chroma, so 128/128 is what the real pipeline hands to libx264.
  const disc = `if(lt(pow(X-(540+N*3),2)+pow(Y-(960+N*2),2),${DISC_R * DISC_R}),255,0)`;
  execFileSync(FFMPEG_PATH, [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", `color=black:s=${W}x${H}:r=30:d=1`,
    "-vf", `geq=lum='${disc}':cb=128:cr=128`,
    // Exactly scripts/sam_runner_cuda.py's mask encode.
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16",
    join(dir, "mask.mp4"),
  ]);
  writeManifest(dir, {
    kind: "video", source: "input.mp4", prompt: "disc", width: W, height: H, fps: 30, frames: 30,
    objects: [{ id: 0, label: "disc", channel: "gray" }], backend: "test", tracked: true,
  });
  magick(["-size", `${W}x${H}`, "xc:#333333", join(dir, "asset.png")]);
}

const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "",
  segments: [{
    kind: "video", source: "asset.png", caption: "", startSec: 0, endSec: 2,
    regionShader: {
      masks: [{ maskSrc: "mask.mp4", maskKind: "video" as const, channel: "gray" as const }],
      subjectCode: body, backgroundCode: body,
    },
  }],
};

describe("kinoMaskDist on a compressed video mask", () => {
  it("keeps codec ringing out of the analytic branch", async () => {
    const publicDir = mkdtempSync(join(tmpdir(), "kino-maskvid-"));
    writeMaskAsset(publicDir);
    const out = await renderStills({
      props, publicDir, format: "9:16",
      frames: [{ frame: FRAME, name: "probe" }],
      outDir: mkdtempSync(join(tmpdir(), "kino-maskvid-out-")),
    });

    const bbox = magick([out[0], "-channel", "G", "-separate", "-threshold", "50%", "-format", "%@", "info:"]).trim();
    const [, bw, bh, bx, by] = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(bbox)!.map(Number);
    const isoline = 2 * (DISC_R - RADIUS / 2);
    // Deep interior: a square inscribed well inside the disc, every pixel of it further than
    // RADIUS from the edge, so the whole crop owes a saturated -RADIUS.
    const side = 320;
    const crop = `${side}x${side}+${Math.round(cx(FRAME) - side / 2)}+${Math.round(cy(FRAME) - side / 2)}`;
    const meanG = parseFloat(magick([out[0], "-crop", crop, "+repage", "-format", "%[fx:mean.g]", "info:"]).trim());
    console.log(`isoline bbox ${bbox} (expect ~${isoline}px, centred ${cx(FRAME)},${cy(FRAME)}) interior meanG=${meanG}`);

    // Centre is pure geometry. It also pins the mask decode: a mask.mp4 that landed shifted or
    // rescaled would let the interior crop sample the OUTSIDE and read a clean value for entirely
    // the wrong reason.
    expect(Math.abs(bx + bw / 2 - cx(FRAME))).toBeLessThan(6);
    expect(Math.abs(by + bh / 2 - cy(FRAME))).toBeLessThan(6);

    // THE regression bound. Measured 551x554 at every gate from 0.02 to 0.4 (identical renders),
    // and 596x598 at the old 0.01 — far outside any codec or ImageMagick version drift.
    expect(Math.abs(bw - isoline)).toBeLessThan(30);
    expect(Math.abs(bh - isoline)).toBeLessThan(30);

    // The interior stays saturated in every configuration measured; this is the cheap guard that
    // the field is a real distance and not, say, a constant or an inverted sign.
    expect(meanG).toBeGreaterThan(0.999);
  }, 180000);
});
