// Local whisper.cpp speech-to-text — the keyless alternative to ElevenLabs Scribe for imported
// VO (`voFile`). Shells out to whisper-cli (brew whisper-cpp / KINO_WHISPER override) with
// `-ml 1 -sow -oj` so each JSON transcription entry is one word with ms offsets. The ggml model
// downloads once into ~/.kino/whisper/ (same on-demand pattern as the font cache).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { download } from "../media/net.js";
import { log } from "../log.js";
import type { WordTiming } from "../render/props.js";

export interface WhisperEntry {
  offsets?: { from: number; to: number };
  text?: string;
}
export interface RawWhisper {
  transcription?: WhisperEntry[];
}

/** Pure: whisper.cpp `-oj` output → WordTimings (ms → s, whitespace entries dropped). */
export function whisperJsonToWords(raw: RawWhisper): WordTiming[] {
  return (raw.transcription ?? [])
    .filter((e) => e.text?.trim() && e.offsets)
    .map((e) => ({ word: e.text!.trim(), start: e.offsets!.from / 1000, end: e.offsets!.to / 1000 }));
}

export type SttEngine = "scribe" | "whisper";

/** Which STT engine transcribes an imported voFile. Scribe when the key is there (paid, best),
 *  whisper-cli when not; KINO_STT forces either. Throws with install guidance when neither works. */
export function pickSttEngine(opts: { hasKey: boolean; hasWhisper: boolean; override?: string }): SttEngine {
  if (opts.override === "scribe" || opts.override === "whisper") return opts.override;
  if (opts.hasKey) return "scribe";
  if (opts.hasWhisper) return "whisper";
  throw new Error(
    "voFile needs word timings but no STT engine is available — set ELEVENLABS_API_KEY (Scribe) " +
      "or install whisper.cpp (`brew install whisper-cpp`, or KINO_WHISPER=/path/to/whisper-cli).",
  );
}

/** whisper-cli binary: KINO_WHISPER override, else first of whisper-cli / whisper-cpp on PATH. */
export function resolveWhisper(): string | null {
  if (process.env.KINO_WHISPER) return process.env.KINO_WHISPER;
  for (const cmd of ["whisper-cli", "whisper-cpp"]) {
    if (spawnSync(cmd, ["--help"], { stdio: "ignore" }).status != null) return cmd;
  }
  return null;
}

const MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";

/** ggml model path: KINO_WHISPER_MODEL, else ~/.kino/whisper/ggml-base.en.bin (downloaded once, ~142MB). */
export async function ensureWhisperModel(): Promise<string> {
  if (process.env.KINO_WHISPER_MODEL) return process.env.KINO_WHISPER_MODEL;
  const dir = join(homedir(), ".kino", "whisper");
  const model = join(dir, "ggml-base.en.bin");
  if (!existsSync(model)) {
    mkdirSync(dir, { recursive: true });
    log.step("downloading whisper model (ggml-base.en, ~142MB, one-time)");
    await download(MODEL_URL, model);
  }
  return model;
}

/** Transcribe a 16kHz mono wav with word-level timings. Caller extracts audio + caches. */
export async function whisperTranscribe(wav: string, outBase: string): Promise<WordTiming[]> {
  const bin = resolveWhisper();
  if (!bin) throw new Error("whisper-cli not found — brew install whisper-cpp, or set KINO_WHISPER");
  const model = await ensureWhisperModel();
  await execa(bin, ["-m", model, "-f", wav, "-ml", "1", "-sow", "-oj", "-of", outBase, "--no-prints"]);
  const raw = JSON.parse(readFileSync(`${outBase}.json`, "utf8")) as RawWhisper;
  const words = whisperJsonToWords(raw);
  if (!words.length) throw new Error(`whisper produced no words for ${wav} — is there audible speech?`);
  return words;
}
