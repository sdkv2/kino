import { describe, it, expect } from "vitest";
import { appFreezeFrame, appTrimFrames } from "../src/render/appMedia.js";

describe("appTrimFrames", () => {
  it("only emits trimBefore — clipTo is freeze-held, not a source-frame trimAfter", () => {
    // A source-frame trimAfter cutoff ignores playbackRate; honoring it would drop footage mid-VO.
    expect(appTrimFrames(30, 2, 5)).toEqual({ trimBefore: 60, trimAfter: undefined });
    expect(appTrimFrames(30, undefined, undefined)).toEqual({ trimBefore: 0, trimAfter: undefined });
  });
});

describe("appFreezeFrame", () => {
  it("returns null while playing", () => {
    expect(appFreezeFrame({ localFrame: 10, fps: 30, speed: 1, clipFrom: 0, clipTo: 10 })).toBeNull();
  });

  it("freezes at pauseAt once reached", () => {
    expect(appFreezeFrame({ localFrame: 60, fps: 30, speed: 1, pauseAt: 1.5 })).toBe(45);
    expect(appFreezeFrame({ localFrame: 44, fps: 30, speed: 1, pauseAt: 1.5 })).toBeNull();
  });

  it("holds the last playable frame when the clip window is consumed", () => {
    // 2s window @ 30fps = 60 source frames → at speed 1, endHold = 59
    expect(appFreezeFrame({ localFrame: 59, fps: 30, speed: 1, clipFrom: 0, clipTo: 2 })).toBe(59);
    expect(appFreezeFrame({ localFrame: 100, fps: 30, speed: 1, clipFrom: 0, clipTo: 2 })).toBe(59);
  });

  it("picks the earlier freeze when pause and clip-end both apply", () => {
    // clip ends at frame 29; pauseAt at 2s = frame 60 — past both → min = 29
    expect(appFreezeFrame({ localFrame: 80, fps: 30, speed: 1, clipFrom: 0, clipTo: 1, pauseAt: 2 })).toBe(29);
  });

  it("accounts for slow-mo when computing clip end hold", () => {
    // 1s source @ speed 0.5 → 30 source frames / 0.5 = 60 composition frames → endHold 59
    expect(appFreezeFrame({ localFrame: 59, fps: 30, speed: 0.5, clipFrom: 0, clipTo: 1 })).toBe(59);
    expect(appFreezeFrame({ localFrame: 58, fps: 30, speed: 0.5, clipFrom: 0, clipTo: 1 })).toBeNull();
  });
});
