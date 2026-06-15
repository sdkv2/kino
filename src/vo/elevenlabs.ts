import { writeFileSync } from "node:fs";
import { genSilence } from "../media/ffmpeg.js";

const BASE = "https://api.elevenlabs.io/v1";

export interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
}
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

export async function tts(
  apiKey: string,
  voiceId: string,
  text: string,
  out: string,
  settings = DEFAULT_SETTINGS,
): Promise<void> {
  const r = await fetch(`${BASE}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: settings }),
  });
  if (!r.ok) throw new Error(`ElevenLabs TTS ${r.status}: ${await r.text()}`);
  writeFileSync(out, Buffer.from(await r.arrayBuffer()));
}

// --mock: ~0.4s/word of silence so timing math + render still work with zero spend.
export async function ttsMock(text: string, out: string): Promise<void> {
  const words = text.trim().split(/\s+/).length;
  await genSilence(Math.max(0.8, words * 0.38), out);
}
