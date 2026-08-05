import { describe, it, expect } from "vitest";
import { retuneTriggers, retuneScatteredTriggers } from "../src/commands/retune.js";

describe("retuneTriggers", () => {
  const words = [
    { word: "One", start: 0, end: 0.2 },
    { word: "command", start: 0.3, end: 0.6 },
    { word: "Voiceover,", start: 1.5, end: 2.0 },
    { word: "motion,", start: 2.4, end: 2.8 },
    { word: "render,", start: 3.2, end: 3.6 },
    { word: "mp4.", start: 4.0, end: 4.4 },
  ];

  it("maps N triggers onto the last N word starts (pipeline preamble)", () => {
    const triggers = [
      { at: 1.6, action: "pulse" },
      { at: 2.4, action: "pulse" },
      { at: 3.2, action: "pulse" },
      { at: 4.0, action: "pulse" },
    ];
    const { next, changes } = retuneTriggers(words, triggers);
    expect(next.map((t) => t.at)).toEqual([1.5, 2.4, 3.2, 4.0]);
    expect(changes).toContain("[0].at: 1.6 → 1.5");
  });

  it("leaves triggers unchanged when already aligned", () => {
    const triggers = [
      { at: 1.5, action: "pulse" },
      { at: 2.4, action: "pulse" },
      { at: 3.2, action: "pulse" },
      { at: 4.0, action: "pulse" },
    ];
    const { changes } = retuneTriggers(words, triggers);
    expect(changes).toEqual([]);
  });

  it("skips when there are fewer words than triggers", () => {
    const { next, changes } = retuneTriggers(words.slice(0, 2), [
      { at: 1, action: "pulse" },
      { at: 2, action: "pulse" },
      { at: 3, action: "pulse" },
    ]);
    expect(next[0].at).toBe(1);
    expect(changes[0]).toMatch(/need 3 words/);
  });

  it("uses first N content words when triggers cluster early (trailing filler)", () => {
    const digest = [
      { word: "Themes.", start: 0.1, end: 0.4 },
      { word: "Decisions.", start: 0.8, end: 1.2 },
      { word: "The", start: 1.5, end: 1.6 },
      { word: "loose", start: 1.7, end: 2.0 },
      { word: "ends", start: 2.1, end: 2.3 },
      { word: "you", start: 2.4, end: 2.5 },
      { word: "forgot.", start: 2.6, end: 3.0 },
    ];
    const triggers = [
      { at: 0.3, action: "pulse" },
      { at: 1.15, action: "pulse" },
      { at: 2.05, action: "pulse" },
    ];
    const { next } = retuneTriggers(digest, triggers);
    expect(next.map((t) => t.at)).toEqual([0.1, 0.8, 1.7]); // Themes, Decisions, loose
  });

  it("uses all content words in order when count matches N", () => {
    const exact = [
      { word: "Themes.", start: 0.1, end: 0.4 },
      { word: "Decisions.", start: 0.8, end: 1.2 },
      { word: "Ends.", start: 1.5, end: 1.9 },
    ];
    const triggers = [
      { at: 2.1, action: "pulse" },
      { at: 2.4, action: "pulse" },
      { at: 2.6, action: "pulse" },
    ];
    const { next } = retuneTriggers(exact, triggers);
    expect(next.map((t) => t.at)).toEqual([0.1, 0.8, 1.5]);
  });
});

describe("retuneScatteredTriggers", () => {
  // A ~20s script with backgroundTriggers meant to punctuate four DIFFERENT scattered
  // moments (an opening claim, a mid-script number, a late claim, a closing word) — not a
  // short sequential block. Regression case for the bug retuneTriggers has here: its
  // first-N/last-N block heuristic collapses all four triggers onto one end of the whole
  // script (confirmed against two independent kino dogfood sessions, both hit this exact
  // shape — see kino-dogfood-batch1-findings memory / round 2 vo-retune report).
  const words = [
    { word: "We", start: 0, end: 0.2 },
    { word: "help", start: 0.3, end: 0.6 },
    { word: "you", start: 0.7, end: 0.9 },
    { word: "get", start: 1.0, end: 1.2 },
    { word: "paid.", start: 1.3, end: 1.6 },
    { word: "Send", start: 3.0, end: 3.3 },
    { word: "an", start: 3.4, end: 3.5 },
    { word: "invoice,", start: 3.6, end: 4.0 },
    { word: "get", start: 6.9, end: 7.1 },
    { word: "paid", start: 7.2, end: 7.5 },
    { word: "twice", start: 7.6, end: 7.9 },
    { word: "as", start: 8.0, end: 8.1 },
    { word: "fast.", start: 8.2, end: 8.5 },
    { word: "Collect", start: 14.8, end: 15.2 },
    { word: "one", start: 15.3, end: 15.6 },
    { word: "thousand", start: 15.7, end: 16.1 },
    { word: "two", start: 16.2, end: 16.4 },
    { word: "hundred", start: 16.5, end: 16.9 },
    { word: "forty.", start: 17.0, end: 17.5 },
    { word: "We", start: 18.5, end: 18.7 },
    { word: "handle", start: 18.8, end: 19.1 },
    { word: "the", start: 19.2, end: 19.3 },
    { word: "rest.", start: 19.4, end: 19.8 },
  ];

  it("snaps each trigger to its own nearest word instead of collapsing onto one end", () => {
    const triggers = [
      { at: 2.8, action: "pulse" }, // meant for "Send" @3.0
      { at: 6.7, action: "pulse" }, // meant for "get" (2nd) @6.9
      { at: 14.6, action: "pulse" }, // meant for "Collect" @14.8
      { at: 19.3, action: "pulse" }, // meant for "rest." @19.4
    ];
    const { next } = retuneScatteredTriggers(words, triggers);
    expect(next.map((t) => t.at)).toEqual([3.0, 6.9, 14.8, 19.4]);
    // The old block heuristic (retuneTriggers) gets this wrong — proves the regression is real.
    const oldResult = retuneTriggers(words, triggers);
    expect(oldResult.next.map((t) => t.at)).not.toEqual([3.0, 6.9, 14.8, 19.4]);
  });

  it("still returns triggers unchanged when already aligned", () => {
    const triggers = [
      { at: 3.0, action: "pulse" },
      { at: 6.9, action: "pulse" },
      { at: 14.8, action: "pulse" },
      { at: 19.4, action: "pulse" },
    ];
    const { changes } = retuneScatteredTriggers(words, triggers);
    expect(changes).toEqual([]);
  });

  it("skips when there are fewer words than triggers", () => {
    const { next, changes } = retuneScatteredTriggers(words.slice(0, 2), [
      { at: 1, action: "pulse" },
      { at: 2, action: "pulse" },
      { at: 3, action: "pulse" },
    ]);
    expect(next[0].at).toBe(1);
    expect(changes[0]).toMatch(/need 3 words/);
  });
});
