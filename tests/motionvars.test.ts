import { describe, it, expect } from "vitest";
import { buildMotionVars, wordsShownAt, beatRelativeWords, resolveWordAnchors } from "../src/render/motionVars.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#ffffff", captionFontSize: 74, captionStroke: 9 };
const dyn = { frame: 12, t: 0.4, progress: 0.5, pulse: 0.25, params: {} as Record<string, number | string> };

describe("buildMotionVars", () => {
  it("injects the full brand palette including gold (the bug: gold was missing)", () => {
    const v = buildMotionVars(theme, dyn);
    expect(v["--kino-mint"]).toBe("#80e2b4");
    expect(v["--kino-green"]).toBe("#0c8d64");
    expect(v["--kino-night"]).toBe("#0b1020");
    expect(v["--kino-white"]).toBe("#ffffff");
    expect(v["--kino-gold"]).toBe("#d99a20");
    expect(v["--kino-font"]).toBe("Arial");
  });
  it("sets the frame-driven vars including eased progress curves", () => {
    const v = buildMotionVars(theme, dyn);
    expect(v["--frame"]).toBe("12");
    expect(v["--t"]).toBe("0.4000");
    expect(v["--progress"]).toBe("0.5000");
    expect(v["--pulse"]).toBe("0.2500");
    expect(Number(v["--kino-out"])).toBeGreaterThan(0.5);
    expect(Number(v["--kino-edge"])).toBeCloseTo(1, 3); // sin(π/2) at progress 0.5
    expect(v["--kino-inout"]).toBeDefined();
    expect(v["--kino-overshoot"]).toBeDefined();
    expect(v["--kino-spring"]).toBeDefined();
  });
  it("maps each resolved param to a --<key> var, stringified", () => {
    const v = buildMotionVars(theme, { ...dyn, params: { pct: 86, label: "hi" } });
    expect(v["--pct"]).toBe("86");
    expect(v["--label"]).toBe("hi");
  });
  it("exposes the caption band bottom so authors can keep text clear of the caption", () => {
    expect(buildMotionVars(theme, { ...dyn, captionBottom: 470 })["--kino-caption-bottom"]).toBe("470px");
  });
  it("reports a zero caption band when the beat has no caption", () => {
    expect(buildMotionVars(theme, dyn)["--kino-caption-bottom"]).toBe("0px");
    expect(buildMotionVars(theme, { ...dyn, captionBottom: 0 })["--kino-caption-bottom"]).toBe("0px");
  });
  it("exposes the beat's spoken-word count and how many have started, for typed-in-sync graphics", () => {
    const v = buildMotionVars(theme, { ...dyn, wordsShown: 3, wordCount: 8 });
    expect(v["--kino-words-shown"]).toBe("3");
    expect(v["--kino-word-count"]).toBe("8");
  });
  it("defaults the word vars to 0 when the beat carries no word timings", () => {
    const v = buildMotionVars(theme, dyn);
    expect(v["--kino-words-shown"]).toBe("0");
    expect(v["--kino-word-count"]).toBe("0");
  });
});

describe("wordsShownAt", () => {
  const words = [
    { word: "Kino", start: 0, end: 0.3 },
    { word: "make", start: 0.4, end: 0.7 },
    { word: "me", start: 0.8, end: 1.0 },
  ];
  it("ramps continuously through each word's span (no integer step-lag on gated reveals)", () => {
    expect(wordsShownAt(words, -0.1)).toBe(0); // before the first word
    expect(wordsShownAt(words, 0.15)).toBeCloseTo(0.5); // mid-span of word 0
    expect(wordsShownAt(words, 0.3)).toBeCloseTo(1); // word 0 fully spoken
    expect(wordsShownAt(words, 0.35)).toBeCloseTo(1); // inter-word gap holds the count
    expect(wordsShownAt(words, 0.55)).toBeCloseTo(1.5); // mid-span of word 1
    expect(wordsShownAt(words, 5)).toBe(3); // past the end → all shown
  });
  it("treats a zero-length word span as fully shown at its start", () => {
    expect(wordsShownAt([{ word: "x", start: 1, end: 1 }], 1)).toBe(1);
    expect(wordsShownAt([{ word: "x", start: 1, end: 1 }], 0.9)).toBe(0);
  });
  it("returns 0 for an empty or missing word list", () => {
    expect(wordsShownAt([], 1)).toBe(0);
    expect(wordsShownAt(undefined, 1)).toBe(0);
  });
});

describe("resolveWordAnchors", () => {
  const words = [
    { word: "Scan.", start: 0, end: 0.3 },
    { word: "Match.", start: 0.4, end: 0.7 },
    { word: "Rewrite.", start: 0.8, end: 1.1 },
  ];
  it("resolves atWord text to the word's beat-relative start (case/punctuation-insensitive)", () => {
    const r = resolveWordAnchors([{ atWord: "match", action: "pulse" }], words, "segment[3].triggers");
    expect(r).toEqual([{ at: 0.4, action: "pulse" }]);
  });
  it("resolves a numeric atWord as a word index", () => {
    const r = resolveWordAnchors([{ atWord: 2, params: { pct: 86 } }], words, "x");
    expect(r?.[0].at).toBeCloseTo(0.8);
  });
  it("passes plain at entries through untouched", () => {
    expect(resolveWordAnchors([{ at: 1.5, action: "pulse" }], words, "x")).toEqual([{ at: 1.5, action: "pulse" }]);
  });
  it("throws naming the beat's words when atWord text is not spoken there", () => {
    expect(() => resolveWordAnchors([{ atWord: "nope", action: "pulse" }], words, "segment[3].triggers")).toThrow(
      /nope[\s\S]*Scan/,
    );
  });
  it("throws when a numeric atWord is out of range", () => {
    expect(() => resolveWordAnchors([{ atWord: 9, action: "pulse" }], words, "x")).toThrow(/9/);
  });
  it("throws when atWord is used on a beat with no spoken words", () => {
    expect(() => resolveWordAnchors([{ atWord: "hi", action: "pulse" }], undefined, "x")).toThrow(/no spoken words/i);
  });
  it("returns undefined for an undefined track", () => {
    expect(resolveWordAnchors(undefined, words, "x")).toBeUndefined();
  });
});

describe("beatRelativeWords", () => {
  it("rebases absolute VO word times to the beat start (env.t is beat-relative)", () => {
    const abs = [
      { word: "one", start: 6.0, end: 6.3 },
      { word: "two", start: 6.5, end: 6.9 },
    ];
    const rel = beatRelativeWords(abs, 6.0)!;
    expect(rel.map((w) => w.word)).toEqual(["one", "two"]);
    expect(rel[0].start).toBeCloseTo(0);
    expect(rel[0].end).toBeCloseTo(0.3);
    expect(rel[1].start).toBeCloseTo(0.5);
    expect(rel[1].end).toBeCloseTo(0.9);
  });
  it("returns undefined when there are no words (so the prop stays absent)", () => {
    expect(beatRelativeWords(undefined, 3)).toBeUndefined();
    expect(beatRelativeWords([], 3)).toBeUndefined();
  });
});
