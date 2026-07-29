import { describe, it, expect } from "vitest";
import { layersAt, Z } from "../src/render/layers.js";
import { MOTION_XFADE_FRAMES } from "../src/render/motion.js";
import type { KinoProps, KinoSegment } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
};
const bg = { kind: "glow" as const, image: null, customCode: null, shaderCode: null, params: {}, keyframes: [], triggers: [] };
const DIMS = { width: 1080, height: 1920 };
const motion = { html: "<div></div>", params: {}, keyframes: [], triggers: [] };

const mk = (segments: KinoSegment[]): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
  background: bg, disclosure: "", segments,
});

describe("layersAt — motion beats", () => {
  it("emits a motion layer for a motion beat, inside its window only", () => {
    const p = mk([{ kind: "motion", caption: "", startSec: 1, endSec: 3, motion }]);
    expect(layersAt(p, 15, DIMS).some((l) => l.id === "motion0")).toBe(false);
    expect(layersAt(p, 45, DIMS).some((l) => l.id === "motion0")).toBe(true);
  });

  it("keeps the first motion beat opaque at its start — no loop-seam fade", () => {
    const p = mk([{ kind: "motion", caption: "", startSec: 0, endSec: 2, motion }]);
    expect(layersAt(p, 0, DIMS).find((l) => l.id === "motion0")!.opacity).toBe(1);
  });

  it("dissolves a motion beat that follows another motion beat", () => {
    const p = mk([
      { kind: "motion", caption: "", startSec: 0, endSec: 2, motion },
      { kind: "motion", caption: "", startSec: 2, endSec: 4, motion },
    ]);
    const op = (f: number) => layersAt(p, f, DIMS).find((l) => l.id === "motion1")!.opacity;
    expect(op(60)).toBeCloseTo(0, 2);
    expect(op(60 + MOTION_XFADE_FRAMES)).toBeCloseTo(1, 2);
  });

  it("holds the outgoing motion through the dissolve so the backdrop never shows", () => {
    const p = mk([
      { kind: "motion", caption: "", startSec: 0, endSec: 2, motion },
      { kind: "motion", caption: "", startSec: 2, endSec: 4, motion },
    ]);
    const ids = layersAt(p, 60 + 5, DIMS).map((l) => l.id);
    expect(ids).toContain("motion0");
    expect(ids).toContain("motion1");
  });

  it("hard-cuts when the incoming beat sets transition cut", () => {
    const p = mk([
      { kind: "motion", caption: "", startSec: 0, endSec: 2, motion },
      { kind: "motion", caption: "", startSec: 2, endSec: 4, motion, transition: "cut" },
    ]);
    expect(layersAt(p, 59, DIMS).some((l) => l.id === "motion0")).toBe(true);
    expect(layersAt(p, 60, DIMS).some((l) => l.id === "motion0")).toBe(false);
    expect(layersAt(p, 60, DIMS).find((l) => l.id === "motion1")!.opacity).toBe(1);
  });

  it("emits an overlay layer above the beat's own content", () => {
    const p = mk([{ kind: "video", caption: "", startSec: 0, endSec: 2, source: "c.mp4", motionOverlay: motion }]);
    const ids = layersAt(p, 15, DIMS).map((l) => l.id);
    expect(ids.indexOf("overlay0")).toBeGreaterThan(ids.indexOf("seg0"));
  });

  it("draws a text-behind overlay under its motion subject", () => {
    const mask = { source: { kind: "layer" as const, layerId: "motion0", channel: "a" as const }, invert: true };
    const p = mk([{
      kind: "motion", caption: "", startSec: 0, endSec: 2, motion, motionOverlay: motion, mask,
    } as KinoSegment]);
    const ids = layersAt(p, 15, DIMS).map((l) => l.id);
    expect(ids.indexOf("overlay0")).toBeLessThan(ids.indexOf("motion0"));
    expect(layersAt(p, 15, DIMS).find((l) => l.id === "overlay0")!.mask).toBeUndefined();
  });

  it("draws a segmented photo subject over its title overlay", () => {
    const mask = { source: { kind: "file" as const, src: "masks/presenter/mask.png", channel: "r" as const } };
    const p = mk([{
      kind: "video", caption: "", startSec: 0, endSec: 2, source: "pexels/8365066.jpg", motionOverlay: motion, mask,
    } as KinoSegment]);
    const ids = layersAt(p, 15, DIMS).map((l) => l.id);
    expect(ids.indexOf("overlay0")).toBeLessThan(ids.indexOf("seg0"));
    expect(layersAt(p, 15, DIMS).find((l) => l.id === "overlay0")!.mask).toBeUndefined();
    expect(layersAt(p, 15, DIMS).find((l) => l.id === "seg0")!.mask).toEqual(mask);
  });

  it("draws title under a transparent cutout PNG without a file mask", () => {
    const p = mk([{
      kind: "video", caption: "", startSec: 0, endSec: 2, source: "cutouts/presenter.png", motionOverlay: motion,
    } as KinoSegment]);
    const ids = layersAt(p, 15, DIMS).map((l) => l.id);
    expect(ids.indexOf("overlay0")).toBeLessThan(ids.indexOf("seg0"));
    // aboveFilm is gone (Task 3); the same "paints above the film" fact now lives in z.
    expect(layersAt(p, 15, DIMS).find((l) => l.id === "seg0")!.z).toBe(Z.segBehind);
  });

  it("passes the beat-local frame as the source key so the raster scrubs per beat", () => {
    const p = mk([{ kind: "motion", caption: "", startSec: 1, endSec: 3, motion }]);
    expect(layersAt(p, 45, DIMS).find((l) => l.id === "motion0")!.source.key).toBe("15");
  });
});
