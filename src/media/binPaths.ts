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

/** Does this `-filters` listing carry `zscale`? Pure for the same reason `preferSystem` is. */
export function hasZscale(filtersListing: string): boolean {
  // Filter rows look like " ... zscale            V->V       Apply resizing, ..."
  return /(^|\s)zscale(\s|$)/m.test(filtersListing);
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

/** Version is necessary but not sufficient: a system ffmpeg also has to carry the filters we
 *  actually invoke. Homebrew's ffmpeg 8 is built without libzimg, so it has no `zscale` — and
 *  `zscale` is how the frame extractor tonemaps HDR/HLG sources, which is every iPhone capture
 *  and most modern stock footage. Missing it doesn't error the render: the extract dies, the
 *  beat's texture stays empty, and video beats come out silently black. So a system binary has
 *  to prove it can tonemap before it outranks the bundled build. */
function usableFfmpeg(): boolean {
  if (!usableOnPath("ffmpeg")) return false;
  try {
    const filters = execSync("ffmpeg -hide_banner -filters", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return hasZscale(filters);
  } catch {
    return false;
  }
}

export const FFMPEG_PATH = usableFfmpeg() ? "ffmpeg" : (ffmpegStatic ?? "ffmpeg");
export const FFPROBE_PATH = usableOnPath("ffprobe") ? "ffprobe" : (ffprobeStatic.path ?? "ffprobe");
