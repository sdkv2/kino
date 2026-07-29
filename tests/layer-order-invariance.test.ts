// The order layers actually PAINT in, today. Array order alone does not capture it: the
// renderer splits the list into below-film and above-film bands (renderer.ts:153) and paints
// the bands in sequence, so a layer's array position and its paint position differ.
//
// This test exists to be a no-op oracle for the z port. It asserts today's behaviour, correct
// or not — if the port changes any of these orders, the port is wrong.
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

// Was an id-prefix regex mirroring renderer.ts:153; now the renderer reads z and so does this.
const isAboveFilm = (l: { z: number }): boolean => l.z >= Z.film;

export const renderOrder = (p: KinoProps, frame: number): string[] => {
  const ls = layersAt(p, frame, DIMS);
  return [...ls.filter((l) => !isAboveFilm(l)), ...ls.filter((l) => isAboveFilm(l))].map((l) => l.id);
};

describe("render order is stable across the z port", () => {
  it("scene beat: backdrop, scrim, caption", () => {
    const p = mk([{ kind: "scene", caption: "hi", startSec: 0, endSec: 3 }]);
    expect(renderOrder(p, 30)).toEqual(["backdrop", "scrim", "caption0"]);
  });

  it("shader background drops the scrim", () => {
    const p = mk([{ kind: "scene", caption: "hi", startSec: 0, endSec: 3 }], {
      background: { ...bg, kind: "custom", shaderCode: "void mainImage(){}" },
    });
    expect(renderOrder(p, 30)).toEqual(["backdrop", "caption0"]);
  });

  it("video beat: footage and chrome below film, caption above", () => {
    const p = mk([{
      kind: "video", source: "a.mp4", caption: "hi", startSec: 0, endSec: 3,
      // AppFrame requires `src` (the chrome overlay asset) alongside `inset`.
      frame: { src: "phone.png", inset: { x: 10, y: 10, w: 80, h: 60 } },
    }]);
    expect(renderOrder(p, 30)).toEqual(["backdrop", "scrim", "seg0", "frame0", "caption0"]);
  });

  it("kicker paints with the footage, below the film", () => {
    const p = mk([{
      kind: "video", source: "a.mp4", caption: "hi", startSec: 0, endSec: 3,
      kicker: { text: "NEW", color: "#fff", fg: "#000" },
    }]);
    expect(renderOrder(p, 30)).toEqual(["backdrop", "scrim", "seg0", "kicker0", "caption0"]);
  });

  it("logo paints below the caption", () => {
    const p = mk([{ kind: "scene", caption: "hi", startSec: 0, endSec: 3 }], {
      // LogoProps requires `src`; the brief's sketch omitted it.
      logo: { src: "logo.png", x: 50, y: 90, sizePx: 120, aspect: 1, keyframes: [] },
    });
    expect(renderOrder(p, 30)).toEqual(["backdrop", "scrim", "logo", "caption0"]);
  });

  it("disclosure paints above the caption", () => {
    const p = mk([{ kind: "scene", caption: "hi", startSec: 0, endSec: 3 }], { disclosure: "AI-generated" });
    expect(renderOrder(p, 30)).toEqual(["backdrop", "scrim", "caption0", "disclosure"]);
  });

  it("QA overlays paint above everything", () => {
    const p = mk([{ kind: "scene", caption: "hi", startSec: 0, endSec: 3 }], {
      platformGuide: "tiktok", grid: true,
    } as Partial<KinoProps>);
    // Changed deliberately: these used to paint BELOW the film and behind the caption, because
    // the old id-prefix band test had no case for their ids. Now that the band reads z, Z.qa
    // puts them where §11 always said they were. QA props are set only by `kino still` and
    // `kino storyboard` — `kino build` never sets them, so no delivered render can change.
    expect(renderOrder(p, 30)).toEqual(["backdrop", "scrim", "caption0", "platformGuide", "grid"]);
  });

  it("avatar window paints above the scrim, below the caption", () => {
    const p = mk([{ kind: "scene", caption: "hi", startSec: 0, endSec: 3 }], {
      avatar: "a.mp4", avatarWindows: [{ fromSec: 0, toSec: 3, audioStartSec: 0 }],
    });
    expect(renderOrder(p, 30)).toEqual(["backdrop", "scrim", "av0", "caption0"]);
  });

  it("motion beat: the graphic paints above the film", () => {
    const p = mk([{
      kind: "motion", caption: "hi", startSec: 0, endSec: 3,
      // MotionGraphicProps requires `html` (not `source`); Tier 1 is sanitized static markup.
      motion: { html: "<div></div>", params: {}, keyframes: [], triggers: [] },
    }]);
    expect(renderOrder(p, 30)).toEqual(["backdrop", "scrim", "motion0", "caption0"]);
  });

  it("an ordinary motion overlay paints above its beat's motion graphic", () => {
    const p = mk([{
      kind: "motion", caption: "hi", startSec: 0, endSec: 3,
      motion: { html: "<div></div>", params: {}, keyframes: [], triggers: [] },
      motionOverlay: { html: "<div></div>", params: {}, keyframes: [], triggers: [] },
    }]);
    expect(renderOrder(p, 30)).toEqual(["backdrop", "scrim", "motion0", "overlay0", "caption0"]);
  });

  it("two beats overlap during the chained-cutaway hold", () => {
    // CHAIN_HOLD_FRAMES = 12: beat 0 is held 12 frames into beat 1, so both are on screen.
    const p = mk([
      { kind: "video", source: "a.mp4", caption: "a", startSec: 0, endSec: 2 },
      { kind: "video", source: "b.mp4", caption: "b", startSec: 2, endSec: 4 },
    ]);
    const order = renderOrder(p, 2 * 30 + 5);
    expect(order.filter((id) => id.startsWith("seg"))).toEqual(["seg0", "seg1"]);
  });
});
