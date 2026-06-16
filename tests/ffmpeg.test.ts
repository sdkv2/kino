import { describe, it, expect } from "vitest";
import { genSilence, probeDuration, stitchAudio, extractAudio, extractFrame } from "../src/media/ffmpeg.js";
import { execa } from "execa";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("ffmpeg helpers", () => {
  it("generates silence of a known duration and probes it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-ff-"));
    const a = join(dir, "a.mp3");
    await genSilence(1.0, a);
    expect(await probeDuration(a)).toBeCloseTo(1.0, 1);
  });
  it("stitches clips with gaps and the total length adds up", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-ff2-"));
    const a = join(dir, "a.mp3");
    const b = join(dir, "b.mp3");
    const out = join(dir, "out.mp3");
    await genSilence(1.0, a);
    await genSilence(2.0, b);
    await stitchAudio([a, b], 0.5, out);
    expect(await probeDuration(out)).toBeCloseTo(3.5, 1);
  });

  it("extracts a mono wav from a video with audio", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-xa-"));
    const v = join(dir, "v.mp4");
    const wav = join(dir, "a.wav");
    // a 2s clip that actually has an audio stream
    await execa("ffmpeg", ["-y", "-loglevel", "error",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=30",
      "-pix_fmt", "yuv420p", "-shortest", v]);
    await extractAudio(v, wav);
    expect(await probeDuration(wav)).toBeCloseTo(2.0, 1);
  });

  it("extracts a single frame at a timestamp", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-xf-"));
    const v = join(dir, "v.mp4");
    const png = join(dir, "f.png");
    await execa("ffmpeg", ["-y", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=30", "-pix_fmt", "yuv420p", v]);
    await extractFrame(v, 1.0, png);
    expect(existsSync(png)).toBe(true);
  });
});
