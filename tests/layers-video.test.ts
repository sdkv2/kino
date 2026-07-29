import { describe, it, expect } from "vitest";
import { layersAt } from "../src/render/layers.js";
import type { KinoProps, KinoSegment } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
};
const bg = { kind: "glow" as const, image: null, customCode: null, shaderCode: null, params: {}, keyframes: [], triggers: [] };
const DIMS = { width: 1080, height: 1920 };

const seg = (over: Partial<KinoSegment>): KinoSegment => ({
  kind: "video", caption: "", startSec: 0, endSec: 2, source: "clip.mp4", ...over,
});

const mk = (segments: KinoSegment[]): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
  background: bg, disclosure: "", segments,
});

describe("layersAt — video beats", () => {
  it("emits the footage layer inside the beat and not outside it", () => {
    const p = mk([seg({ startSec: 1, endSec: 3 })]);
    expect(layersAt(p, 15, DIMS).some((l) => l.id === "seg0")).toBe(false);
    expect(layersAt(p, 45, DIMS).some((l) => l.id === "seg0")).toBe(true);
    expect(layersAt(p, 95, DIMS).some((l) => l.id === "seg0")).toBe(false);
  });

  it("holds a chained clip 12 frames into its successor", () => {
    const p = mk([seg({ startSec: 0, endSec: 2 }), seg({ startSec: 2, endSec: 4 })]);
    // At 2.2s the second beat is live and the first is still held (12-frame overlap from f=60).
    const ids = layersAt(p, 66, DIMS).map((l) => l.id);
    expect(ids).toContain("seg0");
    expect(ids).toContain("seg1");
    // Past the overlap the first is gone.
    expect(layersAt(p, 80, DIMS).map((l) => l.id)).not.toContain("seg0");
  });

  it("fades the successor in over the overlap", () => {
    const p = mk([seg({ startSec: 0, endSec: 2 }), seg({ startSec: 2, endSec: 4 })]);
    const op = (f: number) => layersAt(p, f, DIMS).find((l) => l.id === "seg1")!.opacity;
    expect(op(60)).toBeCloseTo(0, 2);
    expect(op(72)).toBeCloseTo(1, 2);
  });

  it("emits the chrome frame above the footage when the beat has one", () => {
    const p = mk([seg({ frame: { src: "phone.png", inset: { x: 10, y: 12, w: 80, h: 76 } } })]);
    const ids = layersAt(p, 15, DIMS).map((l) => l.id);
    expect(ids.indexOf("frame0")).toBeGreaterThan(ids.indexOf("seg0"));
  });

  it("insets the footage to the chrome window, in frame px", () => {
    const p = mk([seg({ frame: { src: "phone.png", inset: { x: 10, y: 12, w: 80, h: 76 } } })]);
    const rect = layersAt(p, 15, DIMS).find((l) => l.id === "seg0")!.rect;
    expect(rect).toEqual({ x: 108, y: 230.4, w: 864, h: 1459.2 });
  });

  it("emits a kicker layer when the beat has one", () => {
    const p = mk([seg({ kicker: { text: "NEW", color: "#0c8d64", fg: "#fff" } })]);
    expect(layersAt(p, 15, DIMS).some((l) => l.id === "kicker0")).toBe(true);
  });
});
