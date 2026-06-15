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

export async function genSilence(seconds: number, out: string): Promise<void> {
  await execa("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
    "-t", String(seconds), "-c:a", "libmp3lame", "-b:a", "128k", out,
  ]);
}

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
