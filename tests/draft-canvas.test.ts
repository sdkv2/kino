// A draft renders the SAME composition onto a smaller canvas. The two things worth pinning are
// that the output really is 720p-class, and that it is a downscale rather than a reflow — a
// smaller canvas with the layout unchanged, not 74px captions on a 720px-tall frame.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderVideo } from "../src/render/render.js";
import { resolveDraftEdge } from "../src/render/native/engine.js";
import { scaledDims, DRAFT_SHORT_EDGE } from "../src/render/formats.js";
import { FFMPEG_PATH, FFPROBE_PATH } from "../src/media/binPaths.js";
import { magick } from "./magick.js";
import type { KinoProps } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
};

const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: {
    kind: "glow", image: null, customCode: null, shaderCode: null,
    params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 },
    keyframes: [], triggers: [],
  },
  disclosure: "draft",
  segments: [{ kind: "scene", caption: "the quick brown fox", startSec: 0, endSec: 1 }],
};

const videoDims = (mp4: string): { width: number; height: number } => {
  const out = execFileSync(FFPROBE_PATH, [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", mp4,
  ]).toString().trim();
  const [width, height] = out.split("x").map(Number);
  return { width, height };
};

const frameAt = (mp4: string, sec: number, png: string): string => {
  execFileSync(FFMPEG_PATH, ["-y", "-loglevel", "error", "-ss", String(sec), "-i", mp4, "-frames:v", "1", png]);
  return png;
};

describe("scaledDims", () => {
  it("puts the short edge at 720 in every orientation", () => {
    expect(scaledDims("16:9", 720)).toEqual({ width: 1280, height: 720 });
    expect(scaledDims("9:16", 720)).toEqual({ width: 720, height: 1280 });
    expect(scaledDims("3:4", 720)).toEqual({ width: 720, height: 960 });
  });

  it("collapses a 4k format onto the same preview canvas as its 1080 twin", () => {
    for (const base of ["9:16", "3:4", "16:9"] as const) {
      expect(scaledDims(`${base}-4k`, 720)).toEqual(scaledDims(base, 720));
    }
  });

  it("never upscales, and always lands on even edges (yuv420p)", () => {
    expect(scaledDims("16:9", 4000)).toEqual({ width: 1920, height: 1080 });
    for (const edge of [200, 300, 481, 719, 721, 1000]) {
      for (const fmt of ["9:16", "3:4", "16:9", "3:4-4k"] as const) {
        const d = scaledDims(fmt, edge);
        expect(d.width % 2).toBe(0);
        expect(d.height % 2).toBe(0);
      }
    }
  });
});

describe("resolveDraftEdge", () => {
  it("defaults to 720p", () => {
    expect(resolveDraftEdge({})).toBe(DRAFT_SHORT_EDGE);
    expect(resolveDraftEdge({ KINO_DRAFT_EDGE: "" })).toBe(DRAFT_SHORT_EDGE);
  });

  it("takes an explicit edge, and `off` for a full-size draft", () => {
    expect(resolveDraftEdge({ KINO_DRAFT_EDGE: "1080" })).toBe(1080);
    expect(resolveDraftEdge({ KINO_DRAFT_EDGE: "off" })).toBe(null);
    expect(resolveDraftEdge({ KINO_DRAFT_EDGE: "full" })).toBe(null);
    expect(resolveDraftEdge({ KINO_DRAFT_EDGE: "0" })).toBe(null);
  });

  it("rejects a typo rather than silently rendering at some other size", () => {
    expect(() => resolveDraftEdge({ KINO_DRAFT_EDGE: "720p" })).toThrow(/pixel count/);
    expect(() => resolveDraftEdge({ KINO_DRAFT_EDGE: "32" })).toThrow(/pixel count/);
  });
});

describe("draft render", () => {
  it("writes a 720p-class mp4 that is the full composition downscaled, not reflowed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-draft-"));
    const [draft] = await renderVideo({
      props, publicDir: dir, formats: ["9:16"], outDir: dir, title: "d", preset: "veryfast", draft: true,
    });
    expect(videoDims(draft)).toEqual({ width: 720, height: 1280 });

    const [full] = await renderVideo({
      props, publicDir: dir, formats: ["9:16"], outDir: dir, title: "f", preset: "veryfast", draft: false,
    });
    expect(videoDims(full)).toEqual({ width: 1080, height: 1920 });

    // Same frame from each: the draft should match the full render resampled to 720p. A reflow
    // (captions at their authored px on a smaller canvas) would blow well past this.
    const a = frameAt(draft, 0.5, join(dir, "draft.png"));
    const b = frameAt(full, 0.5, join(dir, "full.png"));
    const shrunk = join(dir, "full-720.png");
    magick([b, "-resize", "720x1280!", "-strip", shrunk]);
    const rmse = parseFloat(
      magick([a, shrunk, "-metric", "RMSE", "-compare", "-format", "%[distortion]", "info:"]).trim(),
    );
    expect(rmse).toBeLessThan(0.05);
  }, 300000);
});
