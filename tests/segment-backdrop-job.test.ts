// The cutout backdrop must get its OWN /vframes job, on its OWN clock. The beat's
// clipFrom/speed/pauseAt describe the beat's source and mean nothing on an unrelated clip — seeking
// a different file to the same second is arbitrary rather than useful — so the backdrop plays from
// its own frame 0 at the beat's start, one backdrop frame per composition frame. This pins that
// rule (the timing contract) and
// that an image backdrop is not extracted at all.
import { describe, it, expect } from "vitest";
import { planMediaJobs } from "../src/render/native/videoFrames.js";
import type { KinoProps } from "../src/render/props.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0 };
const bg = { kind: "custom" as const, image: null, shaderCode: null, customCode: "", params: {}, keyframes: [], triggers: [] };

// clipFrom/speed are set to values a shared clock would visibly leak: 5s in at 2x.
const propsWith = (backdrop: string): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "",
  segments: [{
    kind: "video", source: "asset.png", caption: "", startSec: 1, endSec: 3,
    clipFrom: 5, speed: 2,
    regionShader: {
      masks: [{ maskSrc: "mask.png", maskKind: "image" as const, channel: "gray" as const }],
      subjectCode: null, backgroundCode: null, backdrop,
    },
  }],
});

describe("backdrop media job", () => {
  it("registers rsbd<i> on its own clock, ignoring the beat's clipFrom/speed", () => {
    const job = planMediaJobs(propsWith("beach.mp4"), 30).find((j) => j.key === "rsbd0");
    expect(job).toBeDefined();
    expect(job!.assetRel).toBe("beach.mp4");
    expect(job!.fromFrame).toBe(30); // the beat starts at 1s
    expect(job!.seqDurFrames).toBe(60); // 2s beat
    expect(job!.startSec).toBe(0); // NOT the beat's clipFrom of 5s
    expect(job!.stepSec).toBeCloseTo(1 / 30, 9); // NOT the beat's speed of 2
    expect(job!.effFrame(17)).toBe(17);
    expect(job!.maxEffFrame).toBe(59);
  });

  it("does not extract an image backdrop", () => {
    expect(planMediaJobs(propsWith("beach.png"), 30).find((j) => j.key === "rsbd0")).toBeUndefined();
  });

  it("registers nothing when there is no backdrop", () => {
    const p = propsWith("beach.mp4");
    delete p.segments[0].regionShader!.backdrop;
    expect(planMediaJobs(p, 30).some((j) => j.key.startsWith("rsbd"))).toBe(false);
  });
});
