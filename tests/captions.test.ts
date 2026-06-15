import { describe, it, expect } from "vitest";
import { charsToWords, activeWordIndex, offsetWords } from "../src/render/captions.js";

describe("charsToWords", () => {
  it("aggregates per-character alignment into word timings", () => {
    const chars = ["H", "i", " ", "y", "o", "u"];
    const starts = [0, 0.1, 0.2, 0.3, 0.4, 0.5];
    const ends = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
    expect(charsToWords(chars, starts, ends)).toEqual([
      { word: "Hi", start: 0, end: 0.2 },
      { word: "you", start: 0.3, end: 0.6 },
    ]);
  });
  it("keeps punctuation on the word and handles a trailing word with no space", () => {
    const chars = ["g", "o", "!"];
    const starts = [0, 0.1, 0.2];
    const ends = [0.1, 0.2, 0.3];
    expect(charsToWords(chars, starts, ends)).toEqual([{ word: "go!", start: 0, end: 0.3 }]);
  });
});

describe("activeWordIndex", () => {
  const words = [
    { word: "a", start: 0, end: 0.5 },
    { word: "b", start: 0.6, end: 1.0 },
  ];
  it("returns -1 before the first word starts", () => {
    expect(activeWordIndex(words, -0.1)).toBe(-1);
  });
  it("returns the spoken word during its span", () => {
    expect(activeWordIndex(words, 0.3)).toBe(0);
    expect(activeWordIndex(words, 0.7)).toBe(1);
  });
  it("lingers on the last started word during gaps and after the end", () => {
    expect(activeWordIndex(words, 0.55)).toBe(0);
    expect(activeWordIndex(words, 5)).toBe(1);
  });
});

describe("offsetWords", () => {
  it("shifts word timings onto the main timeline", () => {
    expect(offsetWords([{ word: "x", start: 0, end: 0.5 }], 2)).toEqual([{ word: "x", start: 2, end: 2.5 }]);
  });
});
