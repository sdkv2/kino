import { describe, it, expect } from "vitest";
import { genSilence, probeDuration, stitchAudio, extractAudio, extractFrame, trailingArtifactCut, trimAudio } from "../src/media/ffmpeg.js";
import { execa } from "execa";
import { FFMPEG_PATH } from "../src/media/binPaths.js";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Every test here shells out to ffmpeg (several spawns each: synthesize, concat, probe), so they
// need an integration-sized timeout rather than vitest's 5s default. The work is tens of
// milliseconds locally; the budget is headroom for a loaded or IO-starved CI runner, where
// process spawns stall far longer than the work itself takes.
const FFMPEG_TIMEOUT = 30000;

// Build a mono 44.1k mp3 from a sequence of parts: {tone: sec} = 440 Hz sine, {sil: sec} = silence.
// aformat forces a uniform stream so concat doesn't choke on channel-layout mismatches.
async function makeClip(parts: Array<{ tone?: number; sil?: number }>, out: string) {
  const inputs: string[] = [];
  const chain: string[] = [];
  parts.forEach((p, i) => {
    inputs.push("-f", "lavfi", "-i",
      p.tone != null ? `sine=frequency=440:duration=${p.tone}` : `aevalsrc=0:d=${p.sil}:s=44100`);
    chain.push(`[${i}:a]aformat=sample_rates=44100:channel_layouts=mono[a${i}]`);
  });
  const cat = parts.map((_, i) => `[a${i}]`).join("") + `concat=n=${parts.length}:v=0:a=1[o]`;
  await execa(FFMPEG_PATH, ["-y", "-loglevel", "error", ...inputs,
    "-filter_complex", `${chain.join(";")};${cat}`, "-map", "[o]",
    "-c:a", "libmp3lame", "-b:a", "128k", out]);
}

describe("ffmpeg helpers", () => {
  it("generates silence of a known duration and probes it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-ff-"));
    const a = join(dir, "a.mp3");
    await genSilence(1.0, a);
    expect(await probeDuration(a)).toBeCloseTo(1.0, 1);
  }, FFMPEG_TIMEOUT);
  it("stitches clips with gaps and the total length adds up", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-ff2-"));
    const a = join(dir, "a.mp3");
    const b = join(dir, "b.mp3");
    const out = join(dir, "out.mp3");
    await genSilence(1.0, a);
    await genSilence(2.0, b);
    await stitchAudio([a, b], 0.5, out);
    expect(await probeDuration(out)).toBeCloseTo(3.5, 1);
  }, FFMPEG_TIMEOUT);
  it("stitches a stereo 48k voFile at its true length (regression: stereo read as mono = 2x)", async () => {
    // The concat demuxer keeps the first input's stream params; before stitchAudio pinned every
    // faded clip to mono/44100, a stereo or off-rate imported voFile was misread frame-for-frame
    // and played at 2x its length, an octave down.
    const dir = mkdtempSync(join(tmpdir(), "kino-ff3-"));
    const mono = join(dir, "mono.mp3");
    const stereo = join(dir, "stereo.wav");
    const out = join(dir, "out.mp3");
    await genSilence(1.0, mono);
    await execa(FFMPEG_PATH, ["-y", "-loglevel", "error",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-af", "aformat=sample_rates=48000:channel_layouts=stereo", stereo]);
    await stitchAudio([mono, stereo], 0.5, out);
    expect(await probeDuration(out)).toBeCloseTo(3.5, 1);
  }, FFMPEG_TIMEOUT);

  it("extracts a mono wav from a video with audio", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-xa-"));
    const v = join(dir, "v.mp4");
    const wav = join(dir, "a.wav");
    // a 2s clip that actually has an audio stream
    await execa(FFMPEG_PATH, ["-y", "-loglevel", "error",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=30",
      "-pix_fmt", "yuv420p", "-shortest", v]);
    await extractAudio(v, wav);
    expect(await probeDuration(wav)).toBeCloseTo(2.0, 1);
  }, FFMPEG_TIMEOUT);

  it("trims a clip to a given end second", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-trim-"));
    const src = join(dir, "s.mp3");
    const out = join(dir, "o.wav");
    await makeClip([{ tone: 1.0 }], src);
    await trimAudio(src, 0.4, out);
    expect(await probeDuration(out)).toBeCloseTo(0.4, 1);
  }, FFMPEG_TIMEOUT);

  describe("trailingArtifactCut", () => {
    it("cuts at the last silence gap when a short burst trails it (the ElevenLabs artifact)", async () => {
      const dir = mkdtempSync(join(tmpdir(), "kino-tac1-"));
      const clip = join(dir, "c.mp3"); // speech | 150ms silence | 60ms burst
      await makeClip([{ tone: 0.5 }, { sil: 0.15 }, { tone: 0.06 }], clip);
      const cut = await trailingArtifactCut(clip);
      expect(cut).not.toBeNull();
      expect(cut!).toBeCloseTo(0.5, 1); // cut at the gap start, dropping the burst
      expect(cut!).toBeLessThan(await probeDuration(clip));
    }, FFMPEG_TIMEOUT);

    it("returns null when the clip already ends in silence", async () => {
      const dir = mkdtempSync(join(tmpdir(), "kino-tac2-"));
      const clip = join(dir, "c.mp3"); // speech | 200ms trailing silence
      await makeClip([{ tone: 0.5 }, { sil: 0.2 }], clip);
      expect(await trailingArtifactCut(clip)).toBeNull();
    }, FFMPEG_TIMEOUT);

    it("protects a real final word (long trailing audio after a pause is not trimmed)", async () => {
      const dir = mkdtempSync(join(tmpdir(), "kino-tac3-"));
      const clip = join(dir, "c.mp3"); // speech | 100ms pause | 500ms final word (> 250ms guard)
      await makeClip([{ tone: 0.3 }, { sil: 0.1 }, { tone: 0.5 }], clip);
      expect(await trailingArtifactCut(clip)).toBeNull();
    }, FFMPEG_TIMEOUT);
  });

  it("extracts a single frame at a timestamp", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-xf-"));
    const v = join(dir, "v.mp4");
    const png = join(dir, "f.png");
    await execa(FFMPEG_PATH, ["-y", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=30", "-pix_fmt", "yuv420p", v]);
    await extractFrame(v, 1.0, png);
    expect(existsSync(png)).toBe(true);
  }, FFMPEG_TIMEOUT);
});
