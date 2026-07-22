import { describe, it, expect } from "vitest";
import { mockWordsForDuration } from "../src/vo/vo.js";
import { parseSpec } from "../src/spec/schema.js";

describe("mockWordsForDuration", () => {
  it("paces the spec text evenly across the real file duration", () => {
    const w = mockWordsForDuration("one two three four", 2);
    expect(w).toHaveLength(4);
    expect(w[0]).toEqual({ word: "one", start: 0, end: 0.5 });
    expect(w[3].end).toBeCloseTo(2);
  });
});

describe("spec voFile", () => {
  const base = { brand: "acme", title: "t", segments: [] as unknown[] };
  it("accepts voFile on every segment kind", () => {
    expect(() =>
      parseSpec({
        ...base,
        segments: [
          { kind: "avatar", text: "hi", voFile: "vo/a.mp3" },
          { kind: "app", asset: "s.png", text: "hi", voFile: "vo/b.wav" },
          { kind: "motion", source: "motion/x.html", text: "hi", voFile: "vo/c.m4a" },
        ],
      }),
    ).not.toThrow();
  });
});
