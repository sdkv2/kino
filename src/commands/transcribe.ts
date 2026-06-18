import { mkdtempSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorkspace } from "../config/project.js";
import { loadEnv, requireKey } from "../config/env.js";
import { Cache } from "../media/cache.js";
import { contentHash } from "../media/hash.js";
import { probeDuration, extractAudio } from "../media/ffmpeg.js";
import { transcribeAudio, scribeToWords } from "../vo/scribe.js";
import { buildTranscript, wordsToSrt, wordsToVtt, wordsToText, type Transcript } from "../render/transcript.js";
import { log } from "../log.js";

const round2 = (n: number) => Math.round(n * 100) / 100;
const MOCK_TEXT = "This is a mock transcript. It has two segments.";

// IMPORTANT: `transcribe` and `scan` are RESEARCH tools for analysing *external reference videos*
// (competitor / trending clips). Do NOT run them on kino's own renders (we already have exact word
// timings from the TTS `…/with-timestamps` step — use `kino inspect`/`frames`), and never wire them
// into `build` or any production path.

function mockTranscript(): Transcript {
  const words = MOCK_TEXT.split(" ").map((w, i) => ({ word: w, start: round2(i * 0.3), end: round2((i + 1) * 0.3) }));
  return buildTranscript(words, { durationSec: round2(words.length * 0.3), fullText: MOCK_TEXT });
}

async function realTranscribe(video: string): Promise<Transcript> {
  const ws = resolveWorkspace();
  loadEnv(ws.workspaceRoot);
  const apiKey = requireKey("ELEVENLABS_API_KEY");
  const dir = mkdtempSync(join(tmpdir(), "kino-stt-"));
  const wav = join(dir, "audio.wav");
  log.step("extract audio");
  await extractAudio(video, wav);
  const durationSec = await probeDuration(wav);
  if (!durationSec || durationSec < 0.05) throw new Error(`${video} has no audible audio track`);
  const cache = new Cache(ws.cache);
  const key = contentHash({ kind: "scribe", model: "scribe_v1", size: statSync(wav).size });
  const cached = cache.get(key, "json");
  if (cached) return JSON.parse(readFileSync(cached, "utf8")) as Transcript;
  log.step("transcribe (Scribe)");
  const raw = await transcribeAudio(apiKey, wav);
  const words = scribeToWords(raw);
  if (!words.length) throw new Error(`${video} produced no speech (no audible words)`);
  const t = buildTranscript(words, { durationSec, language: raw.language_code, fullText: raw.text });
  const tmpJson = join(dir, "t.json");
  writeFileSync(tmpJson, JSON.stringify(t));
  cache.put(key, "json", tmpJson);
  return t;
}

function emit(t: Transcript, opts: { format?: string; out?: string }): void {
  const fmt = opts.format ?? "json";
  const body =
    fmt === "srt" ? wordsToSrt(t.segments)
    : fmt === "vtt" ? wordsToVtt(t.segments)
    : fmt === "text" ? wordsToText(t.segments)
    : JSON.stringify(t, null, 2);
  if (opts.out) {
    writeFileSync(opts.out, body);
    log.ok(opts.out);
  } else {
    console.log(body);
  }
}

export async function transcribe(
  video: string,
  opts: { format?: string; out?: string; mock?: boolean },
): Promise<Transcript> {
  const t = opts.mock ? mockTranscript() : await realTranscribe(video);
  emit(t, opts);
  return t;
}
