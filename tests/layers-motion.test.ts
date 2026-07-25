import { describe, it, expect } from "vitest";
import { layersAt } from "../src/render/layers.js";
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
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
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

  it("emits an overlay layer above the beat's own content", () => {
    const p = mk([{ kind: "video", caption: "", startSec: 0, endSec: 2, source: "c.mp4", motionOverlay: motion }]);
    const ids = layersAt(p, 15, DIMS).map((l) => l.id);
    expect(ids.indexOf("overlay0")).toBeGreaterThan(ids.indexOf("seg0"));
  });

  it("passes the beat-local frame as the source key so the raster scrubs per beat", () => {
    const p = mk([{ kind: "motion", caption: "", startSec: 1, endSec: 3, motion }]);
    expect(layersAt(p, 45, DIMS).find((l) => l.id === "motion0")!.source.key).toBe("15");
  });
});
