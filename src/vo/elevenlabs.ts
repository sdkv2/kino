import { writeFileSync } from "node:fs";
import { genSilence } from "../media/ffmpeg.js";
import { charsToWords } from "../render/captions.js";
import type { WordTiming } from "../render/props.js";

import { fetchWithRetry } from "../media/net.js";

const BASE = "https://api.elevenlabs.io/v1";

export interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
}
// AUDIO FORMAT COUPLING: requests use mp3_44100_128 (44.1 kHz, 128 kbps MP3). This MUST stay in
// sync with ffmpeg.ts (libmp3lame -b:a 128k, anullsrc r=44100) — the stitched track and the
// per-clip VO must share a format, and the format is baked into the content-hash cache key, so
// changing it here without changing ffmpeg.ts (and vice-versa) silently invalidates the cache.
export const DEFAULT_SETTINGS: VoiceSettings = {
  stability: 0.45,
  similarity_boost: 0.75,
  style: 0.25,
  use_speaker_boost: true,
};

/** Default ElevenLabs TTS model_id when spec.voiceModel is omitted. */
export const DEFAULT_VOICE_MODEL = "eleven_v3";

// v3 rejects previous_text/next_text with 400 unsupported_model — prosody conditioning is
// v2-family only. ponytail: prefix check, revisit when ElevenLabs ships v3 context support.
export const modelSupportsContext = (model: string) => !model.startsWith("eleven_v3");

export async function listVoices(
  apiKey: string,
): Promise<Array<{ id: string; name: string; gender?: string; accent?: string; age?: string }>> {
  const r = await fetchWithRetry(`${BASE}/voices`, { headers: { "xi-api-key": apiKey } });
  if (!r.ok) throw new Error(`ElevenLabs voices ${r.status}`);
  const d = (await r.json()) as { voices: Array<{ voice_id: string; name: string; labels?: Record<string, string> }> };
  return d.voices.map((v) => ({
    id: v.voice_id,
    name: v.name,
    gender: v.labels?.gender,
    accent: v.labels?.accent,
    age: v.labels?.age,
  }));
}

// ElevenLabs TTS that also returns clip-relative word timings (for word-synced captions).
export async function ttsWithTimestamps(
  apiKey: string,
  voiceId: string,
  text: string,
  out: string,
  settings = DEFAULT_SETTINGS,
  model = DEFAULT_VOICE_MODEL,
  context?: { previousText?: string; nextText?: string },
): Promise<WordTiming[]> {
  // previous_text/next_text condition prosody on neighboring segments so per-segment clips
  // don't reset pitch/pacing at every seam. Dropped for models that reject them (v3);
  // JSON.stringify drops the fields when undefined.
  const ctx = modelSupportsContext(model) ? context : undefined;
  const r = await fetchWithRetry(`${BASE}/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: settings,
      previous_text: ctx?.previousText,
      next_text: ctx?.nextText,
    }),
  });
  if (!r.ok) throw new Error(`ElevenLabs TTS(timestamps) ${r.status}: ${await r.text()}`);
  const d = (await r.json()) as {
    audio_base64: string;
    alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
  };
  writeFileSync(out, Buffer.from(d.audio_base64, "base64"));
  const a = d.alignment;
  return a ? charsToWords(a.characters, a.character_start_times_seconds, a.character_end_times_seconds) : [];
}

/** Default silent-build speaking rate — the estimate a mock clip is paced at. */
export const MOCK_WORD_SEC = 0.38;

// --mock / silent timestamps: fake word timings over a silent clip, paced at MOCK_WORD_SEC/word.
// Pass `durSec` (a segment's `dur`) to force an exact beat length for silent beats that must hit a
// fixed duration (art films, music-locked motion).
//
// `dur` sets the BEAT length, not the speaking rate. Words keep their natural cadence and the rest of
// the beat is hold. Spreading them evenly across `dur` instead made every VO-locked typed surface
// mistime: a 5-word phrase in a 3.633s beat typed at 0.727s/word, so it finished at the beat's end
// rather than early — and a later collapse/exit keyframe then cut the phrase off mid-word, on a
// surface whose whole job was to finish typing and hold. Silent previews are meant to be timing-
// faithful to the eventual VO, and stretching the words made them structurally unfaithful.
//
// Only compress below the natural rate when the forced beat is too short to hold the words at all.
export function mockWordPacing(wordCount: number, durSec?: number): { total: number; per: number } {
  const fixed = typeof durSec === "number" && durSec > 0;
  const total = fixed ? durSec! : Math.max(0.8, wordCount * MOCK_WORD_SEC);
  const per = !wordCount
    ? 0
    : fixed
      ? Math.min(MOCK_WORD_SEC, total / wordCount)
      : MOCK_WORD_SEC;
  return { total, per };
}

export async function ttsMockWithTimestamps(text: string, out: string, durSec?: number): Promise<WordTiming[]> {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const { total, per } = mockWordPacing(words.length, durSec);
  await genSilence(total, out);
  return words.map((w, i) => ({ word: w, start: i * per, end: (i + 1) * per }));
}
