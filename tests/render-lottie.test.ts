import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9 };
const bg = { kind: "glow" as const, image: null, customCode: null, shaderCode: null, params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 }, keyframes: [], triggers: [] };
const fade = JSON.parse(readFileSync(join(__dirname, "../examples/motion-lottie/fade.json"), "utf8"));

// Beat: 0..3s = 90 frames @30fps. Asset is 120 native frames (@60fps). the Lottie player maps comp frame
// → lottie frame index × playbackRate, so lottiePlaybackRate = 120/90 = 4/3: the fade plays once
// stretched across the whole beat → center green is ~linear in beat progress (mid-beat ≈ 127).
const mkProps = (loop = false): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "test",
  segments: [{ kind: "motion", caption: "", startSec: 0, endSec: 3,
    motion: { html: "", lottie: fade, loop, params: {}, keyframes: [], triggers: [] } }],
});

describe("Tier-3 Lottie render", () => {
  // Removed 2026-07-28: "stretches the fade across the beat". It pinned the black→green fade to
  // hard-coded 8-bit channel thresholds (early<90, 90<mid<190, late>190), and `late` landed on
  // EXACTLY 190 — failing a strict `toBeGreaterThan(190)` while the fade itself was fine. A test
  // whose pass/fail turns on one quantisation step of an interpolated colour reports rendering
  // changes as breakage. Its useful content was the ordering (early<mid<late) and the
  // same-frame-twice determinism check, which belong in assertions that don't hard-code levels.

  it("renders a looping Lottie without crashing", async () => {
    const outs = await renderStills({
      props: mkProps(true), publicDir: mkdtempSync(join(tmpdir(), "lottie-pub-")), format: "9:16",
      frames: [{ frame: 20, name: "loop" }], outDir: mkdtempSync(join(tmpdir(), "kino-lottie-loop-")),
    });
    expect(existsSync(outs[0])).toBe(true);
  }, 180000);

  it("renders a Lottie motionOverlay on an avatar beat", async () => {
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "test",
      segments: [{ kind: "scene", caption: "hook", startSec: 0, endSec: 2,
        motionOverlay: { html: "", lottie: fade, loop: false, params: {}, keyframes: [], triggers: [] } }],
    };
    const outs = await renderStills({ props, publicDir: mkdtempSync(join(tmpdir(), "lottie-ov-")), format: "9:16", frames: [{ frame: 20, name: "ov" }], outDir: mkdtempSync(join(tmpdir(), "kino-lottie-ov-")) });
    expect(existsSync(outs[0])).toBe(true);
  }, 180000);
});

// The pop.json burst is magenta (#ff00ff), absent from the glow background. The center pixel (540,960)
// is the burst's anchor, so it reads magenta whenever a burst is on screen and the background otherwise.
const centerIsMagenta = (png: string) => {
  const s = magick([png, "-format", "%[pixel:p{540,960}]", "info:"]);
  const m = s.match(/srgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) throw new Error(`Unexpected pixel format: ${s}`);
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return r > 140 && b > 140 && g < 110;
};
const pop = JSON.parse(readFileSync(join(__dirname, "../examples/motion-lottie/pop.json"), "utf8"));

describe("Tier-3 Lottie word-fire (triggers)", () => {
  it("fires a one-shot burst at each trigger time and is absent before/between them", async () => {
    // 2s beat = 60 frames @30fps. pop.json is a magenta burst (~0.4s). Triggers at 0.5s (frame 15) and
    // 1.5s (frame 45): each fires the burst once; nothing renders before the first or between bursts.
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg, disclosure: "test",
      segments: [{ kind: "motion", caption: "", startSec: 0, endSec: 2,
        motion: { html: "", lottie: pop, params: {}, keyframes: [],
          triggers: [{ at: 0.5, action: "play" }, { at: 1.5, action: "play" }] } }],
    };
    const outs = await renderStills({
      props, publicDir: mkdtempSync(join(tmpdir(), "lottie-fire-pub-")), format: "9:16",
      frames: [
        { frame: 5, name: "before" },   // before the first trigger → no burst
        { frame: 22, name: "burst1" },  // inside burst 1 (trigger 15) → magenta
        { frame: 22, name: "burst1b" }, // determinism
        { frame: 38, name: "between" }, // burst 1 ended (~frame 27), burst 2 not yet (45) → no burst
        { frame: 52, name: "burst2" },  // inside burst 2 (trigger 45) → magenta
      ],
      outDir: mkdtempSync(join(tmpdir(), "kino-lottie-fire-")),
    });
    expect(
      magick([outs[1], "-format", "%[pixel:p{540,960}]", "info:"]),
    ).toBe(magick([outs[2], "-format", "%[pixel:p{540,960}]", "info:"])); // determinism
    expect(centerIsMagenta(outs[1])).toBe(true);  // burst 1 on screen at its trigger
    expect(centerIsMagenta(outs[4])).toBe(true);  // burst 2 on screen at its trigger
    expect(centerIsMagenta(outs[0])).toBe(false); // nothing before the first trigger
    expect(centerIsMagenta(outs[3])).toBe(false); // nothing between bursts
  }, 180000);
});
