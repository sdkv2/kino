import { describe, it, expect } from "vitest";
import { groupWordsIntoSegments } from "../src/render/transcript.js";

const W = (word: string, start: number, end: number) => ({ word, start, end });

describe("groupWordsIntoSegments", () => {
  it("returns [] for no words", () => {
    expect(groupWordsIntoSegments([])).toEqual([]);
  });
  it("splits on sentence-ending punctuation", () => {
    const segs = groupWordsIntoSegments([W("Hi", 0, 0.3), W("there.", 0.3, 0.7), W("Bye", 0.8, 1.1)]);
    expect(segs.map((s) => s.text)).toEqual(["Hi there.", "Bye"]);
    expect(segs[0]).toMatchObject({ start: 0, end: 0.7 });
  });
  it("splits on a pause gap larger than maxGapSec", () => {
    const segs = groupWordsIntoSegments([W("a", 0, 0.3), W("b", 2.0, 2.3)], { maxGapSec: 0.6 });
    expect(segs.map((s) => s.text)).toEqual(["a", "b"]);
  });
  it("keeps a single segment when no break occurs", () => {
    const segs = groupWordsIntoSegments([W("one", 0, 0.3), W("two", 0.3, 0.6)]);
    expect(segs).toHaveLength(1);
    expect(segs[0].words).toHaveLength(2);
  });
});
