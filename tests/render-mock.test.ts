import { describe, it, expect } from "vitest";
import { renderVideo, renderStills } from "../src/render/render.js";
import { probeDuration } from "../src/media/ffmpeg.js";
import { generateMock } from "../src/avatar/heygen.js";
import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
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
      background: { kind: "glow", image: null, customCode: null, params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 }, keyframes: [], triggers: [] },
      disclosure: "test",
      segments: [
        {
          kind: "avatar",
          caption: "hello",
          startSec: 0,
          endSec: 2,
          captionKeyframes: [
            { at: 0, params: { y: 20, opacity: 0 } },
            { at: 0.5, params: { y: 0, opacity: 1 }, ease: "easeInOut" },
          ],
        },
      ],
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
      background: { kind: "glow", image: null, customCode: null, params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 }, keyframes: [], triggers: [] },
      disclosure: "test",
      segments: [{ kind: "avatar", caption: "on camera", startSec: 0, endSec: 2 }],
    };
    const outs = await renderVideo({ props, publicDir: outDir, formats: ["9:16"], outDir, title: "av" });
    expect(outs).toHaveLength(1);
    expect(await probeDuration(outs[0])).toBeCloseTo(2, 0);
  }, 180000);

  it("composites an app cut-in over the backdrop in avatar mode without crashing", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-rapp-"));
    await generateMock(join(outDir, "avatar.mp4"));
    await generateMock(join(outDir, "app.mp4")); // stand-in for the app screen recording
    const props: KinoProps = {
      theme,
      fps: 30,
      avatar: "avatar.mp4",
      avatarWindows: [{ fromSec: 0, toSec: 1, audioStartSec: 0 }],
      voTrack: null,
      logo: null,
      background: { kind: "mesh", image: null, customCode: null, params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 }, keyframes: [], triggers: [] },
      disclosure: "test",
      segments: [
        { kind: "avatar", caption: "hook", startSec: 0, endSec: 1 },
        { kind: "app", asset: "app.mp4", caption: "cut-in", startSec: 1, endSec: 2, shot: "static", transition: "fly-left" },
      ],
    };
    const outs = await renderVideo({ props, publicDir: outDir, formats: ["9:16"], outDir, title: "app" });
    expect(outs).toHaveLength(1);
    expect(await probeDuration(outs[0])).toBeCloseTo(2, 0);
  }, 180000);

  it("renders an app cut-in with clip window, speed, pauseAt, and chrome frame", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-rclip-"));
    await generateMock(join(outDir, "app.mp4"));
    mkdirSync(join(outDir, "frames"), { recursive: true });
    // 1×1 transparent PNG
    writeFileSync(
      join(outDir, "frames/chrome.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    const props: KinoProps = {
      theme,
      fps: 30,
      avatar: null,
      avatarWindows: [],
      voTrack: null,
      logo: null,
      background: { kind: "glow", image: null, customCode: null, params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 }, keyframes: [], triggers: [] },
      disclosure: "test",
      segments: [
        {
          kind: "app",
          asset: "app.mp4",
          caption: "sliced",
          startSec: 0,
          endSec: 2,
          shot: "static",
          transition: "cut",
          clipFrom: 0,
          clipTo: 1,
          speed: 0.5,
          pauseAt: 1.2,
          frame: { src: "frames/chrome.png", inset: { x: 10, y: 10, w: 80, h: 80 } },
        },
      ],
    };
    const outs = await renderVideo({ props, publicDir: outDir, formats: ["9:16"], outDir, title: "clip" });
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
      background: { kind: "mesh", image: null, customCode: null, params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 }, keyframes: [], triggers: [] },
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
      background: { kind: "glow", image: null, customCode: null, params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 }, keyframes: [], triggers: [] },
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
      background: { kind: "mesh", image: null, customCode: null, params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 }, keyframes: [], triggers: [] },
      disclosure: "test",
      segments: [{ kind: "avatar", caption: "hi", startSec: 0, endSec: 2 }],
    };
    const outs = await renderStills({ props, publicDir: outDir, format: "9:16", frames: [{ frame: 5, name: "a" }, { frame: 20, name: "b" }], outDir });
    expect(outs).toHaveLength(2);
    expect(outs.every((o) => existsSync(o) && o.endsWith(".png"))).toBe(true);
  }, 180000);

  it("renders stylised captions and standalone text overlays", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-rstyle-"));
    const props: KinoProps = {
      theme,
      fps: 30,
      avatar: null,
      avatarWindows: [],
      voTrack: null,
      logo: null,
      background: { kind: "glow", image: null, customCode: null, params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 }, keyframes: [], triggers: [] },
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
          captionStyle: "highlight",
          captionAnimation: "wave",
          texts: [{ text: "3× faster", fromSec: 0.2, durSec: 1.5, x: 50, y: 16, sizePx: 111, style: "gradient", animation: "blur-in" }],
        },
      ],
    };
    const outs = await renderVideo({ props, publicDir: outDir, formats: ["9:16"], outDir, title: "style" });
    expect(outs).toHaveLength(1);
    expect(await probeDuration(outs[0])).toBeCloseTo(2, 0);
  }, 180000);
});

describe("renderVideo with sfx + music", () => {
  it("renders an mp4 with sfx and a ducked music bed without crashing", async () => {
    const publicDir = mkdtempSync(join(tmpdir(), "kino-sfxpub-"));
    const outDir = mkdtempSync(join(tmpdir(), "kino-sfxout-"));
    await execa("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=880:duration=0.3", join(publicDir, "sfx-0.mp3")]);
    await execa("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=4", join(publicDir, "music.mp3")]);
    const props: KinoProps = {
      theme,
      fps: 30,
      avatar: null,
      avatarWindows: [],
      voTrack: null,
      logo: null,
      background: { kind: "glow", image: null, customCode: null, params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 }, keyframes: [], triggers: [] },
      disclosure: "test",
      sfx: [{ src: "sfx-0.mp3", at: 1.0, volume: 0.8 }],
      music: { src: "music.mp3", volume: 0.2, duck: 0.05, fadeOutSec: 1, duckSpans: [{ from: 0, to: 2 }] },
      segments: [
        { kind: "avatar", caption: "hello", startSec: 0, endSec: 3 },
      ],
    };
    const outs = await renderVideo({ props, publicDir, formats: ["9:16"], outDir, title: "sfx-check" });
    expect(outs.length).toBe(1);
    expect(existsSync(outs[0])).toBe(true);
    expect(await probeDuration(outs[0])).toBeCloseTo(3.0, 0);
  }, 120000);
});
