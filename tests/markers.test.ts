import { describe, it, expect } from "vitest";
import { computeMarkers } from "../src/media/markers.js";

const SR = 16000;

// Build a mono Float32Array: `spans` = [{from, to, amp}] seconds of 440 Hz sine, silence elsewhere.
function tone(totalSec: number, spans: Array<{ from: number; to: number; amp: number }>): Float32Array {
  const out = new Float32Array(Math.round(totalSec * SR));
  for (const s of spans) {
    for (let i = Math.round(s.from * SR); i < Math.round(s.to * SR); i++) {
      out[i] = s.amp * Math.sin((2 * Math.PI * 440 * i) / SR);
    }
  }
  return out;
}

describe("computeMarkers", () => {
  it("emits a 10 Hz rms envelope covering the duration", () => {
    const m = computeMarkers(tone(2.0, [{ from: 0, to: 2, amp: 0.5 }]), SR);
    expect(m.durationSec).toBeCloseTo(2.0, 1);
    expect(m.rms.length).toBe(20);
    expect(m.rms[0].t).toBe(0);
    expect(m.rms[1].t).toBeCloseTo(0.1, 5);
    // sine RMS = amp/√2 ≈ 0.354
    expect(m.rms[5].v).toBeGreaterThan(0.3);
    expect(m.rms[5].v).toBeLessThan(0.4);
  });

  it("finds onsets where bursts start, with min spacing", () => {
    const m = computeMarkers(
      tone(4.0, [
        { from: 1.0, to: 1.5, amp: 0.6 },
        { from: 3.0, to: 3.5, amp: 0.6 },
      ]),
      SR,
    );
    expect(m.onsets.length).toBe(2);
    expect(m.onsets[0]).toBeCloseTo(1.0, 1);
    expect(m.onsets[1]).toBeCloseTo(3.0, 1);
  });

  it("finds peaks at loud local maxima only", () => {
    const m = computeMarkers(
      tone(3.0, [
        { from: 0.5, to: 1.0, amp: 0.9 }, // loud — peak
        { from: 2.0, to: 2.5, amp: 0.2 }, // quiet (< 0.5·maxV) — no peak
      ]),
      SR,
    );
    expect(m.peaks.length).toBeGreaterThanOrEqual(1);
    expect(m.peaks[0]).toBeGreaterThanOrEqual(0.5);
    expect(m.peaks[0]).toBeLessThanOrEqual(1.0);
    expect(m.peaks.every((p) => p < 2.0)).toBe(true);
  });

  it("finds silences ≥ 0.3s and skips shorter dips", () => {
    const m = computeMarkers(
      tone(4.0, [
        { from: 0, to: 1.0, amp: 0.5 },
        { from: 1.2, to: 2.0, amp: 0.5 }, // 0.2s dip — too short to report
        { from: 3.0, to: 4.0, amp: 0.5 }, // 1.0s gap before this — reported
      ]),
      SR,
    );
    expect(m.silences.length).toBe(1);
    expect(m.silences[0].from).toBeCloseTo(2.0, 1);
    expect(m.silences[0].to).toBeCloseTo(3.0, 1);
  });

  it("treats an all-silent buffer as one silence, no onsets/peaks", () => {
    const m = computeMarkers(new Float32Array(SR * 2), SR);
    expect(m.onsets).toEqual([]);
    expect(m.peaks).toEqual([]);
    expect(m.silences).toEqual([{ from: 0, to: 2 }]);
  });
});

import { analyzeAudio, decodePcm } from "../src/media/markers.js";
import { execa } from "execa";
import { FFMPEG_PATH } from "../src/media/binPaths.js";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("analyzeAudio (ffmpeg integration)", () => {
  it("decodes, detects the burst, and writes json + wave + spectrum artifacts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-mk-"));
    const f = join(dir, "burst.mp3");
    // 1s silence, 1s 440Hz tone, 1s silence
    await execa(FFMPEG_PATH, ["-y", "-loglevel", "error",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
      "-af", "adelay=1000:all=1,apad=pad_dur=1", f]);
    const { markers, jsonPath, wavePath, spectrumPath } = await analyzeAudio(f, dir);
    expect(markers.durationSec).toBeCloseTo(3.0, 0);
    expect(markers.onsets.length).toBeGreaterThanOrEqual(1);
    expect(markers.onsets[0]).toBeGreaterThan(0.7);
    expect(markers.onsets[0]).toBeLessThan(1.3);
    expect(markers.silences.length).toBeGreaterThanOrEqual(2);
    expect(existsSync(wavePath)).toBe(true);
    expect(existsSync(spectrumPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(parsed.onsets).toEqual(markers.onsets);
  });

  it("decodePcm returns normalized samples at the requested rate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-pcm-"));
    const f = join(dir, "t.mp3");
    await execa(FFMPEG_PATH, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", f]);
    const s = await decodePcm(f, 16000);
    expect(s.length).toBeGreaterThan(15000);
    expect(s.length).toBeLessThan(18000);
    expect(Math.max(...Array.from(s.slice(0, 1000)))).toBeLessThanOrEqual(1.0);
  });
});
