// `vo: "cached"` is what `--real` resolves to, and its whole contract is: read voiceover a
// previous `--tts` build paid for, and NEVER buy any. These tests run with an empty cache and no
// API key — if cache-only mode ever fell through to ElevenLabs, it would reach the network here
// instead of throwing, so a regression fails loudly rather than quietly billing someone.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildVO } from "../src/vo/vo.js";
import { Cache } from "../src/media/cache.js";
import type { Spec } from "../src/spec/schema.js";

const specOf = (...texts: string[]) =>
  ({ title: "cached-test", segments: texts.map((text) => ({ text })) }) as unknown as Spec;

let dir: string;
let cache: Cache;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kino-vo-cached-"));
  cache = new Cache(dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("cache-only voiceover (--real)", () => {
  // eleven_v3 rejects previous_text/next_text, so a presenter-less spec takes the one-call path.
  it("throws instead of synthesising when the whole-script entry is missing", async () => {
    await expect(
      buildVO({ spec: specOf("Hello world.", "Second beat."), voiceId: "v1", cache, vo: "cached" }),
    ).rejects.toThrow(/--real needs real voiceover in the cache/);
  });

  // A context-capable model TTSs per segment, which is the other place a miss can happen.
  it("throws on the per-segment path too, naming the beat that is missing", async () => {
    await expect(
      buildVO({
        spec: specOf("Hello world.", "Second beat."),
        voiceId: "v1",
        cache,
        vo: "cached",
        model: "eleven_multilingual_v2",
      }),
    ).rejects.toThrow(/segment\[0\]/);
  });

  it("names the exact command that fills the cache, with the spec path in it", async () => {
    await expect(
      buildVO({ spec: specOf("Hello world."), voiceId: "v1", cache, vo: "cached", specRef: "specs/promo.json" }),
    ).rejects.toThrow(/kino build specs\/promo\.json --tts/);
  });

  it("falls back to <spec> in the message when no path was threaded through", async () => {
    await expect(buildVO({ spec: specOf("Hello world."), voiceId: "v1", cache, vo: "cached" })).rejects.toThrow(
      /kino build <spec> --tts/,
    );
  });

  it("needs no API key to fail — cache-only never authenticates", async () => {
    const prev = process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    try {
      await expect(buildVO({ spec: specOf("Hello world."), voiceId: "v1", cache, vo: "cached" })).rejects.toThrow(
        /--real needs real voiceover/,
      );
    } finally {
      if (prev !== undefined) process.env.ELEVENLABS_API_KEY = prev;
    }
  });
});
