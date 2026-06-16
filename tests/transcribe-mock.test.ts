import { describe, it, expect } from "vitest";
import { transcribe } from "../src/commands/transcribe.js";

describe("transcribe --mock", () => {
  it("returns a well-formed transcript offline (no ffmpeg/network)", async () => {
    const t = await transcribe("does-not-exist.mp4", { mock: true });
    expect(t.words.length).toBeGreaterThan(0);
    expect(t.segments.length).toBe(2); // mock text has two sentences
    expect(t.text).toContain("mock");
    // monotonic word times
    for (let i = 1; i < t.words.length; i++) expect(t.words[i].start).toBeGreaterThanOrEqual(t.words[i - 1].start);
  });
});
