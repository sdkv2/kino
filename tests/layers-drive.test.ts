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

describe("layer drive + flip", () => {
  it("applies flipX via negative scaleX", () => {
    const t = layersAt(
      mk([{ kind: "scene", caption: "a", startSec: 0, endSec: 2 }], {
        layers: [{ id: "pic", z: 350, segment: 0, flipX: true, source: { kind: "image", src: "fx/a.png" } }],
      }),
      15,
      DIMS,
    ).find((l) => l.id === "pic")!.transform!;
    expect(t.scaleX).toBe(-1);
  });

  it("drive wiggle offsets y over time", () => {
    const a = layersAt(
      mk([{ kind: "scene", caption: "a", startSec: 0, endSec: 2 }], {
        layers: [{ id: "w", z: 350, segment: 0, source: { kind: "image", src: "fx/a.png" }, drive: { y: "wiggle(4, 5)" } }],
      }),
      10,
      DIMS,
    ).find((l) => l.id === "w")!.transform!.translate[1];
    const b = layersAt(
      mk([{ kind: "scene", caption: "a", startSec: 0, endSec: 2 }], {
        layers: [{ id: "w", z: 350, segment: 0, source: { kind: "image", src: "fx/a.png" }, drive: { y: "wiggle(4, 5)" } }],
      }),
      20,
      DIMS,
    ).find((l) => l.id === "w")!.transform!.translate[1];
    expect(a).not.toBeCloseTo(b, 0);
  });
});
