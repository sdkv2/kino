import { describe, it, expect } from "vitest";
import { retuneTriggers } from "../src/commands/retune.js";

describe("retuneTriggers", () => {
  const words = [
    { word: "One", start: 0, end: 0.2 },
    { word: "command", start: 0.3, end: 0.6 },
    { word: "Voiceover,", start: 1.5, end: 2.0 },
    { word: "motion,", start: 2.4, end: 2.8 },
    { word: "render,", start: 3.2, end: 3.6 },
    { word: "mp4.", start: 4.0, end: 4.4 },
  ];

  it("maps N triggers onto the last N word starts", () => {
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
});
