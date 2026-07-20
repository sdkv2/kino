import { describe, it, expect } from "vitest";
import { charsToWords, activeWordIndex, offsetWords, normWord, isHighlightWord } from "../src/render/captions.js";

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

describe("normWord", () => {
  it("lowercases and strips non-alphanumerics", () => {
    expect(normWord("Acme.")).toBe("acme");
    expect(normWord("“really!”")).toBe("really");
  });
});

describe("isHighlightWord", () => {
  it("highlights the currently-spoken word", () => {
    expect(isHighlightWord("anything", { isActive: true })).toBe(true);
  });
  it("does not highlight inactive ordinary words", () => {
    expect(isHighlightWord("anything", { isActive: false })).toBe(false);
  });
  it("always highlights the brand name (case/punctuation-insensitive), even when inactive", () => {
    expect(isHighlightWord("Acme", { isActive: false, brandName: "Acme" })).toBe(true);
    expect(isHighlightWord("acme.", { isActive: false, brandName: "Acme" })).toBe(true);
  });
  it("leaves non-brand words alone when a brand name is set", () => {
    expect(isHighlightWord("really", { isActive: false, brandName: "Acme" })).toBe(false);
  });
  it("treats an empty/absent brand name as no brand match", () => {
    expect(isHighlightWord("acme", { isActive: false, brandName: "" })).toBe(false);
    expect(isHighlightWord("acme", { isActive: false })).toBe(false);
  });
});
