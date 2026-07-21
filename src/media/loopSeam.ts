// Post-build seamlessLoop check: extract first + last frame as raw RGB24 and compare.
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { FFMPEG_PATH } from "./binPaths.js";
import { SEAM_OK_MEAN, seamDiff } from "./seam.js";
import { log } from "../log.js";

async function extractRawRgb(
  video: string,
  out: string,
  seek: { ss?: number; sseof?: number },
): Promise<void> {
  // Input seeks (-ss / -sseof before -i) are reliable for container EOF; output seeks near
  // the end often yield an empty rawvideo dump.
  const args = ["-y", "-loglevel", "error"];
  if (seek.sseof != null) args.push("-sseof", String(seek.sseof));
  if (seek.ss != null) args.push("-ss", String(seek.ss));
  args.push("-i", video, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", out);
  await execa(FFMPEG_PATH, args);
}

/** Compare first vs last frame of an mp4. Logs ok/warn; never throws on soft mismatch. */
export async function checkLoopSeam(videoPath: string): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), "kino-seam-"));
  const first = join(dir, "first.rgb");
  const last = join(dir, "last.rgb");
  try {
    await extractRawRgb(videoPath, first, { ss: 0 });
    // ~3 frames before EOF — tiny sseof windows sometimes decode to empty on short packs
    await extractRawRgb(videoPath, last, { sseof: -0.1 });
    if (!statSync(first).size || !statSync(last).size) {
      log.warn("seamlessLoop seam: could not extract first/last frame — skip");
      return -1;
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
