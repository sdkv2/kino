import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSegment } from "../src/segment/segment.js";
import { readManifest } from "../src/segment/manifest.js";
import { FFMPEG_PATH } from "../src/media/binPaths.js";
import { magick } from "./magick.js";

function writeTestPhoto(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  execFileSync(FFMPEG_PATH, [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=red:s=200x300",
    "-frames:v", "1",
    path,
  ]);
}

describe("segment cutout", () => {
  it("writes mask.png by default", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "kino-cutout-"));
    const photo = join(projectRoot, "assets", "photo.jpg");
    writeTestPhoto(photo);
    const res = await runSegment({
      input: photo,
      prompt: "the subject",
      backend: "mock",
      projectRoot,
    });
    expect(existsSync(join(res.outDir, "mask.png"))).toBe(true);
    expect(readManifest(res.outDir).cutout).toBeUndefined();
    expect(existsSync(join(projectRoot, "assets", "cutouts", "photo.png"))).toBe(false);
  });

  it("--cutout also writes a transparent subject PNG and records it in the manifest", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "kino-cutout-"));
    const photo = join(projectRoot, "assets", "photo.jpg");
    writeTestPhoto(photo);
    const res = await runSegment({
      input: "photo.jpg",
      prompt: "the subject",
      backend: "mock",
      projectRoot,
      cutout: true,
    });
    const cutout = join(projectRoot, "assets", "cutouts", "photo.png");
    expect(existsSync(join(res.outDir, "mask.png"))).toBe(true);
    expect(existsSync(cutout)).toBe(true);
    expect(readManifest(res.outDir).cutout).toBe("cutouts/photo.png");

    const alpha = magick([cutout, "-format", "%[fx:mean.a]", "info:"]).trim();
    expect(Number(alpha)).toBeGreaterThan(0.05);
    expect(Number(alpha)).toBeLessThan(0.95);
  });

  it("--cutout --no-mask drops mask.png but keeps the cutout asset", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "kino-cutout-"));
    const photo = join(projectRoot, "assets", "hero.png");
    writeTestPhoto(photo);
    const res = await runSegment({
      input: "hero.png",
      prompt: "the subject",
      backend: "mock",
      out: "presenter",
      projectRoot,
      cutout: true,
      noMask: true,
    });
    expect(existsSync(join(res.outDir, "mask.png"))).toBe(false);
    expect(existsSync(join(projectRoot, "assets", "cutouts", "presenter.png"))).toBe(true);
  });

  it("rejects --no-mask without --cutout", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "kino-cutout-"));
    await expect(runSegment({
      input: "photo.jpg",
      prompt: "x",
      backend: "mock",
      projectRoot,
      noMask: true,
    })).rejects.toThrow(/mask or --cutout/);
  });

  it("rejects --cutout on video inputs", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "kino-cutout-"));
    await expect(runSegment({
      input: "clip.mp4",
      prompt: "x",
      backend: "mock",
      projectRoot,
      cutout: true,
    })).rejects.toThrow(/image-only/);
  });
});
