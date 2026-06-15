import type { SegmentTiming } from "../types.js";
import type { AvatarWindow } from "../render/props.js";
import { computeTimings } from "../vo/vo.js";

export interface AvatarPlan {
  /** Original segment indices whose audio makes up the trimmed avatar-only track, in order. */
  avatarIndices: number[];
  /** Where to place the avatar video on the main timeline + which slice of it to play. */
  windows: AvatarWindow[];
}

/**
 * Avatar-trim planner. The avatar provider (HeyGen/Hedra/Replicate) bills per second of
 * generated video, but the avatar is hidden behind app cut-ins for part of the runtime —
 * so we only ever generate it over the on-camera ("avatar") segments. This returns:
 *   - avatarIndices: the clips to stitch into the trimmed avatar-only audio track
 *   - windows: for each run of consecutive avatar segments, where it sits on the main
 *     timeline (fromSec/toSec) and the offset to start playback from inside the trimmed clip
 *
 * Invariant: a window's timeline span equals the avatar-clip slice it plays, so lip-sync
 * stays aligned even though the trimmed track skips the app sections.
 */
export function planAvatarWindows(
  kinds: string[],
  timings: SegmentTiming[],
  gap: number,
): AvatarPlan {
  const avatarIndices = kinds.map((k, i) => (k === "avatar" ? i : -1)).filter((i) => i >= 0);
  if (avatarIndices.length === 0) return { avatarIndices: [], windows: [] };

  // Offsets inside the trimmed avatar-only track (avatar clips concatenated with the same gap).
  const avTrack = computeTimings(avatarIndices.map((i) => timings[i].durSec), gap);
  const posOf = new Map(avatarIndices.map((orig, pos) => [orig, pos]));

  const windows: AvatarWindow[] = [];
  let runStart: number | null = null;
  for (let i = 0; i < kinds.length; i++) {
    const isAvatar = kinds[i] === "avatar";
    if (isAvatar && runStart === null) runStart = i;
    const endsRun = isAvatar && kinds[i + 1] !== "avatar";
    if (endsRun) {
      windows.push({
        fromSec: timings[runStart!].startSec,
        // hold to the next segment's start so the avatar/logo doesn't blink off during the VO gap
        toSec: i + 1 < kinds.length ? timings[i + 1].startSec : timings[i].endSec,
        audioStartSec: avTrack[posOf.get(runStart!)!].startSec,
      });
      runStart = null;
    }
  }
  return { avatarIndices, windows };
}
