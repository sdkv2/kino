import { describe, it, expect } from "vitest";
import { SpecSchema } from "../src/spec/schema.js";

const base = {
  title: "t",
  segments: [{ kind: "motion", source: "motion/x.html", dur: 1.5 }],
};

describe("music.startSec", () => {
  it("defaults to 0", () => {
    const spec = SpecSchema.parse({ ...base, music: { src: "music/bed.mp3" } });
    expect(spec.music?.startSec).toBe(0);
  });

  it("accepts a positive offset into the source file", () => {
    const spec = SpecSchema.parse({ ...base, music: { src: "music/bed.mp3", startSec: 30.47 } });
    expect(spec.music?.startSec).toBe(30.47);
  });

  it("rejects a negative offset", () => {
    expect(() => SpecSchema.parse({ ...base, music: { src: "music/bed.mp3", startSec: -1 } })).toThrow();
  });
});
