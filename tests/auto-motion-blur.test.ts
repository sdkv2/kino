import { describe, it, expect } from "vitest";
import { layersAt } from "../src/render/layers.js";
import type { KinoProps, KinoSegment } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
};
const bg = { kind: "glow" as const, image: null, customCode: null, shaderCode: null, params: {}, keyframes: [], triggers: [] };
const DIMS = { width: 1080, height: 1920 };

/** One footage beat carrying a zoom track, so the segment layer has a real camera to measure. */
const mk = (zoomKeyframes: KinoSegment["zoomKeyframes"], motionBlur?: boolean): KinoProps =>
  ({
    theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
    background: bg, disclosure: "",
    ...(motionBlur === undefined ? {} : { motionBlur }),
    segments: [
      { kind: "video", startSec: 0, endSec: 2, source: "a.mp4", zoomKeyframes } as unknown as KinoSegment,
    ],
  }) as KinoProps;

const blurOf = (p: KinoProps, frame: number) =>
  layersAt(p, frame, DIMS).find((l) => l.id === "seg0")?.effects?.find((e) => e.kind === "motionBlur");

/** A fast push: scale 1 → 2 over 10 frames displaces the frame far more than 2.5px/frame. */
const FAST = [
  { at: 0, params: { scale: 1 } },
  { at: 10 / 30, params: { scale: 2 } },
] as unknown as KinoSegment["zoomKeyframes"];

/** A crawl: 0.2% of scale across two seconds — well under the threshold. */
const SLOW = [
  { at: 0, params: { scale: 1 } },
  { at: 2, params: { scale: 1.002 } },
] as unknown as KinoSegment["zoomKeyframes"];

describe("automatic camera motion blur", () => {
  it("derives a blur on a fast move with nothing opted in", () => {
    const e = blurOf(mk(FAST), 5);
    expect(e).toBeDefined();
    expect(Number(e!.params!.samples)).toBeGreaterThan(0);
    // A push is radial, not directional.
    expect(Math.abs(Number(e!.params!.radial))).toBeGreaterThan(0);
  });

  it("leaves a slow move completely untouched — no pass, byte-identical output", () => {
    expect(blurOf(mk(SLOW), 30)).toBeUndefined();
  });

  it("adds nothing to a beat with no camera at all", () => {
    expect(blurOf(mk(undefined), 15)).toBeUndefined();
  });

  it("honours the spec-level opt-out on a fast move", () => {
    expect(blurOf(mk(FAST, false), 5)).toBeUndefined();
  });

  it("keeps deriving when explicitly enabled", () => {
    expect(blurOf(mk(FAST, true), 5)).toBeDefined();
  });

  it("does not stack a second blur on top of a hand-authored one", () => {
    const p = mk(FAST);
    p.segments[0]!.effects = [{ kind: "motionBlur", params: { distance: 4, samples: 6 } }] as never;
    const blurs = layersAt(p, 5, DIMS)
      .find((l) => l.id === "seg0")!
      .effects!.filter((e) => e.kind === "motionBlur");
    expect(blurs).toHaveLength(1);
    // The author's numbers survive: theirs is not an `auto` entry, so it is passed through as written.
    expect(Number(blurs[0]!.params!.distance)).toBe(4);
    expect(Number(blurs[0]!.params!.samples)).toBe(6);
  });
});
