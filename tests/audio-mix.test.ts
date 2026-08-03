// End-to-end checks on the REAL ffmpeg graph buildAudioTrack constructs: synthesize small wavs,
// mix them, decode the result and measure it. String assertions (tests/audio-filters) prove what we
// asked ffmpeg for; these prove ffmpeg did it — that a keyframed gate actually silences the bed,
// that a hard pan actually lands in one channel, and that varispeed moves pitch without moving the
// event's start.
import { describe, it, expect } from "vitest";
import { execa } from "execa";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FFMPEG_PATH } from "../src/media/binPaths.js";
import { buildAudioTrack } from "../src/render/native/audioMix.js";
import type { KinoProps, MusicProps, SfxProps } from "../src/render/props.js";

// Each test spawns 3–6 ffmpeg processes (synthesize, decode, shape, mix, decode again). The work is
// well under a second locally; the budget is headroom for a loaded CI runner.
const TIMEOUT = 60000;
const RATE = 44100;

function dirs() {
  const root = mkdtempSync(join(tmpdir(), "kino-mix-"));
  return { publicDir: root, workDir: root };
}

/**
 * A stereo wav of a steady tone at a KNOWN amplitude, written into `dir` under `name`.
 *
 * `aevalsrc` rather than the shorter `sine=`: lavfi's sine source comes out at roughly -21 dBFS in
 * the bundled ffmpeg, and these tests assert absolute levels, so the amplitude has to be ours.
 */
async function tone(dir: string, name: string, hz: number, sec: number, amp = 0.5): Promise<string> {
  const expr = `${amp}*sin(2*PI*${hz}*t)`;
  await execa(FFMPEG_PATH, [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", `aevalsrc=${expr}|${expr}:d=${sec}:s=${RATE}`,
    "-c:a", "pcm_s16le", join(dir, name),
  ]);
  return name;
}

interface Pcm {
  left: Float64Array;
  right: Float64Array;
  sec: number;
}

/** Decode a mixed wav to per-channel float samples so we can measure it. */
async function decode(path: string): Promise<Pcm> {
  const raw = join(path + ".pcm");
  await execa(FFMPEG_PATH, ["-y", "-loglevel", "error", "-i", path, "-f", "s16le", "-ar", String(RATE), "-ac", "2", raw]);
  const buf = await readFile(raw);
  const frames = buf.length >> 2; // 2 channels × 2 bytes
  const left = new Float64Array(frames);
  const right = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    left[i] = buf.readInt16LE(i * 4) / 32768;
    right[i] = buf.readInt16LE(i * 4 + 2) / 32768;
  }
  return { left, right, sec: frames / RATE };
}

function rms(ch: Float64Array, fromSec: number, toSec: number): number {
  const a = Math.max(0, Math.round(fromSec * RATE));
  const b = Math.min(ch.length, Math.round(toSec * RATE));
  let acc = 0;
  for (let i = a; i < b; i++) acc += ch[i] * ch[i];
  return b > a ? Math.sqrt(acc / (b - a)) : 0;
}

/** First sample past `threshold`, in seconds — the audible onset of an event. */
function onsetSec(ch: Float64Array, threshold = 0.02): number | null {
  for (let i = 0; i < ch.length; i++) if (Math.abs(ch[i]) > threshold) return i / RATE;
  return null;
}
function offsetSec(ch: Float64Array, threshold = 0.02): number | null {
  for (let i = ch.length - 1; i >= 0; i--) if (Math.abs(ch[i]) > threshold) return i / RATE;
  return null;
}

/** Zero crossings per second over a window — 2× the tone's frequency. */
function crossingsPerSec(ch: Float64Array, fromSec: number, toSec: number): number {
  const a = Math.round(fromSec * RATE);
  const b = Math.min(ch.length, Math.round(toSec * RATE));
  let n = 0;
  for (let i = a + 1; i < b; i++) if (ch[i - 1] < 0 !== ch[i] < 0) n++;
  return n / ((b - a) / RATE);
}

const bed = (over: Partial<MusicProps>): MusicProps => ({
  src: "bed.wav",
  volume: 0.5,
  duck: 0.5,
  fadeInSec: 0,
  fadeOutSec: 0,
  startSec: 0,
  duckSpans: [],
  ...over,
});

const props = (over: Partial<KinoProps>): KinoProps =>
  ({ voTrack: null, sfx: [], music: null, ...over }) as KinoProps;

describe("buildAudioTrack (real ffmpeg)", () => {
  it("gates the bed to silence at a keyframe, and ducking cannot lift it back", async () => {
    const { publicDir, workDir } = dirs();
    await tone(publicDir, "bed.wav", 220, 6);
    // Bed at 0.5 until 3s, gated to 0 by 3.5s. A VO span sits at 4–5s with duck ABOVE the gate
    // (0.4): the gate has to win, which is the whole point of resolving ducking with a Math.min
    // against the keyframed level rather than against the authored base.
    const out = await buildAudioTrack(
      props({
        music: [
          bed({
            duck: 0.4,
            duckSpans: [{ from: 4, to: 5 }],
            keyframes: [
              { at: 3, params: { volume: 0.5 } },
              { at: 3.5, params: { volume: 0 } },
            ],
          }),
        ],
      }),
      publicDir,
      6,
      workDir,
    );
    expect(out).not.toBeNull();
    const pcm = await decode(out!);
    const before = rms(pcm.left, 0.5, 2.5);
    expect(before).toBeCloseTo(0.177, 2); // 0.5 peak × 0.5 bed level, sine RMS = 0.25/√2
    expect(rms(pcm.left, 3.6, 3.9)).toBeLessThan(before * 0.01); // gated before the VO span
    expect(rms(pcm.left, 4.2, 4.8)).toBeLessThan(before * 0.01); // INSIDE the span, duck=0.4
    expect(rms(pcm.left, 5.4, 5.9)).toBeLessThan(before * 0.01); // past the release ramp
  }, TIMEOUT);

  it("sums several beds instead of sharing the headroom (amix normalize=0)", async () => {
    const { publicDir, workDir } = dirs();
    await tone(publicDir, "bed.wav", 220, 4);
    await tone(publicDir, "bed2.wav", 220, 4);
    const one = await buildAudioTrack(props({ music: [bed({ volume: 0.25 })] }), publicDir, 4, workDir);
    const oneRms = rms((await decode(one!)).left, 0.5, 3.5);
    const two = await buildAudioTrack(
      props({ music: [bed({ volume: 0.25 }), bed({ src: "bed2.wav", volume: 0.25 })] }),
      publicDir,
      4,
      workDir,
    );
    const twoRms = rms((await decode(two!)).left, 0.5, 3.5);
    expect(twoRms / oneRms).toBeCloseTo(2, 1);
  }, TIMEOUT);

  it("lands a hard-panned effect in the intended channel only", async () => {
    const { publicDir, workDir } = dirs();
    await tone(publicDir, "hit.wav", 880, 0.5);
    const sfx: SfxProps[] = [{ src: "hit.wav", at: 1, volume: 0.6, pan: -1 }];
    const out = await buildAudioTrack(props({ sfx }), publicDir, 3, workDir);
    const pcm = await decode(out!);
    const l = rms(pcm.left, 1.05, 1.45);
    const r = rms(pcm.right, 1.05, 1.45);
    expect(l).toBeGreaterThan(0.1);
    expect(r).toBeLessThan(l * 0.01);
    // Constant power, unity at centre: the live channel is +3 dB (×√2) of what an unpanned copy
    // of the same event puts in it.
    const flat = await buildAudioTrack(props({ sfx: [{ src: "hit.wav", at: 1, volume: 0.6 }] }), publicDir, 3, workDir);
    expect(l / rms((await decode(flat!)).left, 1.05, 1.45)).toBeCloseTo(Math.SQRT2, 1);
  }, TIMEOUT);

  it("varispeeds an effect — pitch up, length down — without moving its start", async () => {
    const { publicDir, workDir } = dirs();
    await tone(publicDir, "hit.wav", 440, 1.0);
    const plain = await decode((await buildAudioTrack(props({ sfx: [{ src: "hit.wav", at: 1, volume: 0.8 }] }), publicDir, 3, workDir))!);
    const fast = await decode(
      (await buildAudioTrack(props({ sfx: [{ src: "hit.wav", at: 1, volume: 0.8, rate: 2 }] }), publicDir, 3, workDir))!,
    );
    // The delay is applied AFTER the rate change, so the onset is still exactly `at`.
    expect(onsetSec(plain.left)!).toBeCloseTo(1, 2);
    expect(onsetSec(fast.left)!).toBeCloseTo(1, 2);
    // …and the tail is halved: 1s of source becomes 0.5s.
    expect(offsetSec(plain.left)!).toBeCloseTo(2, 1);
    expect(offsetSec(fast.left)!).toBeCloseTo(1.5, 1);
    // Pitch moved with it — 440 Hz became 880 Hz (2 zero crossings per cycle).
    expect(crossingsPerSec(plain.left, 1.1, 1.4)).toBeCloseTo(880, -2);
    expect(crossingsPerSec(fast.left, 1.1, 1.4)).toBeCloseTo(1760, -2);
  }, TIMEOUT);

  it("applies voVolume to the VO chain and leaves it alone at the default", async () => {
    const { publicDir, workDir } = dirs();
    await tone(publicDir, "vo.wav", 300, 3);
    const full = await decode((await buildAudioTrack(props({ voTrack: "vo.wav" }), publicDir, 3, workDir))!);
    const half = await decode((await buildAudioTrack(props({ voTrack: "vo.wav", voVolume: 0.5 }), publicDir, 3, workDir))!);
    expect(rms(half.left, 0.5, 2.5) / rms(full.left, 0.5, 2.5)).toBeCloseTo(0.5, 2);
    const dflt = await decode((await buildAudioTrack(props({ voTrack: "vo.wav", voVolume: 1 }), publicDir, 3, workDir))!);
    expect(rms(dflt.left, 0.5, 2.5)).toBeCloseTo(rms(full.left, 0.5, 2.5), 6);
  }, TIMEOUT);

  it("returns null when there is no audio at all", async () => {
    const { publicDir, workDir } = dirs();
    expect(await buildAudioTrack(props({}), publicDir, 3, workDir)).toBeNull();
  }, TIMEOUT);
});
