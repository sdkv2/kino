import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { FFMPEG_PATH } from "../media/binPaths.js";
import { containedPath } from "../config/project.js";

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;

/** Resolve a segment input to an on-disk image path (absolute path or project assets/). */
export function resolveSegmentInput(input: string, projectRoot: string): string {
  const abs = resolve(input);
  if (existsSync(abs)) return abs;
  const fromAssets = join(projectRoot, "assets", input);
  if (existsSync(fromAssets)) return fromAssets;
  throw new Error(`segment input not found: ${input}`);
}

export function isImageSegmentInput(input: string): boolean {
  return IMAGE_EXT.test(input);
}

/** Project-relative path under assets/ for a transparent subject PNG.
 *
 * POSIX separators, not the platform's: this string is written into manifest.json and read back
 * as a spec `source`, so it has to mean the same thing on every machine. `join` would emit
 * `cutouts\name.png` on Windows — a manifest that only resolves on the OS that produced it, and
 * which the CLI then prints as the mixed `assets/cutouts\name.png`. */
export function cutoutRelPath(outName: string): string {
  return posix.join("cutouts", `${outName}.png`);
}

/** Bake mask luminance into the source image alpha → RGBA PNG at the mask canvas size. */
export function writeImageCutout(opts: {
  input: string;
  maskPath: string;
  dest: string;
  width: number;
  height: number;
}): void {
  mkdirSync(dirname(opts.dest), { recursive: true });
  const { width: w, height: h } = opts;
  execFileSync(FFMPEG_PATH, [
    "-y",
    "-loglevel",
    "error",
    "-i",
    opts.input,
    "-i",
    opts.maskPath,
    "-filter_complex",
    `[0:v]scale=${w}:${h}[rgb];[1:v]format=gray,scale=${w}:${h}[a];[rgb][a]alphamerge`,
    "-frames:v",
    "1",
    opts.dest,
  ]);
}

export function cutoutAssetPath(projectRoot: string, outName: string): string {
  return containedPath(join(projectRoot, "assets", "cutouts"), `${outName}.png`);
}
