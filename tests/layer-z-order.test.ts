// z is the single ordering truth: the list is sorted by it, and equal z falls back to push
// order so same-band layers keep their authored sequence across segment indices.
import { describe, it, expect } from "vitest";
import { layersAt, Z } from "../src/render/layers.js";
import type { KinoProps, KinoSegment } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
};
const bg = { kind: "glow" as const, image: null, customCode: null, shaderCode: null, params: {}, keyframes: [], triggers: [] };
const DIMS = { width: 1080, height: 1920 };
const mk = (segments: KinoSegment[], over: Partial<KinoProps> = {}): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: bg, disclosure: "", segments, ...over,
});

describe("z ordering", () => {
  it("returns the list already sorted by z", () => {
    const p = mk([{ kind: "video", source: "a.mp4", caption: "hi", startSec: 0, endSec: 3 }], {
      disclosure: "AI-generated",
    });
    const zs = layersAt(p, 30, DIMS).map((l) => l.z);
    expect(zs).toEqual([...zs].sort((a, b) => a - b));
  });

  it("gives every built-in the documented z", () => {
    const p = mk([{
      kind: "video", source: "a.mp4", caption: "hi", startSec: 0, endSec: 3,
      frame: { inset: { x: 10, y: 10, w: 80, h: 60 } } as any,
      kicker: { text: "NEW", color: "#fff", fg: "#000" },
    }], { disclosure: "AI-generated" });
    const byId = new Map(layersAt(p, 30, DIMS).map((l) => [l.id, l.z]));
    expect(byId.get("backdrop")).toBe(Z.backdrop);
    expect(byId.get("scrim")).toBe(Z.scrim);
    expect(byId.get("seg0")).toBe(Z.seg);
    expect(byId.get("frame0")).toBe(Z.frame);
    expect(byId.get("kicker0")).toBe(Z.kicker);
    expect(byId.get("caption0")).toBe(Z.caption);
    expect(byId.get("disclosure")).toBe(Z.disclosure);
  });

  it("keeps push order among layers sharing a z", () => {
    // Three beats' captions all sit at Z.caption; they must stay in segment order.
    const p = mk([
      { kind: "scene", caption: "a", startSec: 0, endSec: 3 },
      { kind: "scene", caption: "b", startSec: 0, endSec: 3 },
      { kind: "scene", caption: "c", startSec: 0, endSec: 3 },
    ]);
    const captions = layersAt(p, 30, DIMS).filter((l) => l.id.startsWith("caption")).map((l) => l.id);
    expect(captions).toEqual(["caption0", "caption1", "caption2"]);
  });

  it("promotes a text-behind-subject footage layer above the text it must occlude", () => {
    // isVideoTextBehind (layers.ts) recognizes a "file"-kind mask (a segmented cutout), not a
    // "layer"-kind mask — that pattern is isTextBehindSubject's, for motion beats.
    const p = mk([{
      kind: "video", source: "a.mp4", caption: "hi", startSec: 0, endSec: 3,
      mask: { source: { kind: "file", src: "masks/presenter/mask.png", channel: "r" } } as any,
      motionOverlay: { source: "o.html", params: {}, keyframes: [], triggers: [] } as any,
    }]);
    const byId = new Map(layersAt(p, 30, DIMS).map((l) => [l.id, l.z]));
    expect(byId.get("seg0")).toBe(Z.segBehind);
    expect(byId.get("overlay0")).toBe(Z.overlayVideoBehind);
    expect(byId.get("overlay0")!).toBeLessThan(byId.get("seg0")!);
  });

  it("actually reorders: a text-behind video beat's frame/kicker push after overlay/seg but must paint first", () => {
    // Push order (section 4, per beat) is overlay0 (Z.overlayVideoBehind 750), seg0
    // (Z.segBehind 760), frame0 (Z.frame 310), kicker0 (Z.kicker 320) — ascending z would put
    // frame/kicker LAST if the list were left in push order, so this only passes if the sort
    // actually reorders the list. (Deleting the sort and returning out.map(normalizeLayer)
    // would fail this test — see the fix report for the before/after run.)
    const p = mk([{
      kind: "video", source: "a.mp4", caption: "hi", startSec: 0, endSec: 3,
      mask: { source: { kind: "file", src: "masks/presenter/mask.png", channel: "r" } } as any,
      motionOverlay: { source: "o.html", params: {}, keyframes: [], triggers: [] } as any,
      frame: { inset: { x: 10, y: 10, w: 80, h: 60 } } as any,
      kicker: { text: "NEW", color: "#fff", fg: "#000" },
    }]);
    const relevant = new Set(["overlay0", "seg0", "frame0", "kicker0"]);
    const ids = layersAt(p, 30, DIMS)
      .map((l) => l.id)
      .filter((id) => relevant.has(id));
    expect(ids).toEqual(["frame0", "kicker0", "overlay0", "seg0"]);
  });
});
