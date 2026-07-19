// Audio marker analysis for agents: a coarse RMS envelope plus onsets (energy jumps), peaks
// (loud local maxima), and silences, computed from raw PCM. Pure math — deterministic and
// unit-tested against synthetic buffers. ffmpeg decode + chart rendering live in Task 2.
// ponytail: energy-delta onsets, no BPM grid — swap in a real DSP dep if music-video beat
// tracking is ever needed.

import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { decodeRawPcm, waveformPng, spectrumPng } from "./ffmpeg.js";

export interface AudioMarkers {
  durationSec: number;
  rms: Array<{ t: number; v: number }>; // 10 Hz envelope, v normalized 0..1
  onsets: number[]; // seconds — energy-delta jumps (SFX anchor points)
  peaks: number[]; // seconds — loud local maxima
  silences: Array<{ from: number; to: number }>; // runs under the silence floor, ≥ 0.3s
}

const HOP_SEC = 0.1; // 10 Hz envelope
const SILENCE_FLOOR = 0.01;
const MIN_SILENCE_SEC = 0.3;
const ONSET_MIN_DELTA = 0.04;
const ONSET_MIN_LEVEL = 0.02;
const ONSET_MIN_SPACING = 0.15;
const PEAK_REL_LEVEL = 0.5; // of maxV
const PEAK_MIN_SPACING = 0.3;

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function computeMarkers(samples: Float32Array, sampleRate: number): AudioMarkers {
  const durationSec = samples.length / sampleRate;
  const hop = Math.round(sampleRate * HOP_SEC);
  const n = Math.floor(samples.length / hop);
  const env: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) sum += samples[j] * samples[j];
    env.push(Math.sqrt(sum / hop));
  }
  const maxV = Math.max(0, ...env);

  const rms = env.map((v, i) => ({ t: r2(i * HOP_SEC), v: r3(v) }));

  // Silences: contiguous runs under the floor, long enough to matter.
  const silences: Array<{ from: number; to: number }> = [];
  let silStart: number | null = null;
  for (let i = 0; i <= n; i++) {
    const silent = i < n && env[i] < SILENCE_FLOOR;
    if (silent && silStart === null) silStart = i * HOP_SEC;
    if (!silent && silStart !== null) {
      const end = i * HOP_SEC;
      if (end - silStart >= MIN_SILENCE_SEC) silences.push({ from: r2(silStart), to: r2(end) });
      silStart = null;
    }
  }

  // Onsets: energy jumps window-over-window, thresholded relative to the track's own loudness.
  const onsetDelta = Math.max(ONSET_MIN_DELTA, 0.15 * maxV);
  const onsets: number[] = [];
  for (let i = 1; i < n; i++) {
    if (env[i] - env[i - 1] >= onsetDelta && env[i] >= ONSET_MIN_LEVEL) {
      const t = r2(i * HOP_SEC);
      if (!onsets.length || t - onsets[onsets.length - 1] >= ONSET_MIN_SPACING) onsets.push(t);
    }
  }

  // Peaks: loud local maxima with a minimum spacing (keep the first of a cluster).
  const peaks: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (env[i] >= env[i - 1] && env[i] >= env[i + 1] && env[i] >= PEAK_REL_LEVEL * maxV && env[i] > SILENCE_FLOOR) {
      const t = r2(i * HOP_SEC);
      if (!peaks.length || t - peaks[peaks.length - 1] >= PEAK_MIN_SPACING) peaks.push(t);
    }
  }

  return { durationSec: r2(durationSec), rms, onsets, peaks, silences };
}

const ANALYSIS_RATE = 16000;

// Decode a file to normalized mono Float32 samples via ffmpeg (s16le → /32768).
export async function decodePcm(file: string, sampleRate: number = ANALYSIS_RATE): Promise<Float32Array> {
  const raw = join(mkdtempSync(join(tmpdir(), "kino-pcm-")), "a.raw");
  await decodeRawPcm(file, raw, sampleRate);
  const buf = readFileSync(raw);
  const ints = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
  const out = new Float32Array(ints.length);
  for (let i = 0; i < ints.length; i++) out[i] = ints[i] / 32768;
  return out;
}

export interface AnalyzeResult {
  markers: AudioMarkers;
  jsonPath: string;
  wavePath: string;
  spectrumPath: string;
}

/**
 * Analyze any audio/video file: decode PCM, compute markers, and write three artifacts —
 * <name>.markers.json, <name>.wave.png, <name>.spectrum.png — into outDir (default: next
 * to the input file).
 */
export async function analyzeAudio(file: string, outDir?: string): Promise<AnalyzeResult> {
  const dir = outDir ?? dirname(file);
  mkdirSync(dir, { recursive: true });
  const name = basename(file, extname(file));
  const samples = await decodePcm(file);
  const markers = computeMarkers(samples, ANALYSIS_RATE);
  const jsonPath = join(dir, `${name}.markers.json`);
  const wavePath = join(dir, `${name}.wave.png`);
  const spectrumPath = join(dir, `${name}.spectrum.png`);
  writeFileSync(jsonPath, JSON.stringify(markers, null, 2));
  await waveformPng(file, wavePath);
  await spectrumPng(file, spectrumPath);
  return { markers, jsonPath, wavePath, spectrumPath };
}
