// Post-build seamlessLoop check: extract first + last frame as raw RGB24 and compare.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { SEAM_OK_MEAN, seamDiff } from "./seam.js";
import { log } from "../log.js";

async function extractRawRgb(video: string, out: string, seek: { ss?: number; sseof?: number }): Promise<void> {
  const args = ["-y", "-loglevel", "error"];
  if (seek.sseof != null) args.push("-sseof", String(seek.sseof));
  if (seek.ss != null) args.push("-ss", String(seek.ss));
  args.push("-i", video, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", out);
  await execa("ffmpeg", args);
}

/** Compare first vs last frame of an mp4. Logs ok/warn; never throws on soft mismatch. */
export async function checkLoopSeam(videoPath: string): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), "kino-seam-"));
  const first = join(dir, "first.rgb");
  const last = join(dir, "last.rgb");
  try {
    await extractRawRgb(videoPath, first, { ss: 0 });
    // Seek near end; -sseof is relative to EOF
    try {
      await extractRawRgb(videoPath, last, { sseof: -0.04 });
    } catch {
      // Some builds reject sseof with certain containers — fall back to duration seek via ffprobe
      const { stdout } = await execa("ffprobe", [
        "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", videoPath,
      ]);
      const dur = parseFloat(stdout.trim());
      await extractRawRgb(videoPath, last, { ss: Math.max(0, dur - 0.05) });
    }
    const a = readFileSync(first);
    const b = readFileSync(last);
    if (a.length !== b.length) {
      log.warn(`seamlessLoop seam: frame size mismatch (${a.length} vs ${b.length}) — skip`);
      return -1;
    }
    const mean = seamDiff(a, b);
    if (mean <= SEAM_OK_MEAN) log.ok(`seamlessLoop seam ok (mean Δ ${mean.toFixed(2)}/255)`);
    else log.warn(`seamlessLoop seam noisy (mean Δ ${mean.toFixed(2)}/255) — check first≡last ready-state`);
    return mean;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
