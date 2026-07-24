import { execSync } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

// Prefer a system binary when present — it's typically newer than the bundled static build and
// some of our silence/artifact heuristics are calibrated against real encoder output that can
// shift a few ms across ffmpeg versions. Bundled binaries are the zero-install fallback.
//
// "Typically newer" is not "always newer": Ubuntu 22.04 (and Debian bullseye) still ship ffmpeg
// 4.4, which predates `-fps_mode` — a flag the frame extractor passes on every video beat. There
// an apt-installed ffmpeg silently outranks the bundled build and every render dies with
// "Unrecognized option 'fps_mode'". So a system binary has to earn the preference.
const MIN_MAJOR = 5;

/** Should a system binary that printed this `-version` banner outrank the bundled one? Split out
 *  as a pure function so the version parsing is testable without a real ffmpeg on PATH. */
export function preferSystem(versionBanner: string): boolean {
  // "ffmpeg version 6.1.1", "ffmpeg version n7.0", "ffmpeg version 4.4.2-0ubuntu0.22.04.1"
  const m = versionBanner.match(/version\s+n?(\d+)\./);
  // Nightly/git builds print a hash instead of a semver ("version N-113831-g8f0d1e8"). Those
  // track master, so treat an unparseable version as current rather than demoting it.
  return !m || Number(m[1]) >= MIN_MAJOR;
}

function usableOnPath(cmd: string): boolean {
  try {
    // Doubles as the presence check — a missing binary throws here. Works on win32 too, where
    // `command -v` does not exist.
    const banner = execSync(`${cmd} -version`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return preferSystem(banner);
  } catch {
    return false;
  }
}

export const FFMPEG_PATH = usableOnPath("ffmpeg") ? "ffmpeg" : (ffmpegStatic ?? "ffmpeg");
export const FFPROBE_PATH = usableOnPath("ffprobe") ? "ffprobe" : (ffprobeStatic.path ?? "ffprobe");
