import { execa } from "execa";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await execa("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", file,
  ]);
  return parseFloat(stdout.trim());
}

// Keep 44100/128k MP3 in sync with elevenlabs.ts mp3_44100_128 (shared format + cache key).
export async function genSilence(seconds: number, out: string): Promise<void> {
  await execa("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
    "-t", String(seconds), "-c:a", "libmp3lame", "-b:a", "128k", out,
  ]);
}

// Keep 44100/128k MP3 in sync with elevenlabs.ts mp3_44100_128 (shared format + cache key).
export async function stitchAudio(clips: string[], gapSec: number, out: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "kino-stitch-"));
  const sil = join(dir, "sil.mp3");
  await genSilence(gapSec, sil);
  const lines: string[] = [];
  clips.forEach((c, i) => {
    if (i > 0) lines.push(`file '${sil}'`);
    lines.push(`file '${c}'`);
  });
  const list = join(dir, "list.txt");
  writeFileSync(list, lines.join("\n"));
  await execa("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
    "-i", list, "-c:a", "libmp3lame", "-b:a", "128k", out,
  ]);
}

// Pull a mono 16 kHz WAV out of a video (for speech-to-text). No video stream in the output.
export async function extractAudio(video: string, out: string): Promise<void> {
  await execa("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-vn", "-ac", "1", "-ar", "16000", out]);
}

// Grab one frame at `sec` seconds.
export async function extractFrame(video: string, sec: number, out: string): Promise<void> {
  await execa("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(sec), "-i", video, "-frames:v", "1", out]);
}

// Decode any audio/video file to raw mono s16le PCM at `rate` Hz (for marker analysis).
export async function decodeRawPcm(file: string, out: string, rate: number): Promise<void> {
  await execa("ffmpeg", ["-y", "-loglevel", "error", "-i", file,
    "-vn", "-ac", "1", "-ar", String(rate), "-f", "s16le", "-acodec", "pcm_s16le", out]);
}

// Waveform overview PNG (agent eyeballs the track's shape).
export async function waveformPng(file: string, out: string): Promise<void> {
  await execa("ffmpeg", ["-y", "-loglevel", "error", "-i", file,
    "-filter_complex", "showwavespic=s=1200x300:colors=white", "-frames:v", "1", out]);
}

// Spectrogram PNG (frequency content over time).
export async function spectrumPng(file: string, out: string): Promise<void> {
  await execa("ffmpeg", ["-y", "-loglevel", "error", "-i", file,
    "-lavfi", "showspectrumpic=s=1200x400:legend=1", out]);
}
