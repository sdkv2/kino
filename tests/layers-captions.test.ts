import { describe, it, expect } from "vitest";
import { layersAt } from "../src/render/layers.js";
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

const wordsBeat: KinoSegment = {
  kind: "scene", caption: "ship it fast", startSec: 0, endSec: 3, captionMode: "words",
  words: [
    { word: "ship", start: 0.0, end: 0.5 },
    { word: "it", start: 0.5, end: 0.9 },
    { word: "fast", start: 0.9, end: 1.6 },
  ],
};

describe("layersAt — captions", () => {
  it("keys the caption by active word index, not by frame", () => {
    const p = mk([wordsBeat]);
    const key = (f: number) => layersAt(p, f, DIMS).find((l) => l.id === "caption0")!.source.key;
    expect(key(3)).toBe("w0");
    expect(key(9)).toBe("w0");   // same word, same key → one raster serves both frames
    expect(key(20)).toBe("w1");
    expect(key(35)).toBe("w2");
  });

  it("emits no caption layer for a beat with no caption content", () => {
    const p = mk([{ kind: "scene", caption: "", startSec: 0, endSec: 2 }]);
    expect(layersAt(p, 15, DIMS).some((l) => l.id === "caption0")).toBe(false);
  });

  it("emits the logo only on presenter-less beats", () => {
    const withLogo = { src: "logo.png", sizePx: 120, x: 60, y: 60, keyframes: [], fromSec: 0 } as unknown as KinoProps["logo"];
    const p = mk([{ kind: "scene", caption: "hi", startSec: 0, endSec: 2 }], { logo: withLogo });
    expect(layersAt(p, 15, DIMS).some((l) => l.id === "logo")).toBe(true);
    const pAvatar = mk([{ kind: "scene", caption: "hi", startSec: 0, endSec: 2 }], {
      logo: withLogo,
      avatar: { src: "a.mp4" } as unknown as KinoProps["avatar"],
      avatarWindows: [{ fromSec: 0, toSec: 2, audioStartSec: 0 }],
    });
    expect(layersAt(pAvatar, 15, DIMS).some((l) => l.id === "logo")).toBe(false);
  });

  it("puts disclosure last — film finish is a post pass, not a layer", () => {
    const p = mk([{ kind: "scene", caption: "hi", startSec: 0, endSec: 2 }], { disclosure: "AI generated" });
    const ids = layersAt(p, 15, DIMS).map((l) => l.id);
    expect(ids.at(-1)).toBe("disclosure");
    expect(ids).not.toContain("film");
  });

  it("never emits a film layer — vignette/grain run in the post stage", () => {
    const p = mk([{ kind: "scene", caption: "hi", startSec: 0, endSec: 2 }], { theme: { ...theme, film: 0 } });
    expect(layersAt(p, 15, DIMS).some((l) => l.id === "film")).toBe(false);
    const withFilm = mk([{ kind: "scene", caption: "hi", startSec: 0, endSec: 2 }], { theme: { ...theme, film: 1 } });
    expect(layersAt(withFilm, 15, DIMS).some((l) => l.id === "film")).toBe(false);
  });

  it("emits standalone text overlays keyed per beat and index", () => {
    const p = mk([{
      kind: "scene", caption: "", startSec: 0, endSec: 4,
      texts: [{ text: "one", fromSec: 0, toSec: 2 }, { text: "two", fromSec: 2, toSec: 4 }] as unknown as KinoSegment["texts"],
    }]);
    expect(layersAt(p, 15, DIMS).some((l) => l.id === "text0_0")).toBe(true);
    expect(layersAt(p, 15, DIMS).some((l) => l.id === "text0_1")).toBe(false);
    expect(layersAt(p, 90, DIMS).some((l) => l.id === "text0_1")).toBe(true);
  });
});
