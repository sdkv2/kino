import { describe, it, expect } from "vitest";
import { whisperJsonToWords, pickSttEngine } from "../src/vo/whisper.js";

describe("whisperJsonToWords", () => {
  const raw = {
    transcription: [
      { offsets: { from: 0, to: 380 }, text: " Your" },
      { offsets: { from: 380, to: 760 }, text: " resume" },
      { offsets: { from: 800, to: 1200 }, text: " survives." },
      { offsets: { from: 1200, to: 1200 }, text: "  " },
    ],
  };
  it("maps whisper.cpp -ml 1 JSON offsets (ms) to trimmed WordTimings (s)", () => {
    expect(whisperJsonToWords(raw)).toEqual([
      { word: "Your", start: 0, end: 0.38 },
      { word: "resume", start: 0.38, end: 0.76 },
      { word: "survives.", start: 0.8, end: 1.2 },
    ]);
  });
  it("returns empty for missing transcription", () => {
    expect(whisperJsonToWords({})).toEqual([]);
  });
});

describe("pickSttEngine", () => {
  it("prefers scribe when an ElevenLabs key is present", () => {
    expect(pickSttEngine({ hasKey: true, hasWhisper: true })).toBe("scribe");
  });
  it("falls back to whisper without a key", () => {
    expect(pickSttEngine({ hasKey: false, hasWhisper: true })).toBe("whisper");
  });
  it("honours the KINO_STT override in both directions", () => {
    expect(pickSttEngine({ hasKey: true, hasWhisper: true, override: "whisper" })).toBe("whisper");
    expect(pickSttEngine({ hasKey: false, hasWhisper: true, override: "scribe" })).toBe("scribe");
  });
  it("throws with install guidance when neither engine is available", () => {
    expect(() => pickSttEngine({ hasKey: false, hasWhisper: false })).toThrow(/whisper|ELEVENLABS/);
  });
});
