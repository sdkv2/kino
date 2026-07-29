import type { SegmentTiming } from "../types.js";
import type { AvatarWindow } from "../render/props.js";
import { computeTimings } from "../vo/vo.js";

export interface AvatarPlan {
  /** Original segment indices whose audio makes up the trimmed presenter-only track, in order. */
  avatarIndices: number[];
  /** Where to place the avatar video on the main timeline + which slice of it to play. */
  windows: AvatarWindow[];
}

/**
 * Presenter-trim planner. The provider (HeyGen/Hedra/Replicate) bills per second of generated
 * video, but the presenter is hidden behind video cut-ins for part of the runtime — so we only
 * generate it over the on-camera beats. This returns:
 *   - avatarIndices: the clips to stitch into the trimmed presenter-only audio track
 *   - windows: for each run of consecutive on-camera beats, where it sits on the main
 *     timeline (fromSec/toSec) and the offset to start playback from inside the trimmed clip
 *
 * Invariant: a window's timeline span equals the presenter-clip slice it plays, so lip-sync
 * stays aligned even though the trimmed track skips the cut-ins.
 */
export function planAvatarWindows(
  onCamera: boolean[],
  timings: SegmentTiming[],
  gap: number,
): AvatarPlan {
  const avatarIndices = onCamera.map((on, i) => (on ? i : -1)).filter((i) => i >= 0);
  if (avatarIndices.length === 0) return { avatarIndices: [], windows: [] };

  // Offsets inside the trimmed avatar-only track (avatar clips concatenated with the same gap).
  const avTrack = computeTimings(avatarIndices.map((i) => timings[i].durSec), gap);
  const origIndexToTrackPos = new Map(avatarIndices.map((orig, pos) => [orig, pos]));

  const windows: AvatarWindow[] = [];
  let runStart: number | null = null;
  for (let i = 0; i < onCamera.length; i++) {
    const isAvatar = onCamera[i];
    if (isAvatar && runStart === null) runStart = i;
    const endsRun = isAvatar && !onCamera[i + 1];
    if (endsRun) {
      windows.push({
        fromSec: timings[runStart!].startSec,
        // hold to the next segment's start so the avatar doesn't blink off during the VO gap
        toSec: i + 1 < onCamera.length ? timings[i + 1].startSec : timings[i].endSec,
        audioStartSec: avTrack[origIndexToTrackPos.get(runStart!)!].startSec,
      });
      runStart = null;
    }
  }
  return { avatarIndices, windows };
}
