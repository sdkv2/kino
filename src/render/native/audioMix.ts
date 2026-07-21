// Audio for the native engine, mixed node-side with ffmpeg: the VO track plain, each SFX delayed
// to its timestamp at its own volume, and the music bed pre-shaped by the EXACT musicVolumeAt curve
// (the same pure function the legacy engine evaluated per frame) applied per-sample to raw PCM —
// sample-accurate ducking/fades with no filter-expression approximation.
import { execa } from "execa";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FFMPEG_PATH } from "../../media/binPaths.js";
import { musicVolumeAt } from "../audio.js";
import type { KinoProps } from "../props.js";

const RATE = 44100;

async function shapeMusicBed(srcAbs: string, music: NonNullable<KinoProps["music"]>, endSec: number, workDir: string): Promise<string> {
  const raw = join(workDir, "music-raw.pcm");
  await execa(FFMPEG_PATH, ["-y", "-loglevel", "error", "-i", srcAbs, "-vn", "-f", "s16le", "-ar", String(RATE), "-ac", "2", raw]);
  const buf = readFileSync(raw);
  const opts = {
    duckSpans: music.duckSpans,
    volume: music.volume,
    duck: music.duck,
    fadeInSec: music.fadeInSec,
    fadeOutSec: music.fadeOutSec,
    endSec,
  };
  const samples = buf.length >> 1; // interleaved stereo s16le
  for (let i = 0; i < samples; i++) {
    const t = Math.floor(i / 2) / RATE;
    const g = musicVolumeAt(t, opts);
    const v = Math.max(-32768, Math.min(32767, Math.round(buf.readInt16LE(i * 2) * g)));
    buf.writeInt16LE(v, i * 2);
  }
  writeFileSync(raw, buf);
  const out = join(workDir, "music-shaped.wav");
  await execa(FFMPEG_PATH, ["-y", "-loglevel", "error", "-f", "s16le", "-ar", String(RATE), "-ac", "2", "-i", raw, out]);
  return out;
}

/** Build the full mixed track (wav) for the render, or null when the props carry no audio at all. */
export async function buildAudioTrack(props: KinoProps, publicDir: string, endSec: number, workDir: string): Promise<string | null> {
  const inputs: string[] = [];
  const filters: string[] = [];
  const mixLabels: string[] = [];
  const addInput = (path: string) => inputs.push(path) - 1;

  const uniform = "aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo";

  if (props.voTrack) {
    const idx = addInput(join(publicDir, props.voTrack));
    filters.push(`[${idx}:a]${uniform}[vo]`);
    mixLabels.push("[vo]");
  }
  (props.sfx ?? []).forEach((s, i) => {
    if (s.at >= endSec) return; // the composition never mounts these either
    const idx = addInput(join(publicDir, s.src));
    const ms = Math.round(s.at * 1000);
    filters.push(`[${idx}:a]${uniform},adelay=${ms}|${ms},volume=${s.volume}[sfx${i}]`);
    mixLabels.push(`[sfx${i}]`);
  });
  if (props.music) {
    const shaped = await shapeMusicBed(join(publicDir, props.music.src), props.music, endSec, workDir);
    const idx = addInput(shaped);
    filters.push(`[${idx}:a]${uniform}[mus]`);
    mixLabels.push("[mus]");
  }
  if (!inputs.length) return null;

  // normalize=0: plain summation — each layer keeps its authored volume (no auto-attenuation).
  filters.push(`${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=longest:normalize=0,apad[mix]`);
  const out = join(workDir, "mix.wav");
  const args = ["-y", "-loglevel", "error"];
  for (const i of inputs) args.push("-i", i);
  args.push("-filter_complex", filters.join(";"), "-map", "[mix]", "-t", endSec.toFixed(4), "-ar", String(RATE), out);
  await execa(FFMPEG_PATH, args);
  return out;
}
