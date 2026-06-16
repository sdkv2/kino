// ElevenLabs Scribe speech-to-text. Verified shape:
//   POST /v1/speech-to-text  (multipart: file, model_id=scribe_v1)  → { text, language_code, words[] }
//   each word: { text, start, end, type: "word" | "spacing" | "audio_event" }
// Used ONLY to analyse external reference videos (see commands/transcribe.ts header).
import { filePart, fileName } from "../media/net.js";
import type { WordTiming } from "../render/props.js";

const BASE = "https://api.elevenlabs.io/v1";

export interface ScribeToken { text: string; start: number; end: number; type?: string }
export interface RawScribe { text?: string; language_code?: string; words: ScribeToken[] }

// Pure: drop spacing/audio-event tokens, keep real words as timeline WordTimings.
export function scribeToWords(raw: RawScribe): WordTiming[] {
  return (raw.words ?? [])
    .filter((w) => (w.type ?? "word") === "word")
    .map((w) => ({ word: w.text, start: w.start, end: w.end }));
}

export async function transcribeAudio(apiKey: string, audioPath: string): Promise<RawScribe> {
  const fd = new FormData();
  fd.append("file", await filePart(audioPath), fileName(audioPath));
  fd.append("model_id", "scribe_v1");
  const r = await fetch(`${BASE}/speech-to-text`, { method: "POST", headers: { "xi-api-key": apiKey }, body: fd });
  if (!r.ok) throw new Error(`Scribe ${r.status}: ${await r.text()}`);
  return (await r.json()) as RawScribe;
}
