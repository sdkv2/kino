import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { appFreezeFrame, appTrimFrames } from "../src/render/appMedia.js";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import type { KinoProps } from "../src/render/props.js";

// Frame-accuracy proof for video-in-page app beats: the source video encodes its own frame index
// in the red channel (frame N = rgb(N*4, 0, 0)), so sampling a rendered still tells us EXACTLY
// which source frame the engine composited. The expected index comes from the same pure helpers
// the composition uses (appTrimFrames + appFreezeFrame) — clipFrom offset, speed remap, and the
// pauseAt freeze must all hit the precise frame, not a nearby one.

const FPS = 30;
const SRC_FRAMES = 90; // 3s @30fps

async function makeIndexVideo(dir: string): Promise<string> {
  // One PPM per frame, red = index*2 (0..178 stays linear through yuv broadcast-range roundtrip).
  const list: string[] = [];
  for (let n = 0; n < SRC_FRAMES; n++) {
    const p = join(dir, `src-${String(n).padStart(3, "0")}.ppm`);
    const w = 32;
    const h = 32;
    const header = Buffer.from(`P6\n${w} ${h}\n255\n`);
    const px = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      px[i * 3] = n * 2;
      px[i * 3 + 1] = 0;
      px[i * 3 + 2] = 0;
    }
    writeFileSync(p, Buffer.concat([header, px]));
    list.push(p);
  }
  const out = join(dir, "app.mp4");
  await execa("ffmpeg", [
    "-y", "-loglevel", "error",
    "-framerate", String(FPS),
    "-i", join(dir, "src-%03d.ppm"),
    "-c:v", "libx264", "-qp", "0", "-pix_fmt", "yuv444p",
    out,
  ]);
  return out;
}

const redAt = (png: string) => {
  const s = execSync(`magick "${png}" -format "%[pixel:p{540,960}]" info:`).toString();
  const m = s.match(/srgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) throw new Error(`Unexpected pixel format: ${s}`);
  return Number(m[1]);
};

describe("app cut-in frame accuracy (clip window + speed + pauseAt)", () => {
  it("composites the exact source frame the clip math demands, including across the freeze", async () => {
    const publicDir = mkdtempSync(join(tmpdir(), "kino-idxsrc-"));
    await makeIndexVideo(publicDir);
    const clipFrom = 0.5;
    const speed = 0.5;
    const pauseAt = 1.2;
    const props: KinoProps = {
      theme: { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0 },
      fps: FPS,
      avatar: null,
      avatarWindows: [],
      voTrack: null,
      logo: null,
      background: { kind: "solid", image: null, customCode: null, params: { colorA: "#000000", colorB: "#000000", colorC: "#000000", intensity: 0 }, keyframes: [], triggers: [] },
      disclosure: "",
      segments: [
        {
          kind: "app",
          asset: "app.mp4",
          caption: "",
          startSec: 0,
          endSec: 2,
          shot: "static",
          transition: "cut",
          clipFrom,
          speed,
          pauseAt,
        },
      ],
    };
    // Sample around the timeline: playing (10, 30), just before the pause (35), frozen (40, 55).
    const probes = [10, 30, 35, 40, 55];
    const outDir = mkdtempSync(join(tmpdir(), "kino-idxout-"));
    const outs = await renderStills({
      props,
      publicDir,
      format: "9:16",
      frames: probes.map((frame) => ({ frame, name: `p${frame}` })),
      outDir,
    });
    const { trimBefore } = appTrimFrames(FPS, clipFrom);
    probes.forEach((localFrame, i) => {
      const eff = appFreezeFrame({ localFrame, fps: FPS, pauseAt, clipFrom, speed }) ?? localFrame;
      const expectedSrcFrame = Math.round(trimBefore + eff * speed);
      const expectedRed = expectedSrcFrame * 2;
      // ±5: one yuv/x264 roundtrip of tolerance — half a frame step (speed 0.5 ⇒ 1 red unit) stays
      // well inside, a one-frame error (2 units at speed 0.5, 4 at speed 1) is caught by the exact
      // probes below; the freeze probes must agree with each other exactly.
      expect(Math.abs(redAt(outs[i]) - expectedRed), `frame ${localFrame}: red ${redAt(outs[i])} vs expected ${expectedRed}`).toBeLessThanOrEqual(5);
    });
    // The pause must be a hard freeze: both post-pause probes show the identical source frame.
    expect(redAt(outs[3])).toBe(redAt(outs[4]));
    // And the freeze holds the pauseAt frame, not the last played frame or frame 0.
    const pauseEff = appFreezeFrame({ localFrame: 40, fps: FPS, pauseAt, clipFrom, speed })!;
    expect(pauseEff).toBe(Math.round(pauseAt * FPS));
  }, 180000);
});
