import { describe, it, expect } from "vitest";
import { layersAt } from "../src/render/layers.js";
import type { KinoProps, KinoSegment } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0,
};
const bg = { kind: "glow" as const, image: null, customCode: null, shaderCode: null, params: {}, keyframes: [], triggers: [] };
const DIMS = { width: 1080, height: 1920 };
const mk = (segments: KinoSegment[], over: Partial<KinoProps> = {}): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
  background: bg, disclosure: "", segments, ...over,
});

/** One declared layer carrying a tween track, so the assertion reads that layer's transform. */
const transformAt = (keyframes: unknown[], frame: number) =>
  layersAt(
    mk([{ kind: "scene", caption: "a", startSec: 0, endSec: 4 }], {
      layers: [{ id: "card", z: 350, source: { kind: "image", src: "fx/card.png" }, keyframes }],
    } as unknown as Partial<KinoProps>),
    frame,
    DIMS,
  ).find((l) => l.id === "card")!.transform;

describe("the tween track carries rotation, per-axis scale and anchor", () => {
  it("tweens rotate in degrees", () => {
    const t = transformAt([{ at: 0, params: { rotate: 0 } }, { at: 2, params: { rotate: 90 } }], 30);
    expect(t.rotate).toBeCloseTo(45, 5);
  });

  it("tweens scaleX and scaleY independently", () => {
    const t = transformAt([{ at: 0, params: { scaleX: 1, scaleY: 1 } }, { at: 2, params: { scaleX: 2, scaleY: 3 } }], 30);
    expect(t.scaleX).toBeCloseTo(1.5, 5);
    expect(t.scaleY).toBeCloseTo(2, 5);
  });

  it("tweens the anchor", () => {
    // Sampled at 0.5s of a 2s track — a quarter through, so the value is 0.25 and not the 0.5
    // default that would (correctly) be omitted.
    const t = transformAt([{ at: 0, params: { anchorX: 0, anchorY: 0 } }, { at: 2, params: { anchorX: 1, anchorY: 1 } }], 15);
    expect(t.anchor).toBeDefined();
    expect(t.anchor![0]).toBeCloseTo(0.25, 5);
    expect(t.anchor![1]).toBeCloseTo(0.25, 5);
  });

  // A track that moves none of the new channels must produce the transform shape it always
  // produced — modelMatrix reads the absent fields as their defaults, and the inline literals
  // cameraAt builds are compared against this object directly (layers-tweens.test.ts).
  it("omits the new channels entirely when the track only sets the old ones", () => {
    const t = transformAt([{ at: 0, params: { scale: 1 } }, { at: 2, params: { scale: 2 } }], 30);
    expect(t.scale).toBeCloseTo(1.5, 5);
    expect(t.rotate).toBe(0);
    expect(Object.keys(t).sort()).toEqual(["rotate", "scale", "translate"]);
  });

  it("omits an anchor that is authored back at the default", () => {
    const t = transformAt([{ at: 0, params: { anchorX: 0.5, anchorY: 0.5 } }, { at: 2, params: { anchorX: 0.5, anchorY: 0.5 } }], 30);
    expect(t.anchor).toBeUndefined();
  });

  it("still tweens x and y as a percentage of the frame", () => {
    const t = transformAt([{ at: 0, params: { x: 0 } }, { at: 2, params: { x: 10 } }], 30);
    expect(t.translate[0]).toBeCloseTo(0.05 * DIMS.width, 5);
  });
});
