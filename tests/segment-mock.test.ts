import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockBackend } from "../src/segment/mock.js";
import { readManifest } from "../src/segment/manifest.js";
import { FFMPEG_PATH } from "../src/media/binPaths.js";
import { magick } from "./magick.js";

describe("mock backend", () => {
  it("produces a mask.png + manifest for an image input", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-mock-"));
    // track:true requested, but the mock never tracks — manifest must still report tracked:false.
    const res = await mockBackend.run({ input: "photo.png", prompt: "the cat", objects: 1, track: true, outDir });
    expect(existsSync(join(outDir, "mask.png"))).toBe(true);
    const m = readManifest(outDir);
    expect(m.kind).toBe("image");
    expect(m.backend).toBe("mock");
    expect(m.objects[0].label).toBe("the cat");
    expect(m.tracked).toBe(false);
  });

  it("writes a video mask that actually decodes GRAYSCALE", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-mock-vid-"));
    await mockBackend.run({ input: "clip.mp4", prompt: "the cat", objects: 1, track: false, outDir });
    const frame = join(outDir, "probe.png");
    execFileSync(FFMPEG_PATH, ["-y", "-loglevel", "error", "-i", join(outDir, "mask.mp4"), "-frames:v", "1", frame]);

    // A one-object mask must be R=G=B so it rides luma — h264 4:2:0 would otherwise soften its
    // edges through chroma. It regressed once: geq fills only the planes it is given an
    // expression for, so a lum-only filter left chroma from the source and the mask decoded
    // green, reading 73/255 inside the ellipse — invisible to any consumer thresholding at 0.5.
    const px = (x: number, y: number) =>
      magick([frame, "-format", `%[fx:255*p{${x},${y}}.r] %[fx:255*p{${x},${y}}.g] %[fx:255*p{${x},${y}}.b]`, "info:"])
        .trim().split(/\s+/).map(Number);

    const [ir, ig, ib] = px(540, 960); // centre — inside the ellipse
    const [or_, og, ob] = px(20, 20); //  corner — outside it
    expect(ir).toBeGreaterThan(230);
    expect(or_).toBeLessThan(25);
    // Grayscale means the channels agree; a colour cast is the actual failure mode seen.
    expect(Math.max(Math.abs(ir - ig), Math.abs(ir - ib))).toBeLessThan(12);
    expect(Math.max(Math.abs(or_ - og), Math.abs(or_ - ob))).toBeLessThan(12);
    // The mock encodes 2s of 1080x1920 — over vitest's 5s default once the suite runs it in
    // parallel with the render tests.
  }, 60000);
});
