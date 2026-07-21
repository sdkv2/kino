import { describe, it, expect } from "vitest";
import { frames } from "../src/commands/frames.js";
import { execa } from "execa";
import { FFMPEG_PATH } from "../src/media/binPaths.js";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A 3s test clip with no audio — enough to exercise frame extraction.
async function testClip(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "kino-frtest-"));
  const v = join(dir, "clip.mp4");
  await execa(FFMPEG_PATH, ["-y", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=30", "-pix_fmt", "yuv420p", v]);
  return v;
}

describe("frames command", () => {
  it("extracts N frames with --count (not a single frame at 0s)", async () => {
    const v = await testClip();
    const out = mkdtempSync(join(tmpdir(), "kino-frout-"));
    await frames(v, { count: "3", out });
    const pngs = readdirSync(out).filter((f) => f.endsWith(".png"));
    expect(pngs).toHaveLength(3);
  }, 60000);

  it("extracts frames spaced with --every", async () => {
    const v = await testClip();
    const out = mkdtempSync(join(tmpdir(), "kino-frout2-"));
    await frames(v, { every: "1", out });
    const pngs = readdirSync(out).filter((f) => f.endsWith(".png"));
    expect(pngs.length).toBeGreaterThanOrEqual(2);
  }, 60000);
});
