// Audio for the native engine, mixed node-side with ffmpeg: the VO track (plus `voVolume` when the
// spec asks for one), each SFX delayed to its timestamp at its own volume/pan/rate/fades, and every
// music bed pre-shaped by the EXACT musicVolumeAt curve (the same pure function the legacy engine
// evaluated per frame) applied per-sample to raw PCM — sample-accurate ducking/fades/keyframes with
// no filter-expression approximation.
//
// The filter STRINGS come from audioFilters.ts (pure, unit-tested). This file owns the process
// work: decoding, the per-sample shaping loop, and the one amix call.
import { execa } from "execa";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FFMPEG_PATH } from "../../media/binPaths.js";
import { musicVolumeAt } from "../audio.js";
import type { KinoProps, MusicProps } from "../props.js";
import { RATE, UNIFORM, sfxFilterChain, voFilterChain } from "./audioFilters.js";

async function shapeMusicBed(srcAbs: string, music: MusicProps, endSec: number, outBase: string, workDir: string): Promise<string> {
  const raw = join(workDir, `${outBase}-raw.pcm`);
  // startSec: output-side -ss (after -i) decodes and discards, so the offset is
  // sample-accurate — beat-grid phase alignment depends on this.
  const seek = music.startSec > 0 ? ["-ss", String(music.startSec)] : [];
  await execa(FFMPEG_PATH, ["-y", "-loglevel", "error", "-i", srcAbs, ...seek, "-vn", "-f", "s16le", "-ar", String(RATE), "-ac", "2", raw]);
  const buf = readFileSync(raw);
  const opts = {
    duckSpans: music.duckSpans,
    volume: music.volume,
    duck: music.duck,
    fadeInSec: music.fadeInSec,
    fadeOutSec: music.fadeOutSec,
    endSec,
    keyframes: music.keyframes,
  };
  const samples = buf.length >> 1; // interleaved stereo s16le
  for (let i = 0; i < samples; i++) {
    const t = Math.floor(i / 2) / RATE;
    const g = musicVolumeAt(t, opts);
    const v = Math.max(-32768, Math.min(32767, Math.round(buf.readInt16LE(i * 2) * g)));
    buf.writeInt16LE(v, i * 2);
  }
  writeFileSync(raw, buf);
  const out = join(workDir, `${outBase}-shaped.wav`);
  await execa(FFMPEG_PATH, ["-y", "-loglevel", "error", "-f", "s16le", "-ar", String(RATE), "-ac", "2", "-i", raw, out]);
  return out;
}

/** Audio track plus a per-frame RMS envelope of the FINAL mix (0..1), one entry per composition
 *  frame (length = ceil(endSec·fps)). `null` envelope = no audio at all.
 *
 * The envelope is computed from the mixed wav itself, so it reflects what the audience actually
 * hears (bed + VO + sfx, with ducking and fades already applied) — a kick that lands under VO is
 * still a kick, and one that ducking hid is not. `--kino-audio`/`env.audio` consumes it. */
export interface AudioTrack {
  track: string | null;
  envelope: number[] | null;
}

/** Per-frame RMS of a decoded s16le stereo PCM buffer. Pure so it can be unit-tested without
 *  ffmpeg — the decode is the caller's job. */
export function frameRmsEnvelope(pcm: Buffer, rate: number, endSec: number, fps: number): number[] {
  const total = Math.max(1, Math.ceil(endSec * fps));
  const out: number[] = new Array(total);
  // The flat stream is INTERLEAVED (L,R,L,R…), so a frame holds 2·rate/fps s16 samples and a
  // time window lands on 2·rate/fps consecutive samples — halving that would sample only half of
  // each frame's audio and skew every other frame's loudness.
  const samplesPerFrame = (2 * rate) / fps;
  // s16le stereo: two samples per frame-of-samples; RMS over BOTH channels.
  const sampleCount = Math.floor(pcm.length / 2);
  for (let f = 0; f < total; f++) {
    const a = Math.round(f * samplesPerFrame);
    const b = Math.min(sampleCount, Math.round((f + 1) * samplesPerFrame));
    let acc = 0;
    let n = 0;
    for (let i = a; i < b; i++) {
      const v = pcm.readInt16LE(i * 2) / 32768;
      acc += v * v;
      n++;
    }
    out[f] = n > 0 ? Math.sqrt(acc / n) : 0;
  }
  return out;
}

/** Decode a wav to s16le stereo PCM and compute its per-frame RMS envelope. */
async function mixedEnvelope(wavPath: string, endSec: number, fps: number): Promise<number[]> {
  const raw = wavPath + ".env.pcm";
  await execa(FFMPEG_PATH, ["-y", "-loglevel", "error", "-i", wavPath, "-f", "s16le", "-ar", String(RATE), "-ac", "2", raw]);
  const buf = readFileSync(raw);
  return frameRmsEnvelope(buf, RATE, endSec, fps);
}

/** Build the full mixed track (wav) for the render, or null when the props carry no audio at all. */
export async function buildAudioTrack(props: KinoProps, publicDir: string, endSec: number, workDir: string): Promise<AudioTrack> {
  const inputs: string[] = [];
  const filters: string[] = [];
  const mixLabels: string[] = [];
  const addInput = (path: string) => inputs.push(path) - 1;

  if (props.voTrack) {
    const idx = addInput(join(publicDir, props.voTrack));
    filters.push(voFilterChain(idx, "vo", props.voVolume));
    mixLabels.push("[vo]");
  }
  (props.sfx ?? []).forEach((s, i) => {
    if (s.at >= endSec) return; // the composition never mounts these either
    const idx = addInput(join(publicDir, s.src));
    filters.push(sfxFilterChain(s, idx, `sfx${i}`));
    mixLabels.push(`[sfx${i}]`);
  });
  // Beds are shaped serially: each is a full decode + per-sample pass, and they contend for the
  // same disk and the same ffmpeg. A stack of beds is 2–3 deep in practice, not 30.
  for (const [i, bed] of (props.music ?? []).entries()) {
    const shaped = await shapeMusicBed(join(publicDir, bed.src), bed, endSec, `music-${i}`, workDir);
    const idx = addInput(shaped);
    filters.push(`[${idx}:a]${UNIFORM}[mus${i}]`);
    mixLabels.push(`[mus${i}]`);
  }
  if (!inputs.length) return { track: null, envelope: null };

  // normalize=0: plain summation — each layer keeps its authored volume (no auto-attenuation).
  // Which also means the mix CAN clip: N beds + VO + a hard-panned effect all add up, and nothing
  // downstream rescues that. `kino build` warns when the beds alone sum past full scale.
  filters.push(`${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=longest:normalize=0,apad[mix]`);
  const out = join(workDir, "mix.wav");
  const args = ["-y", "-loglevel", "error"];
  for (const i of inputs) args.push("-i", i);
  args.push("-filter_complex", filters.join(";"), "-map", "[mix]", "-t", endSec.toFixed(4), "-ar", String(RATE), out);
  await execa(FFMPEG_PATH, args);
  return { track: out, envelope: await mixedEnvelope(out, endSec, props.fps) };
}
