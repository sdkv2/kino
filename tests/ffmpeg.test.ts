import { describe, it, expect } from "vitest";
import { genSilence, probeDuration, stitchAudio } from "../src/media/ffmpeg.js";
import { mkdtempSync } from "node:fs";
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
});
