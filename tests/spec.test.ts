import { describe, it, expect } from "vitest";
import { SpecSchema, parseSpec } from "../src/spec/schema.js";

const valid = {
  brand: "acme",
  title: "lie-test",
  segments: [
    { kind: "avatar", text: "I ran my CV through five AI tools.", caption: "I tested 5 AI tools" },
    { kind: "app", asset: "screens/05.png", text: "It scores the match.", caption: "every claim" },
  ],
};

describe("SpecSchema", () => {
  it("parses a valid spec and defaults format to 9:16", () => {
    const s = SpecSchema.parse(valid);
    expect(s.format).toEqual(["9:16"]);
    expect(s.segments).toHaveLength(2);
  });
  it("requires app segments to have an asset", () => {
    expect(() => SpecSchema.parse({ ...valid, segments: [{ kind: "app", text: "x", caption: "y" }] })).toThrow();
  });
  it("parses avatar and app segments without caption (captions truly optional)", () => {
    const s = SpecSchema.parse({
      title: "no-captions",
      segments: [
        { kind: "avatar", text: "spoken only" },
        { kind: "app", asset: "screens/x.png", text: "spoken only" },
      ],
    });
    expect(s.segments[0].caption).toBeUndefined();
    expect(s.segments[1].caption).toBeUndefined();
  });
});

describe("SpecSchema strict segments (unknown-key footgun)", () => {
  it("rejects a `transition` on a motion segment (motion hard-cuts; transition is inert there)", () => {
    expect(() =>
      SpecSchema.parse({
        ...valid,
        segments: [{ kind: "motion", source: "motion/x.html", text: "hi", transition: "fade" }],
      }),
    ).toThrow();
  });
  it("rejects an unknown key on an avatar segment", () => {
    expect(() =>
      SpecSchema.parse({ ...valid, segments: [{ kind: "avatar", text: "hi", caption: "hi", bogus: true }] }),
    ).toThrow();
  });
  it("rejects an unknown key on an app segment", () => {
    expect(() =>
      SpecSchema.parse({
        ...valid,
        segments: [{ kind: "app", asset: "a.png", text: "hi", caption: "hi", bogus: true }],
      }),
    ).toThrow();
  });
  it("rejects an unknown key in sfx/music entries", () => {
    expect(() => SpecSchema.parse({ ...valid, sfx: [{ src: "pop", at: 1, bogus: true }] })).toThrow();
    expect(() => SpecSchema.parse({ ...valid, music: { src: "bed.mp3", bogus: true } })).toThrow();
  });
  it("parseSpec explains logoPosition on a segment (top-level only)", () => {
    expect(() =>
      parseSpec({
        ...valid,
        segments: [{ kind: "avatar", text: "hi", caption: "Get Driftlog", logoPosition: "center" }],
      }),
    ).toThrow(/logoPosition is top-level/);
  });
  it("parseSpec explains transition on a motion segment", () => {
    expect(() =>
      parseSpec({
        ...valid,
        segments: [{ kind: "motion", source: "motion/x.html", text: "hi", transition: "fade" }],
      }),
    ).toThrow(/transition is app-only/);
  });
});

describe("SpecSchema stylised text", () => {
  it("accepts captionStyle/captionAnimation at top level and per segment", () => {
    const s = SpecSchema.parse({
      ...valid,
      captionStyle: "highlight",
      captionAnimation: "wave",
      segments: [{ kind: "avatar", text: "hi", caption: "hi", captionStyle: "gradient", captionAnimation: "blur-in" }],
    });
    expect(s.captionStyle).toBe("highlight");
    expect(s.segments[0].captionStyle).toBe("gradient");
  });
  it("accepts texts overlays and defaults position/size", () => {
    const s = SpecSchema.parse({
      ...valid,
      segments: [{ kind: "avatar", text: "hi", caption: "hi", texts: [{ text: "3× faster", at: 1.2 }] }],
    });
    expect(s.segments[0].texts![0]).toMatchObject({ text: "3× faster", at: 1.2, position: "center", size: "medium" });
  });
  it("rejects unknown style/animation/position values", () => {
    expect(() => SpecSchema.parse({ ...valid, captionStyle: "comic-sans" })).toThrow();
    expect(() =>
      SpecSchema.parse({ ...valid, segments: [{ kind: "avatar", text: "x", caption: "y", texts: [{ text: "z", at: 0, position: "middle" }] }] }),
    ).toThrow();
  });
});

describe("SpecSchema app footage fields", () => {
  it("accepts clip/speed/pauseAt/frame and defaults speed to 1", () => {
    const s = SpecSchema.parse({
      ...valid,
      segments: [
        {
          kind: "app",
          asset: "recordings/scroll.mp4",
          text: "x",
          caption: "y",
          clipFrom: 4.2,
          clipTo: 8,
          pauseAt: 1.5,
          frame: { src: "frames/chrome.png", inset: { x: 8, y: 10, w: 84, h: 78 } },
        },
      ],
    });
    const app = s.segments[0];
    expect(app).toMatchObject({
      kind: "app",
      clipFrom: 4.2,
      clipTo: 8,
      speed: 1,
      pauseAt: 1.5,
      frame: { src: "frames/chrome.png", inset: { x: 8, y: 10, w: 84, h: 78 } },
    });
  });

  it("accepts a zoomKeyframes camera track on app segments", () => {
    const s = SpecSchema.parse({
      ...valid,
      segments: [
        {
          kind: "app",
          asset: "recordings/scroll.mp4",
          text: "x",
          caption: "y",
          frame: { src: "frames/iphone.png", inset: { x: 18, y: 11, w: 64, h: 78 } },
          zoomKeyframes: [
            { at: 6.86, params: { scale: 1 } },
            { at: 11.12, params: { scale: 1.18, y: -4 } },
          ],
        },
      ],
    });
    expect(s.segments[0]).toMatchObject({
      zoomKeyframes: [
        { at: 6.86, params: { scale: 1 } },
        { at: 11.12, params: { scale: 1.18, y: -4 } },
      ],
    });
  });

  it("rejects clipTo <= clipFrom, non-positive speed, and inset overflow", () => {
    expect(() =>
      SpecSchema.parse({
        ...valid,
        segments: [{ kind: "app", asset: "a.mp4", text: "x", caption: "y", clipFrom: 5, clipTo: 5 }],
      }),
    ).toThrow();
    expect(() =>
      SpecSchema.parse({
        ...valid,
        segments: [{ kind: "app", asset: "a.mp4", text: "x", caption: "y", speed: 0 }],
      }),
    ).toThrow();
    expect(() =>
      SpecSchema.parse({
        ...valid,
        segments: [
          {
            kind: "app",
            asset: "a.mp4",
            text: "x",
            caption: "y",
            frame: { src: "f.png", inset: { x: 40, y: 0, w: 70, h: 100 } },
          },
        ],
      }),
    ).toThrow();
  });
});

describe("atWord anchors (motion keyframes/triggers)", () => {
  const motionSeg = (extra: Record<string, unknown>) => ({
    ...valid,
    segments: [{ kind: "motion", source: "motion/x.html", text: "Scan it now.", ...extra }],
  });
  it("accepts atWord (text or index) on motion triggers and keyframes", () => {
    expect(() =>
      parseSpec(
        motionSeg({
          triggers: [{ atWord: "scan", action: "pulse" }],
          keyframes: [{ atWord: 1, params: { pct: 86 } }],
        }),
      ),
    ).not.toThrow();
  });
  it("rejects an entry with both at and atWord", () => {
    expect(() => parseSpec(motionSeg({ triggers: [{ at: 1, atWord: "scan", action: "pulse" }] }))).toThrow(/exactly one/i);
  });
  it("rejects an entry with neither at nor atWord", () => {
    expect(() => parseSpec(motionSeg({ triggers: [{ action: "pulse" }] }))).toThrow(/exactly one/i);
  });
  it("does not accept atWord on non-motion tracks (backgroundKeyframes)", () => {
    expect(() => parseSpec({ ...valid, backgroundKeyframes: [{ atWord: "scan", params: { intensity: 1 } }] })).toThrow();
  });
});
