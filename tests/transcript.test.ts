import { describe, it, expect } from "vitest";
import { groupWordsIntoSegments, buildTranscript, wordsToSrt, wordsToVtt, wordsToText, fmtTimecode } from "../src/render/transcript.js";

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

describe("fmtTimecode", () => {
  it("formats HH:MM:SS with the given millisecond separator", () => {
    expect(fmtTimecode(3661.5, ",")).toBe("01:01:01,500");
    expect(fmtTimecode(3661.5, ".")).toBe("01:01:01.500");
  });
});

describe("buildTranscript", () => {
  it("assembles text, duration, words and segments", () => {
    const words = [W("Hi", 0, 0.3), W("there.", 0.3, 0.7)];
    const t = buildTranscript(words, { durationSec: 0.7, fullText: "Hi there." });
    expect(t).toMatchObject({ text: "Hi there.", durationSec: 0.7 });
    expect(t.segments).toHaveLength(1);
    expect(t.words).toHaveLength(2);
  });
  it("falls back to joined words when no fullText is given", () => {
    expect(buildTranscript([W("a", 0, 1)], { durationSec: 1 }).text).toBe("a");
  });
});

describe("subtitle formatters", () => {
  const segs = groupWordsIntoSegments([W("Hi", 0, 0.5), W("there.", 0.5, 1.0)]);
  it("wordsToSrt numbers cues with comma millis", () => {
    expect(wordsToSrt(segs)).toBe("1\n00:00:00,000 --> 00:00:01,000\nHi there.\n");
  });
  it("wordsToVtt starts with WEBVTT and uses dot millis", () => {
    expect(wordsToVtt(segs)).toBe("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi there.\n");
  });
  it("wordsToText joins segment text by newline", () => {
    expect(wordsToText(segs)).toBe("Hi there.\n");
  });
});
