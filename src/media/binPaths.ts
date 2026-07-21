import { execSync } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

// Prefer a system binary when present — it's typically newer than the bundled static build and
// some of our silence/artifact heuristics are calibrated against real encoder output that can
// shift a few ms across ffmpeg versions. Bundled binaries are the zero-install fallback.
function onPath(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export const FFMPEG_PATH = onPath("ffmpeg") ? "ffmpeg" : (ffmpegStatic ?? "ffmpeg");
export const FFPROBE_PATH = onPath("ffprobe") ? "ffprobe" : (ffprobeStatic.path ?? "ffprobe");
