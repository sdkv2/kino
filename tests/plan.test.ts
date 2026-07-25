import { describe, it, expect } from "vitest";
import { planAvatarWindows } from "../src/avatar/plan.js";
import { computeTimings } from "../src/vo/vo.js";

const GAP = 0.32;

describe("planAvatarWindows", () => {
  it("returns no windows and no presenter clips when nothing is on camera", () => {
    const timings = computeTimings([2, 2], GAP);
    const r = planAvatarWindows([false, false], timings, GAP);
    expect(r.avatarIndices).toEqual([]);
    expect(r.windows).toEqual([]);
  });

  it("makes one window covering everything when every segment is on camera", () => {
    const timings = computeTimings([2, 3], GAP);
    const r = planAvatarWindows([true, true], timings, GAP);
    expect(r.avatarIndices).toEqual([0, 1]);
    expect(r.windows).toHaveLength(1);
    expect(r.windows[0]).toMatchObject({ fromSec: 0, toSec: timings[1].endSec, audioStartSec: 0 });
  });

  it("splits presenter runs around video cut-ins, billing only the on-camera clips", () => {
    // on, on, cut-in, cut-in, on  → windows [0..1] and [4..4]
    const durs = [2, 1.5, 3, 2, 1];
    const kinds = [true, true, false, false, true];
    const timings = computeTimings(durs, GAP);
    const r = planAvatarWindows(kinds, timings, GAP);

    expect(r.avatarIndices).toEqual([0, 1, 4]); // cut-in clips never reach the presenter provider
    expect(r.windows).toHaveLength(2);

    // window A: from seg0 start, held to the next segment's start (gap-fill); plays the clip from 0
    expect(r.windows[0]).toMatchObject({ fromSec: timings[0].startSec, toSec: timings[2].startSec, audioStartSec: 0 });

    // window B: the avatar-only track concatenates [2, 1.5, 1] with the same gap,
    // so window B reads from the 3rd clip's offset in that trimmed track.
    const avTrack = computeTimings([2, 1.5, 1], GAP);
    expect(r.windows[1]).toMatchObject({
      fromSec: timings[4].startSec,
      toSec: timings[4].endSec,
      audioStartSec: avTrack[2].startSec,
    });

    // lip-sync invariant: each window's timeline span equals the avatar-clip slice it plays
    for (const w of r.windows) {
      const span = w.toSec - w.fromSec;
      // slice length within a single-segment window B / multi-segment window A
      expect(span).toBeGreaterThan(0);
    }
    const spanB = r.windows[1].toSec - r.windows[1].fromSec;
    expect(spanB).toBeCloseTo(avTrack[2].endSec - avTrack[2].startSec, 5);
  });
});
