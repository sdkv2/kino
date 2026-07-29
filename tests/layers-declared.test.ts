import { describe, it, expect } from "vitest";
import { layersAt, Z } from "../src/render/layers.js";
import type { KinoProps, KinoSegment } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0,
};
const bg = { kind: "glow" as const, image: null, customCode: null, shaderCode: null, params: {}, keyframes: [], triggers: [] };
const DIMS = { width: 1080, height: 1920 };
const mk = (segments: KinoSegment[], over: Partial<KinoProps> = {}): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: bg, disclosure: "", segments, ...over,
});
const leak = { id: "leak", z: 350, source: { kind: "image" as const, src: "fx/leak.png" } };
const beats: KinoSegment[] = [
  { kind: "scene", caption: "a", startSec: 0, endSec: 2 },
  { kind: "scene", caption: "b", startSec: 2, endSec: 4 },
];

describe("declared layers", () => {
  it("sorts into the stack at its z", () => {
    const ids = layersAt(mk(beats, { layers: [leak] }), 30, DIMS).map((l) => l.id);
    expect(ids.indexOf("scrim")).toBeLessThan(ids.indexOf("leak"));
    expect(ids.indexOf("leak")).toBeLessThan(ids.indexOf("caption0"));
  });

  it("runs the whole composition when no window is given", () => {
    const p = mk(beats, { layers: [leak] });
    expect(layersAt(p, 0, DIMS).some((l) => l.id === "leak")).toBe(true);
    expect(layersAt(p, 110, DIMS).some((l) => l.id === "leak")).toBe(true);
  });

  it("gates on fromSec/toSec when given", () => {
    const p = mk(beats, { layers: [{ ...leak, fromSec: 1, toSec: 2 }] });
    expect(layersAt(p, 15, DIMS).some((l) => l.id === "leak")).toBe(false);
    expect(layersAt(p, 45, DIMS).some((l) => l.id === "leak")).toBe(true);
    expect(layersAt(p, 75, DIMS).some((l) => l.id === "leak")).toBe(false);
  });

  it("resolves rect percentages against the frame", () => {
    const p = mk(beats, { layers: [{ ...leak, rect: { x: 10, y: 0, w: 80, h: 50 } }] });
    const l = layersAt(p, 30, DIMS).find((x) => x.id === "leak")!;
    expect(l.rect).toEqual({ x: 108, y: 0, w: 864, h: 960 });
  });

  it("defaults to the full frame with no rect", () => {
    const l = layersAt(mk(beats, { layers: [leak] }), 30, DIMS).find((x) => x.id === "leak")!;
    expect(l.rect).toEqual({ x: 0, y: 0, w: 1080, h: 1920 });
  });

  it("carries blend, opacity, mask and effects through", () => {
    const p = mk(beats, {
      layers: [{ ...leak, blend: "screen" as const, opacity: 0.6, effects: [{ kind: "blur" as const, params: { radius: 4 } }] }],
    });
    const l = layersAt(p, 30, DIMS).find((x) => x.id === "leak")!;
    expect(l.blend).toBe("screen");
    expect(l.opacity).toBeCloseTo(0.6);
    expect(l.effects).toEqual([{ kind: "blur", params: { radius: 4 } }]);
  });

  it("tweens x/y/scale/opacity from its keyframe track", () => {
    const p = mk(beats, {
      layers: [{ ...leak, keyframes: [
        { at: 0, params: { x: 0, y: 0, scale: 1, opacity: 1 } },
        { at: 2, params: { x: 10, y: 0, scale: 2, opacity: 0 } },
      ] }],
    });
    const l = layersAt(p, 30, DIMS).find((x) => x.id === "leak")!;  // t = 1s, halfway
    expect(l.transform.translate[0]).toBeCloseTo(54);   // 5% of 1080
    expect(l.transform.scale).toBeCloseTo(1.5);
    expect(l.opacity).toBeCloseTo(0.5);
  });

  it("borrows a beat's window and group when bound to a segment", () => {
    const p = mk(beats, { layers: [{ ...leak, segment: 1 }] });
    expect(layersAt(p, 30, DIMS).some((l) => l.id === "leak")).toBe(false);   // beat 1 has not started
    const l = layersAt(p, 90, DIMS).find((x) => x.id === "leak")!;
    expect(l.group).toBe("beat1");
  });

  it("stays in the base group when held, keeping the beat's window", () => {
    const p = mk(beats, { layers: [{ ...leak, segment: 1, hold: true }] });
    expect(layersAt(p, 30, DIMS).some((l) => l.id === "leak")).toBe(false);
    const l = layersAt(p, 90, DIMS).find((x) => x.id === "leak")!;
    expect(l.group).toBeUndefined();
  });

  it("keeps declared order among layers sharing a z", () => {
    const p = mk(beats, { layers: [{ ...leak, id: "a" }, { ...leak, id: "b" }] });
    const ids = layersAt(p, 30, DIMS).map((l) => l.id).filter((id) => id === "a" || id === "b");
    expect(ids).toEqual(["a", "b"]);
  });
});
