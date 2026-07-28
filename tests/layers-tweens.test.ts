// The authored tween tracks — captionKeyframes, kickerKeyframes, zoomKeyframes, logoKeyframes
// and `shot`. Each was consumed by the retired DOM composition (KinoVideo.tsx / components.tsx)
// and has to land on a LayerDraw.transform now that the compositor is the only render path.
//
// Semantics are ported verbatim from TweenOverlay / AnimatedElement / AppCutaway:
//   · x/y are PERCENT OF FRAME, translate applied after a scale about the rect centre
//   · segment tracks (caption/kicker/zoom) are BEAT-RELATIVE; logoKeyframes are ABSOLUTE
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

const layer = (p: KinoProps, frame: number, id: string) =>
  layersAt(p, frame, DIMS).find((l) => l.id === id)!;

describe("captionKeyframes", () => {
  const kf = [
    { at: 0, params: { x: 0, y: 0, scale: 1, opacity: 1 } },
    { at: 2, params: { x: 10, y: -5, scale: 1.5, opacity: 0.5 } },
  ];

  it("tweens the caption layer's transform in percent-of-frame units", () => {
    const p = mk([{ kind: "scene", caption: "hi", startSec: 0, endSec: 3, captionKeyframes: kf }]);
    const l = layer(p, 30, "caption0"); // beat-local t = 1s = halfway

    expect(l.transform.translate[0]).toBeCloseTo(54);   // 5% of 1080
    expect(l.transform.translate[1]).toBeCloseTo(-48);  // -2.5% of 1920
    expect(l.transform.scale).toBeCloseTo(1.25);
    expect(l.opacity).toBeCloseTo(0.75);
  });

  it("reads the track beat-relative, not on the absolute timeline", () => {
    // Same track on a beat that starts at 4s: local t=1s must give the same result as above.
    const p = mk([
      { kind: "scene", caption: "a", startSec: 0, endSec: 4 },
      { kind: "scene", caption: "hi", startSec: 4, endSec: 7, captionKeyframes: kf },
    ]);
    const l = layer(p, 4 * 30 + 30, "caption1");
    expect(l.transform.translate[0]).toBeCloseTo(54);
    expect(l.transform.scale).toBeCloseTo(1.25);
  });

  it("leaves the caption at identity when no track is authored", () => {
    const p = mk([{ kind: "scene", caption: "hi", startSec: 0, endSec: 3 }]);
    const l = layer(p, 30, "caption0");
    expect(l.transform).toEqual({ scale: 1, rotate: 0, translate: [0, 0] });
    expect(l.opacity).toBe(1);
  });
});

const vid = (over: Partial<KinoSegment> = {}): KinoSegment => ({
  kind: "video", source: "clip.mp4", caption: "", startSec: 0, endSec: 2, ...over,
});

describe("kickerKeyframes", () => {
  it("tweens the kicker layer's transform", () => {
    const p = mk([vid({
      kicker: { text: "NEW", color: "#0c8d64", fg: "#fff" },
      kickerKeyframes: [{ at: 0, params: { x: 20, scale: 2 } }],
    })]);
    const l = layer(p, 15, "kicker0");
    expect(l.transform.translate[0]).toBeCloseTo(216); // 20% of 1080
    expect(l.transform.scale).toBeCloseTo(2);
  });

  it("multiplies the tween opacity with the chained-clip fade rather than replacing it", () => {
    const p = mk([
      vid({ startSec: 0, endSec: 2 }),
      vid({
        startSec: 2, endSec: 4,
        kicker: { text: "NEW", color: "#0c8d64", fg: "#fff" },
        kickerKeyframes: [{ at: 0, params: { opacity: 0.4 } }],
      }),
    ]);
    // Frame 66 = 6 frames into the 12-frame chained fade → 0.5 fade, × 0.4 authored.
    expect(layer(p, 66, "kicker1").opacity).toBeCloseTo(0.2);
  });
});

describe("zoomKeyframes", () => {
  const zoom = [{ at: 0, params: { scale: 1.2, x: 5 } }];

  it("moves the footage and its chrome together — it is a camera on the whole group", () => {
    const p = mk([vid({
      frame: { src: "phone.png", inset: { x: 10, y: 12, w: 80, h: 76 } },
      zoomKeyframes: zoom,
    })]);
    const seg = layer(p, 15, "seg0");
    const chrome = layer(p, 15, "frame0");
    expect(seg.transform.scale).toBeCloseTo(1.2);
    expect(seg.transform.translate[0]).toBeCloseTo(54); // 5% of frame width, not of the inset
    expect(chrome.transform).toEqual(seg.transform);
  });

  it("applies to unframed footage too", () => {
    const p = mk([vid({ zoomKeyframes: zoom })]);
    expect(layer(p, 15, "seg0").transform.scale).toBeCloseTo(1.2);
  });
});

describe("shot", () => {
  it("pushes in on the footage over the beat", () => {
    const p = mk([vid({ startSec: 0, endSec: 2, shot: "push-in" })]);
    // shotTransform("push-in") ramps 1.06 → 1.2 across the beat.
    expect(layer(p, 0, "seg0").transform.scale).toBeCloseTo(1.06);
    expect(layer(p, 59, "seg0").transform.scale).toBeCloseTo(1.2, 1);
  });

  it("translates in percent of the footage rect", () => {
    const p = mk([vid({ startSec: 0, endSec: 2, shot: "pan-left" })]);
    // pan-left: tx 5% → -5%, scale 1.14. At p=0 that is +5% of the full-frame rect.
    expect(layer(p, 0, "seg0").transform.translate[0]).toBeCloseTo(54);
    expect(layer(p, 0, "seg0").transform.scale).toBeCloseTo(1.14);
  });

  it("stays locked on framed footage — a camera move fights the inset", () => {
    const p = mk([vid({
      shot: "push-in",
      frame: { src: "phone.png", inset: { x: 10, y: 12, w: 80, h: 76 } },
    })]);
    expect(layer(p, 15, "seg0").transform.scale).toBe(1);
  });

  it("composes with a zoom track: shot is the inner camera, zoom the outer one", () => {
    const p = mk([vid({
      startSec: 0, endSec: 2, shot: "pan-left",
      zoomKeyframes: [{ at: 0, params: { scale: 2, x: 10 } }],
    })]);
    const t = layer(p, 0, "seg0").transform;
    expect(t.scale).toBeCloseTo(1.14 * 2);          // Z · S
    expect(t.translate[0]).toBeCloseTo(108 + 2 * 54); // Tz + Z · Ts
    // The chrome-less group still moves as one: no chrome layer here, but the zoom alone
    // governs any sibling.
  });
});

// `aspect` is the logo's natural w/h, measured node-side at build. layersAt is pure and cannot
// decode the image, so the rect it computes has to be told the shape.
const logoProps = (over: Record<string, unknown> = {}) =>
  ({ src: "logo.png", sizePx: 120, aspect: 3, x: 50, y: 90, keyframes: [], ...over }) as unknown as KinoProps["logo"];

describe("logo geometry", () => {
  const beat: KinoSegment = { kind: "scene", caption: "hi", startSec: 0, endSec: 3 };

  it("sizes the logo to sizePx at its natural aspect, centred on x/y percent", () => {
    const p = mk([beat], { logo: logoProps() });
    // 120px wide at 3:1 → 40 tall; centre (50% of 1080, 90% of 1920) = (540, 1728).
    expect(layer(p, 30, "logo").rect).toEqual({ x: 480, y: 1708, w: 120, h: 40 });
  });

  it("does not stretch the logo across the whole frame", () => {
    const p = mk([beat], { logo: logoProps() });
    const r = layer(p, 30, "logo").rect;
    expect(r.w).toBeLessThan(DIMS.width);
    expect(r.h).toBeLessThan(DIMS.height);
  });

  it("tweens x/y/scale/opacity from logoKeyframes on the ABSOLUTE timeline", () => {
    const p = mk([beat], {
      logo: logoProps({
        keyframes: [
          { at: 0, params: { opacity: 0, scale: 1 } },
          { at: 2, params: { opacity: 1, scale: 2 } },
        ],
      }),
    });
    const l = layer(p, 30, "logo"); // t = 1s absolute → halfway
    expect(l.opacity).toBeCloseTo(0.5);
    expect(l.transform.scale).toBeCloseTo(1.5);
  });

  it("keeps the configured x/y as the base a partial track tweens from", () => {
    const p = mk([beat], { logo: logoProps({ keyframes: [{ at: 0, params: { scale: 1 } }] }) });
    // The track never mentions x/y, so the logo stays at its configured 50/90 centre.
    expect(layer(p, 30, "logo").rect.x).toBe(480);
  });

  it("springs in when no track is authored — the default entrance, not a hard cut", () => {
    const p = mk([beat], { logo: logoProps() });
    const first = layer(p, 0, "logo");
    expect(first.opacity).toBe(0);
    expect(first.transform.scale).toBeCloseTo(0.9);
    // Critically damped at damping 200 → settled within a second.
    const settled = layer(p, 30, "logo");
    expect(settled.opacity).toBeCloseTo(1, 2);
    expect(settled.transform.scale).toBeCloseTo(1, 2);
  });

  it("lets an authored track replace the entrance entirely", () => {
    const p = mk([beat], { logo: logoProps({ keyframes: [{ at: 0, params: { opacity: 1 } }] }) });
    expect(layer(p, 0, "logo").opacity).toBe(1);
  });
});
