import { execa } from "execa";
import { extname, join } from "node:path";
import { FFMPEG_PATH } from "../media/binPaths.js";
import { writeManifest, type MaskManifest } from "./manifest.js";
import type { Backend, SegmentRequest, SegmentResult } from "./backend.js";

// ponytail: fixed 1080x1920 canvas — mock never probes the real input, deterministic output is
// the point (CI-testable with no Mac/model). Bump if a caller actually needs a different frame size.
const WIDTH = 1080;
const HEIGHT = 1920;
const VIDEO_EXT = /\.(mp4|mov|webm|mkv)$/i;

// Centered ellipse, luma-only geq: white inside the ellipse, black outside. Shared by the image
// and video paths so both mocks look the same shape.
function ellipseExpr(): string {
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const rx = WIDTH * 0.28;
  const ry = HEIGHT * 0.26;
  return `if(lt(pow((X-${cx})/${rx},2)+pow((Y-${cy})/${ry},2),1),255,0)`;
}

async function writeMaskPng(out: string): Promise<void> {
  await execa(FFMPEG_PATH, [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", `color=black:s=${WIDTH}x${HEIGHT}`,
    "-frames:v", "1",
    "-vf", `geq=lum='${ellipseExpr()}'`,
    "-pix_fmt", "gray",
    out,
  ]);
}

async function writeMaskMp4(out: string): Promise<void> {
  await execa(FFMPEG_PATH, [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", `color=black:s=${WIDTH}x${HEIGHT}:r=30:d=2`,
    "-vf", `geq=lum='${ellipseExpr()}'`,
    "-pix_fmt", "yuv420p", "-c:v", "libx264",
    out,
  ]);
}

export const mockBackend: Backend = {
  name: "mock",
  async run(req: SegmentRequest): Promise<SegmentResult> {
    const isVideo = VIDEO_EXT.test(extname(req.input));
    const kind: MaskManifest["kind"] = isVideo ? "video" : "image";

    let fps: number | undefined;
    let frames: number | undefined;
    if (isVideo) {
      await writeMaskMp4(join(req.outDir, "mask.mp4"));
      fps = 30;
      frames = 60;
    } else {
      await writeMaskPng(join(req.outDir, "mask.png"));
    }

    const manifest: MaskManifest = {
      kind,
      source: req.input,
      prompt: req.prompt,
      width: WIDTH,
      height: HEIGHT,
      ...(fps !== undefined ? { fps } : {}),
      ...(frames !== undefined ? { frames } : {}),
      objects: [{ id: 0, label: req.prompt, channel: isVideo ? "r" : "gray" }],
      backend: "mock",
      // The mock produces a static per-frame ellipse — zero temporal tracking. Report the capability
      // honestly (false), never the caller's request. (coreml hardwires false the same way.)
      tracked: false,
    };
    writeManifest(req.outDir, manifest);

    return { manifest, outDir: req.outDir };
  },
};
