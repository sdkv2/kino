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
import { buildAudioTrack, frameRmsEnvelope } from "../src/render/native/audioMix.js";
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
  ({ voTrack: null, sfx: [], music: null, fps: 30, ...over }) as KinoProps;

/** buildAudioTrack now returns { track, envelope }; tests that only want the wav unwrap it. */
const track = async (...a: Parameters<typeof buildAudioTrack>) =>
  (await buildAudioTrack(...a)).track;


describe("buildAudioTrack (real ffmpeg)", () => {
  it("gates the bed to silence at a keyframe, and ducking cannot lift it back", async () => {
    const { publicDir, workDir } = dirs();
    await tone(publicDir, "bed.wav", 220, 6);
    // Bed at 0.5 until 3s, gated to 0 by 3.5s. A VO span sits at 4–5s with duck ABOVE the gate
    // (0.4): the gate has to win, which is the whole point of resolving ducking with a Math.min
    // against the keyframed level rather than against the authored base.
    const out = await track(
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
    const one = await track(props({ music: [bed({ volume: 0.25 })] }), publicDir, 4, workDir);
    const oneRms = rms((await decode(one!)).left, 0.5, 3.5);
    const two = await track(
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
    const out = await track(props({ sfx }), publicDir, 3, workDir);
    const pcm = await decode(out!);
    const l = rms(pcm.left, 1.05, 1.45);
    const r = rms(pcm.right, 1.05, 1.45);
    expect(l).toBeGreaterThan(0.1);
    expect(r).toBeLessThan(l * 0.01);
    // Constant power, unity at centre: the live channel is +3 dB (×√2) of what an unpanned copy
    // of the same event puts in it.
    const flat = await track(props({ sfx: [{ src: "hit.wav", at: 1, volume: 0.6 }] }), publicDir, 3, workDir);
    expect(l / rms((await decode(flat!)).left, 1.05, 1.45)).toBeCloseTo(Math.SQRT2, 1);
  }, TIMEOUT);

  it("varispeeds an effect — pitch up, length down — without moving its start", async () => {
    const { publicDir, workDir } = dirs();
    await tone(publicDir, "hit.wav", 440, 1.0);
    const plain = await decode((await track(props({ sfx: [{ src: "hit.wav", at: 1, volume: 0.8 }] }), publicDir, 3, workDir))!);
    const fast = await decode(
      (await track(props({ sfx: [{ src: "hit.wav", at: 1, volume: 0.8, rate: 2 }] }), publicDir, 3, workDir))!,
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
    const full = await decode((await track(props({ voTrack: "vo.wav" }), publicDir, 3, workDir))!);
    const half = await decode((await track(props({ voTrack: "vo.wav", voVolume: 0.5 }), publicDir, 3, workDir))!);
    expect(rms(half.left, 0.5, 2.5) / rms(full.left, 0.5, 2.5)).toBeCloseTo(0.5, 2);
    const dflt = await decode((await track(props({ voTrack: "vo.wav", voVolume: 1 }), publicDir, 3, workDir))!);
    expect(rms(dflt.left, 0.5, 2.5)).toBeCloseTo(rms(full.left, 0.5, 2.5), 6);
  }, TIMEOUT);

  it("fades an event's head in and its tail out, in played seconds", async () => {
    const { publicDir, workDir } = dirs();
    await tone(publicDir, "hit.wav", 440, 1.0);
    const out = await track(
      props({ sfx: [{ src: "hit.wav", at: 1, volume: 0.8, fadeInSec: 0.2, fadeOutSec: 0.3 }] }),
      publicDir,
      3,
      workDir,
    );
    const pcm = await decode(out!);
    // Fade-in: the very head is near-silent, rising across the first 0.2s.
    expect(rms(pcm.left, 1.0, 1.04)).toBeLessThan(rms(pcm.left, 1.12, 1.16));
    // Full level in the middle (0.5 amp × 0.8 volume = 0.4 peak, RMS = 0.4/√2).
    const mid = rms(pcm.left, 1.25, 1.5);
    expect(mid).toBeCloseTo(0.2828, 1);
    // Fade-out: the tail is below the middle, and the LAST 0.1s is far quieter than the mid.
    expect(rms(pcm.left, 1.85, 1.95)).toBeLessThan(mid * 0.5);
    expect(rms(pcm.left, 1.96, 1.99)).toBeLessThan(mid * 0.15);
    // The event still ENDS at its own length (1s source + at=1) — a fade must not extend it.
    expect(offsetSec(pcm.left, 0.01)).toBeLessThan(2.05);
  }, TIMEOUT);

  it("scales a fade with rate — a 2× event's fades are half as long in wall time", async () => {
    const { publicDir, workDir } = dirs();
    await tone(publicDir, "hit.wav", 440, 1.0);
    const fast = await decode(
      (await track(props({ sfx: [{ src: "hit.wav", at: 1, volume: 0.8, rate: 2, fadeOutSec: 0.4 }] }), publicDir, 3, workDir))!,
    );
    // The event is 0.5s long at 2×; a 0.4s fade-out occupies nearly all of it, so the tail
    // decays across the whole second half — the last 0.1s must be quieter than the middle.
    const mid = rms(fast.left, 1.05, 1.25);
    expect(rms(fast.left, 1.4, 1.48)).toBeLessThan(mid * 0.5);
  }, TIMEOUT);

  it("returns null when there is no audio at all", async () => {
    const { publicDir, workDir } = dirs();
    expect(await track(props({}), publicDir, 3, workDir)).toBeNull();
  }, TIMEOUT);

  it("returns a per-frame envelope of the final mix, one entry per composition frame", async () => {
    const { publicDir, workDir } = dirs();
    await tone(publicDir, "bed.wav", 220, 4);
    const { track: t, envelope } = await buildAudioTrack(
      props({ music: [bed({ volume: 0.5 })] }),
      publicDir,
      2,
      workDir,
    );
    expect(t).not.toBeNull();
    // fps defaults to 30 in the props helper's cast — 2s × 30 = 60 frames.
    expect(envelope).toHaveLength(60);
    // The bed plays at constant level, so the envelope is flat (not zero) across the timeline…
    const mid = envelope!.slice(10, 50);
    expect(Math.min(...mid)).toBeGreaterThan(0.05);
    // …and its magnitude matches the audible level: 0.5 amp × 0.5 bed = 0.25 peak, RMS ≈ 0.177.
    expect(mid.reduce((a, b) => a + b, 0) / mid.length).toBeCloseTo(0.177, 1);
  }, TIMEOUT);

  it("returns null envelope when there is no audio at all", async () => {
    const { publicDir, workDir } = dirs();
    const { track: t, envelope } = await buildAudioTrack(props({}), publicDir, 3, workDir);
    expect(t).toBeNull();
    expect(envelope).toBeNull();
  }, TIMEOUT);
});

describe("frameRmsEnvelope (pure)", () => {
  // A synthetic stereo s16le buffer: one channel a steady tone, the other silent.
  function tonePcm(rate: number, sec: number, amp: number, hz: number): Buffer {
    const buf = Buffer.alloc(sec * rate * 2 * 2);
    for (let i = 0; i < sec * rate; i++) {
      const v = Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * amp * 32767);
      buf.writeInt16LE(v, i * 4);
    }
    return buf;
  }

  it("is 0 for silence and RMS for a tone", () => {
    const silent = Buffer.alloc(44100 * 2 * 2 * 1); // 1s stereo silence
    expect(frameRmsEnvelope(silent, 44100, 1, 30).every((v) => v === 0)).toBe(true);
    const tone = tonePcm(44100, 1, 0.5, 440);
    const env = frameRmsEnvelope(tone, 44100, 1, 30);
    // A sine's RMS is amp/√2, in BOTH channels (the left channel carries it, right is 0) —
    // channel-averaged power halves the energy, so total RMS = (amp/√2)·√(1/2) = amp/2.
    expect(env[10]).toBeCloseTo(0.25, 2);
  });

  it("buckets each frame to its own window", () => {
    // 1s at 10fps: 10 frames of 100ms each. A tone only in the second half → frames 0-4 silent.
    const rate = 1000; // 1000 samples/sec, 100 samples per frame
    const tone = Buffer.alloc(rate * 2 * 2 * 1);
    for (let i = 500; i < 1000; i++) {
      const v = Math.round(Math.sin((2 * Math.PI * 10 * i) / rate) * 0.5 * 32767);
      tone.writeInt16LE(v, i * 4);
    }
    const env = frameRmsEnvelope(tone, rate, 1, 10);
    expect(env[0]).toBe(0);
    expect(env[4]).toBe(0);
    expect(env[9]).toBeGreaterThan(0.1);
  });

  it("clamps short tails to the buffer length instead of inventing samples", () => {
    const rate = 100;
    const halfSec = Buffer.alloc(rate * 2 * 2 * 0.5);
    const env = frameRmsEnvelope(halfSec, rate, 1, 10);
    expect(env).toHaveLength(10);
    expect(env[9]).toBe(0); // no samples in the second half — RMS of nothing is 0
  });
});
