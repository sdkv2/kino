// Node-testable seam for the video-mask texture channel. The actual <video> seek + canvas draw +
// GL upload run only in the render page (headless Chrome); this locks the pure per-frame logic that
// drives them: source-time = frame/fps (deterministic), and a revision that bumps every frame so
// ShaderBackground's revision-diff path re-uploads this frame's mask pixels to uTexN.
import { describe, it, expect } from "vitest";
import { videoTexStep } from "../src/render/native/page/bgTextures.js";

describe("video mask texture seam", () => {
  it("maps composition frame → source seek time (frame/fps)", () => {
    expect(videoTexStep(0, 30, 0).time).toBe(0);
    expect(videoTexStep(30, 30, 0).time).toBe(1);
    expect(videoTexStep(45, 30, 0).time).toBe(1.5);
  });
  it("bumps revision every composition frame", () => {
    let rev = 0;
    for (let frame = 0; frame < 5; frame++) rev = videoTexStep(frame, 30, rev).revision;
    expect(rev).toBe(5);
  });
  it("guards fps<=0 (no divide-by-zero)", () => {
    expect(videoTexStep(10, 0, 3).time).toBe(0);
    expect(videoTexStep(10, 0, 3).revision).toBe(4);
  });
});
