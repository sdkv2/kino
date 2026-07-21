import { execa } from "execa";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FFMPEG_PATH, FFPROBE_PATH } from "./binPaths.js";

export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await execa(FFPROBE_PATH, [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", file,
  ]);
  return parseFloat(stdout.trim());
}

// Keep 44100/128k MP3 in sync with elevenlabs.ts mp3_44100_128 (shared format + cache key).
export async function genSilence(seconds: number, out: string): Promise<void> {
  await execa(FFMPEG_PATH, [
    "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
    "-t", String(seconds), "-c:a", "libmp3lame", "-b:a", "128k", out,
  ]);
}

// ElevenLabs occasionally appends a short spurious burst — a half-breath or an onset leaning into
// the next line — AFTER the real speech, separated by a silence gap. Its own word alignment stretches
// the last word over that burst, so word timings can't catch it. Detect a short trailing segment that
// sits after the clip's LAST silence gap and return the cut point (the gap's start); null when the clip
// already ends in silence or the trailing audio is long enough to be a real final word (not an artifact).
export async function trailingArtifactCut(clip: string): Promise<number | null> {
  const dur = await probeDuration(clip);
  const { stderr } = await execa(
    "ffmpeg",
    ["-i", clip, "-af", "silencedetect=noise=-50dB:d=0.05", "-f", "null", "-"],
    { reject: false },
  );
  const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => parseFloat(m[1]));
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => parseFloat(m[1]));
  if (!starts.length) return null;
  const lastStart = starts[starts.length - 1];
  // If ffmpeg emitted no closing silence_end for the last gap, silence ran to EOF → clip ends clean.
  const lastEnd = ends.length >= starts.length ? ends[ends.length - 1] : dur;
  const trailing = dur - lastEnd; // audio remaining after the last silence gap
  // ponytail: >0.25s of trailing audio is a real final word, not a burst — leave it. Ceiling raise if
  // a legit closing word ever gets clipped.
  return trailing > 0.003 && trailing <= 0.25 ? lastStart : null;
}

// Keep [0, endSec] of src as a lossless wav (used to drop trailing artifacts before stitching).
export async function trimAudio(src: string, endSec: number, out: string): Promise<void> {
  await execa(FFMPEG_PATH, ["-y", "-loglevel", "error", "-i", src, "-t", String(endSec), out]);
}

// Keep 44100/128k MP3 in sync with elevenlabs.ts mp3_44100_128 (shared format + cache key).
export async function stitchAudio(clips: string[], gapSec: number, out: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "kino-stitch-"));
  // Silence gap + faded clips are lossless WAV so the concat re-encode below is the ONLY mp3
  // generation (no double-encode). 44100/mono matches the clips (see elevenlabs.ts mp3_44100_128).
  const sil = join(dir, "sil.wav");
  await execa(FFMPEG_PATH, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
    "-t", String(gapSec), sil]);
  // Declick every seam: ElevenLabs clips can end (or start) mid-waveform, so butting a pure-silence
  // gap against a non-zero sample is an audible click at the end of each beat. An 8 ms in/out fade
  // ramps each clip edge to zero; areverse fades the tail without needing the clip's duration.
  const faded: string[] = [];
  for (const [i, c] of clips.entries()) {
    const f = join(dir, `f${i}.wav`);
    await execa(FFMPEG_PATH, ["-y", "-loglevel", "error", "-i", c,
      "-af", "afade=t=in:d=0.008,areverse,afade=t=in:d=0.008,areverse", f]);
    faded.push(f);
  }
  const lines: string[] = [];
  faded.forEach((c, i) => {
    if (i > 0) lines.push(`file '${sil}'`);
    lines.push(`file '${c}'`);
  });
  const list = join(dir, "list.txt");
  writeFileSync(list, lines.join("\n"));
  await execa(FFMPEG_PATH, [
    "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
    "-i", list, "-c:a", "libmp3lame", "-b:a", "128k", out,
  ]);
}

// Pull a mono 16 kHz WAV out of a video (for speech-to-text). No video stream in the output.
export async function extractAudio(video: string, out: string): Promise<void> {
  await execa(FFMPEG_PATH, ["-y", "-loglevel", "error", "-i", video, "-vn", "-ac", "1", "-ar", "16000", out]);
}

// Grab one frame at `sec` seconds.
export async function extractFrame(video: string, sec: number, out: string): Promise<void> {
  await execa(FFMPEG_PATH, ["-y", "-loglevel", "error", "-ss", String(sec), "-i", video, "-frames:v", "1", out]);
}

// Decode any audio/video file to raw mono s16le PCM at `rate` Hz (for marker analysis).
export async function decodeRawPcm(file: string, out: string, rate: number): Promise<void> {
  await execa(FFMPEG_PATH, ["-y", "-loglevel", "error", "-i", file,
    "-vn", "-ac", "1", "-ar", String(rate), "-f", "s16le", "-acodec", "pcm_s16le", out]);
}

// Waveform overview PNG (agent eyeballs the track's shape).
export async function waveformPng(file: string, out: string): Promise<void> {
  await execa(FFMPEG_PATH, ["-y", "-loglevel", "error", "-i", file,
    "-filter_complex", "showwavespic=s=1200x300:colors=white", "-frames:v", "1", out]);
}

// Spectrogram PNG (frequency content over time).
export async function spectrumPng(file: string, out: string): Promise<void> {
  await execa(FFMPEG_PATH, ["-y", "-loglevel", "error", "-i", file,
    "-lavfi", "showspectrumpic=s=1200x400:legend=1", out]);
}
