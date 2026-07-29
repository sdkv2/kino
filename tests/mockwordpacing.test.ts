import { describe, it, expect } from "vitest";
import { mockWordPacing, MOCK_WORD_SEC } from "../src/vo/elevenlabs.js";

describe("mockWordPacing", () => {
  it("paces at the natural rate with no forced duration", () => {
    const { total, per } = mockWordPacing(5);
    expect(per).toBe(MOCK_WORD_SEC);
    expect(total).toBeCloseTo(5 * MOCK_WORD_SEC, 5);
  });

  it("keeps the natural rate when dur forces a LONGER beat — the rest is hold", () => {
    // The clip-23 case: "Top 3 stocks to invest" (5 words) in a 3.633s beat. Spreading the words
    // across dur typed at 0.727s/word, so the phrase only finished as the beat ended and a collapse
    // keyframe at 2.5s cut it off mid-word.
    const { total, per } = mockWordPacing(5, 3.633);
    expect(total).toBe(3.633); // beat length still honoured
    expect(per).toBe(MOCK_WORD_SEC); // ...but the words are not stretched to fill it
    const lastWordEnds = 5 * per;
    expect(lastWordEnds).toBeCloseTo(1.9, 5);
    expect(lastWordEnds).toBeLessThan(2.5); // finishes before the collapse, as the reference does
  });

  it("compresses below the natural rate only when the forced beat is too short", () => {
    const { total, per } = mockWordPacing(10, 1.0);
    expect(total).toBe(1.0);
    expect(per).toBe(0.1); // 10 words cannot occupy 3.8s inside a 1s beat
    expect(10 * per).toBeCloseTo(1.0, 5); // still ends within the beat
  });

  it("never schedules a word past the end of a forced beat", () => {
    for (const [n, dur] of [[1, 0.2], [5, 3.633], [10, 1], [3, 5]] as const) {
      const { total, per } = mockWordPacing(n, dur);
      expect(n * per).toBeLessThanOrEqual(total + 1e-9);
    }
  });

  it("handles an empty text and a zero/negative dur", () => {
    expect(mockWordPacing(0)).toEqual({ total: 0.8, per: 0 });
    // dur <= 0 is not a forced beat — fall back to the word estimate.
    expect(mockWordPacing(4, 0).per).toBe(MOCK_WORD_SEC);
    expect(mockWordPacing(4, -1).per).toBe(MOCK_WORD_SEC);
  });

  it("floors a short no-dur clip at 0.8s", () => {
    expect(mockWordPacing(1).total).toBe(0.8);
  });
});
