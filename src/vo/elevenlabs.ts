import { writeFileSync } from "node:fs";
import { genSilence } from "../media/ffmpeg.js";
import { charsToWords } from "../render/captions.js";
import type { WordTiming } from "../render/props.js";

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

export async function listVoices(
  apiKey: string,
): Promise<Array<{ id: string; name: string; gender?: string; accent?: string; age?: string }>> {
  const r = await fetch(`${BASE}/voices`, { headers: { "xi-api-key": apiKey } });
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
): Promise<WordTiming[]> {
  const r = await fetch(`${BASE}/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: settings }),
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

// --mock timestamps: evenly spaced fake word timings over the silent clip.
export async function ttsMockWithTimestamps(text: string, out: string): Promise<WordTiming[]> {
  const words = text.trim().split(/\s+/);
  const per = 0.38;
  await genSilence(Math.max(0.8, words.length * per), out);
  return words.map((w, i) => ({ word: w, start: i * per, end: (i + 1) * per }));
}
