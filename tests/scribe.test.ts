import { describe, it, expect } from "vitest";
import { scribeToWords } from "../src/vo/scribe.js";

describe("scribeToWords", () => {
  it("keeps only word tokens and maps text/start/end", () => {
    const raw = {
      text: "hi there",
      words: [
        { text: "hi", start: 0.0, end: 0.4, type: "word" },
        { text: " ", start: 0.4, end: 0.5, type: "spacing" },
        { text: "there", start: 0.5, end: 0.9, type: "word" },
      ],
    };
    expect(scribeToWords(raw)).toEqual([
      { word: "hi", start: 0.0, end: 0.4 },
      { word: "there", start: 0.5, end: 0.9 },
    ]);
  });
  it("treats a missing type as a word and tolerates no words array", () => {
    expect(scribeToWords({ words: [{ text: "x", start: 0, end: 1 }] })).toEqual([{ word: "x", start: 0, end: 1 }]);
    expect(scribeToWords({ words: undefined as unknown as [] })).toEqual([]);
  });
});
