import { describe, it, expect } from "vitest";
import { layersAt } from "../src/render/layers.js";
import type { KinoProps, KinoSegment } from "../src/render/props.js";

// Factories match the house style in layers-declared.test.ts / layers-motion.test.ts.
const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0,
};
const bg = { kind: "glow" as const, image: null, customCode: null, shaderCode: null, params: {}, keyframes: [], triggers: [] };
const DIMS = { width: 1080, height: 1920 };
const motion = { html: "<div></div>", params: {}, keyframes: [], triggers: [] };
const mk = (segments: KinoSegment[], over: Partial<KinoProps> = {}): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
  background: bg, disclosure: "", segments, ...over,
});

/** One 4s motion beat whose blur ramps 0 → 20 over the first 2 seconds. */
const ramping = (): KinoProps =>
  mk([
    {
      kind: "motion", caption: "", startSec: 0, endSec: 4, motion,
      effects: [{ kind: "blur", params: { radius: 0 }, keyframes: [{ at: 2, params: { radius: 20 } }] }],
    } as unknown as KinoSegment,
  ]);

const blurRadiusOf = (frame: number, id: string): number => {
  const layer = layersAt(ramping(), frame, DIMS).find((l) => l.id === id);
  return Number(layer?.effects?.find((e) => e.kind === "blur")?.params.radius);
};

describe("effect keyframes resolve against beat-local time", () => {
  it("is at the base value on the beat's first frame", () => {
    expect(blurRadiusOf(0, "motion0")).toBeCloseTo(0, 5);
  });

  it("is halfway at 1s (frame 30)", () => {
    expect(blurRadiusOf(30, "motion0")).toBeCloseTo(10, 5);
  });

  it("holds the final value past the last keyframe", () => {
    expect(blurRadiusOf(90, "motion0")).toBeCloseTo(20, 5);
  });
});

describe("declared-layer effect keyframes resolve against layer-local time", () => {
  const declared = (): KinoProps =>
    mk([{ kind: "scene", caption: "a", startSec: 0, endSec: 4 }], {
      layers: [
        {
          id: "leak",
          z: 350,
          source: { kind: "image", src: "fx/leak.png" },
          fromSec: 2,
          effects: [{ kind: "blur", params: { radius: 0 }, keyframes: [{ at: 1, params: { radius: 10 } }] }],
        },
      ],
    } as unknown as Partial<KinoProps>);

  const radiusAt = (frame: number): number => {
    const layer = layersAt(declared(), frame, DIMS).find((l) => l.id === "leak");
    return Number(layer?.effects?.find((e) => e.kind === "blur")?.params.radius);
  };

  it("is at the base value on the layer's first frame, not the composition's", () => {
    // Layer starts at 2s = frame 60. Beat-relative resolution would already read 20 here.
    expect(radiusAt(60)).toBeCloseTo(0, 5);
  });

  it("reaches the keyframe one second into the LAYER", () => {
    expect(radiusAt(90)).toBeCloseTo(10, 5);
  });
});

describe("keyframes resolve before autoMotionBlur derives its smear", () => {
  /** A pushing camera, so the auto derivation has real travel to measure. */
  const pushing = (effects: unknown[]): KinoProps =>
    mk([
      {
        kind: "video", caption: "", source: "screens/a.png", startSec: 0, endSec: 4,
        zoomKeyframes: [{ at: 0, params: { scale: 1 } }, { at: 4, params: { scale: 1.6 } }],
        effects,
      } as unknown as KinoSegment,
    ]);

  const autoParamsAt = (effects: unknown[], frame: number) => {
    const layer = layersAt(pushing(effects), frame, DIMS).find((l) => l.id === "seg0");
    return layer?.effects?.find((e) => e.kind === "motionBlur")?.params ?? {};
  };

  it("overrides a keyframed distance with the measured one", () => {
    const p = autoParamsAt(
      [{ kind: "motionBlur", params: { auto: 1, distance: 999 }, keyframes: [{ at: 2, params: { distance: 999 } }] }],
      30,
    );
    expect(Number(p.distance)).not.toBeCloseTo(999, 1);
  });

  it("feeds a keyframed shutter into the derivation", () => {
    const wide = autoParamsAt([{ kind: "motionBlur", params: { auto: 1, shutter: 0.5 }, keyframes: [{ at: 4, params: { shutter: 1 } }] }], 60);
    const narrow = autoParamsAt([{ kind: "motionBlur", params: { auto: 1, shutter: 0.5 } }], 60);
    // A pure push is all growth and no translation, so the smear lands in `radial`, not `distance`
    // (which is the translate delta). At frame 60 the keyframed shutter has tweened above 0.5, so
    // the same growth smears further.
    expect(Number(narrow.radial)).toBeGreaterThan(0);
    expect(Number(wide.radial)).toBeGreaterThan(Number(narrow.radial));
  });
});

describe("adjustment layers resolve on the same track", () => {
  const withAdjust = (adjust: unknown[]): KinoProps =>
    mk([{ kind: "scene", caption: "a", startSec: 0, endSec: 4 }], {
      layers: [{ id: "grade", z: 650, adjust }],
    } as unknown as Partial<KinoProps>);

  const adjustAt = (adjust: unknown[], frame: number) =>
    layersAt(withAdjust(adjust), frame, DIMS).find((l) => l.id === "grade" && l.source === null);

  it("tweens a keyframed adjust param", () => {
    const layer = adjustAt(
      [{ kind: "grade", params: { saturation: 1 }, keyframes: [{ at: 2, params: { saturation: 0 } }] }],
      30,
    );
    expect(Number(layer!.adjust![0].params.saturation)).toBeCloseTo(0.5, 5);
  });

  it("leaves a film adjust entry alone", () => {
    const layer = adjustAt([{ kind: "film", params: { intensity: 0.8 } }], 30);
    expect(Number(layer!.adjust![0].params.intensity)).toBeCloseTo(0.8, 5);
  });
});
