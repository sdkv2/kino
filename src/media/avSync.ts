// After the video encode, AAC often pads a few dozen ms past the last video frame.
// Players then paint black (or an empty canvas) while the leftover audio plays — fatal for
// seamless-loop ads. Hold the last video frame to cover the overhang.
import { renameSync, unlinkSync } from "node:fs";
import { execa } from "execa";
import { FFMPEG_PATH, FFPROBE_PATH } from "./binPaths.js";

async function streamDuration(file: string, which: "v:0" | "a:0"): Promise<number> {
  const { stdout } = await execa(FFPROBE_PATH, [
    "-v", "error",
    "-select_streams", which,
    "-show_entries", "stream=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  return parseFloat(stdout.trim());
}

/** If audio is longer than video, clone the last frame to cover the gap. Returns pad seconds (0 = noop). */
export async function holdLastFrameToMatchAudio(videoPath: string): Promise<number> {
  const vDur = await streamDuration(videoPath, "v:0");
  const aDur = await streamDuration(videoPath, "a:0");
  if (!Number.isFinite(vDur) || !Number.isFinite(aDur)) return 0;
  const pad = aDur - vDur;
  // <1 frame at 30fps — not visible; skip the re-encode
  if (pad < 1 / 30) return 0;

  const tmp = videoPath.replace(/\.mp4$/i, "") + ".avsync-tmp.mp4";
  try {
    await execa(FFMPEG_PATH, [
      "-y", "-loglevel", "error",
      "-i", videoPath,
      "-vf", `tpad=stop_mode=clone:stop_duration=${pad.toFixed(4)}`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast",
      "-c:a", "copy",
      tmp,
    ]);
    renameSync(tmp, videoPath);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
  return pad;
}
