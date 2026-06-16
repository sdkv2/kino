import { describe, it, expect } from "vitest";
import { transcribe } from "../src/commands/transcribe.js";
import { scan } from "../src/commands/scan.js";
import { execa } from "execa";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("transcribe --mock", () => {
  it("returns a well-formed transcript offline (no ffmpeg/network)", async () => {
    const t = await transcribe("does-not-exist.mp4", { mock: true });
    expect(t.words.length).toBeGreaterThan(0);
    expect(t.segments.length).toBe(2); // mock text has two sentences
    expect(t.text).toContain("mock");
    // monotonic word times
    for (let i = 1; i < t.words.length; i++) expect(t.words[i].start).toBeGreaterThanOrEqual(t.words[i - 1].start);
  });
});

describe("scan --mock", () => {
  it("writes a transcript, one frame per segment, and a montage", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-scan-"));
    const v = join(dir, "clip.mp4");
    await execa("ffmpeg", ["-y", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=30", "-pix_fmt", "yuv420p", v]);
    const r = await scan(v, { mock: true, out: join(dir, "scan") });
    expect(existsSync(r.transcriptPath)).toBe(true);
    expect(r.frames).toHaveLength(2); // mock transcript has two segments
    expect(r.frames.every((f) => existsSync(f))).toBe(true);
    expect(existsSync(r.montagePath)).toBe(true);
  }, 60000);
});
