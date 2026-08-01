import { describe, it, expect } from "vitest";
import { parseSpec } from "../src/spec/schema.js";
import {
  hasPerSegmentVoiceVariation,
  resolveSegmentVoice,
  resolveSegmentVoiceModel,
  assertSegmentVoices,
} from "../src/spec/validate.js";
import { DEFAULT_BRAND } from "../src/config/brand.js";
import { buildVO } from "../src/vo/vo.js";
import { Cache } from "../src/media/cache.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const brand = {
  ...DEFAULT_BRAND,
  defaultVoice: "narrator",
  voiceAliases: { narrator: "voice-narrator", guest: "voice-guest" },
};

describe("per-segment voice", () => {
  it("parses segment voice and voiceModel", () => {
    const spec = parseSpec({
      title: "duo",
      voice: "narrator",
      segments: [
        { text: "Host line." },
        { text: "Guest line.", voice: "guest", voiceModel: "eleven_multilingual_v2" },
      ],
    });
    expect(spec.segments[1].voice).toBe("guest");
    expect(spec.segments[1].voiceModel).toBe("eleven_multilingual_v2");
  });

  it("resolves segment override before spec default", () => {
    const spec = parseSpec({
      title: "duo",
      voice: "narrator",
      segments: [{ text: "A" }, { text: "B", voice: "guest" }],
    });
    expect(resolveSegmentVoice(spec, brand, 0)).toBe("voice-narrator");
    expect(resolveSegmentVoice(spec, brand, 1)).toBe("voice-guest");
  });

  it("detects voice variation across beats", () => {
    const spec = parseSpec({
      title: "duo",
      voice: "narrator",
      segments: [{ text: "A" }, { text: "B", voice: "guest" }],
    });
    expect(hasPerSegmentVoiceVariation(spec, brand)).toBe(true);
  });

  it("assertSegmentVoices fails when a TTS beat has no voice", () => {
    const spec = parseSpec({ title: "mute", segments: [{ text: "Hello" }] });
    expect(() => assertSegmentVoices(spec, DEFAULT_BRAND)).toThrow(/segment\[0\]: no voice/);
  });

  it("builds mock VO with different voices per beat", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-seg-voice-"));
    const cache = new Cache(dir);
    try {
      const spec = parseSpec({
        title: "duo",
        voice: "narrator",
        segments: [{ text: "Host." }, { text: "Guest.", voice: "guest" }],
      });
      const vo = await buildVO({ spec, brand, cache, vo: "mock" });
      expect(vo.words).toHaveLength(2);
      expect(vo.words[0].map((w) => w.word).join(" ")).toBe("Host.");
      expect(vo.words[1].map((w) => w.word).join(" ")).toBe("Guest.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolveSegmentVoiceModel picks beat override", () => {
    const spec = parseSpec({
      title: "m",
      voiceModel: "eleven_v3",
      segments: [{ text: "A" }, { text: "B", voiceModel: "eleven_multilingual_v2" }],
    });
    expect(resolveSegmentVoiceModel(spec, brand, 0)).toBe("eleven_v3");
    expect(resolveSegmentVoiceModel(spec, brand, 1)).toBe("eleven_multilingual_v2");
    expect(hasPerSegmentVoiceVariation(spec, brand)).toBe(true);
  });
});
