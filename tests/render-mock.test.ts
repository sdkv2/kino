import { describe, it, expect } from "vitest";
import { renderVideo, renderStills } from "../src/render/render.js";
import { probeDuration } from "../src/media/ffmpeg.js";
import { generateMock } from "../src/avatar/heygen.js";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9 };

describe("renderVideo", () => {
  it("renders a faceless 9:16 mp4 from caption-only segments", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-r-"));
    const props: KinoProps = {
      theme,
      fps: 30,
      avatar: null,
      avatarWindows: [],
      voTrack: null,
      logo: null,
      background: { kind: "glow", image: null, customCode: null, colors: ["#80e2b4", "#0c8d64", "#d99a20"], intensity: 0.5 },
      disclosure: "test",
      segments: [{ kind: "avatar", caption: "hello", startSec: 0, endSec: 2 }],
    };
    const outs = await renderVideo({ props, publicDir: outDir, formats: ["9:16"], outDir, title: "t" });
    expect(outs).toHaveLength(1);
    expect(await probeDuration(outs[0])).toBeCloseTo(2, 0);
  }, 180000);

  it("places a trimmed avatar clip in its window without crashing", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-rav-"));
    await generateMock(join(outDir, "avatar.mp4")); // staticFile reads avatar.mp4 from publicDir
    const props: KinoProps = {
      theme,
      fps: 30,
      avatar: "avatar.mp4",
      avatarWindows: [{ fromSec: 0, toSec: 2, audioStartSec: 0 }],
      voTrack: null,
      logo: null,
      background: { kind: "glow", image: null, customCode: null, colors: ["#80e2b4", "#0c8d64", "#d99a20"], intensity: 0.5 },
      disclosure: "test",
      segments: [{ kind: "avatar", caption: "on camera", startSec: 0, endSec: 2 }],
    };
    const outs = await renderVideo({ props, publicDir: outDir, formats: ["9:16"], outDir, title: "av" });
    expect(outs).toHaveLength(1);
    expect(await probeDuration(outs[0])).toBeCloseTo(2, 0);
  }, 180000);

  it("renders an animated canvas-preset background", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-rbg-"));
    const props: KinoProps = {
      theme,
      fps: 30,
      avatar: null,
      avatarWindows: [],
      voTrack: null,
      logo: null,
      background: { kind: "mesh", image: null, customCode: null, colors: ["#80e2b4", "#0c8d64", "#d99a20"], intensity: 0.6 },
      disclosure: "test",
      segments: [{ kind: "avatar", caption: "hello", startSec: 0, endSec: 2 }],
    };
    const outs = await renderVideo({ props, publicDir: outDir, formats: ["9:16"], outDir, title: "bg" });
    expect(outs).toHaveLength(1);
    expect(await probeDuration(outs[0])).toBeCloseTo(2, 0);
  }, 180000);

  it("renders word-synced captions (words mode)", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-rwc-"));
    const props: KinoProps = {
      theme,
      fps: 30,
      avatar: null,
      avatarWindows: [],
      voTrack: null,
      logo: null,
      background: { kind: "glow", image: null, customCode: null, colors: ["#80e2b4", "#0c8d64", "#d99a20"], intensity: 0.5 },
      disclosure: "test",
      segments: [
        {
          kind: "avatar",
          caption: "hi",
          startSec: 0,
          endSec: 2,
          captionMode: "words",
          words: [{ word: "hello", start: 0, end: 0.6 }, { word: "world", start: 0.7, end: 1.4 }],
          emphasis: ["world"],
        },
      ],
    };
    const outs = await renderVideo({ props, publicDir: outDir, formats: ["9:16"], outDir, title: "wc" });
    expect(outs).toHaveLength(1);
    expect(await probeDuration(outs[0])).toBeCloseTo(2, 0);
  }, 180000);

  it("renders individual still frames (no encode)", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-still-"));
    const props: KinoProps = {
      theme,
      fps: 30,
      avatar: null,
      avatarWindows: [],
      voTrack: null,
      logo: null,
      background: { kind: "mesh", image: null, customCode: null, colors: ["#80e2b4", "#0c8d64", "#d99a20"], intensity: 0.5 },
      disclosure: "test",
      segments: [{ kind: "avatar", caption: "hi", startSec: 0, endSec: 2 }],
    };
    const outs = await renderStills({ props, publicDir: outDir, format: "9:16", frames: [{ frame: 5, name: "a" }, { frame: 20, name: "b" }], outDir });
    expect(outs).toHaveLength(2);
    expect(outs.every((o) => existsSync(o) && o.endsWith(".png"))).toBe(true);
  }, 180000);
});
