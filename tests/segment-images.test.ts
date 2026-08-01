import { describe, it, expect } from "vitest";
import { parseSpec } from "../src/spec/schema.js";

describe("segment images sugar", () => {
  it("expands images[] into layers bound to the beat", () => {
    const spec = parseSpec({
      title: "collage",
      segments: [
        {
          kind: "video",
          source: "images/bg.jpg",
          text: "hi",
          dur: 3,
          images: [
            {
              id: "left",
              src: "images/a.png",
              rect: { x: 0, y: 0, w: 50, h: 100 },
              flipX: true,
              keyframes: [{ at: 0, params: { x: -10 } }, { at: 1, params: { x: 0 } }],
              drive: { y: "wiggle(3, 1)" },
            },
          ],
        },
      ],
    });
    expect((spec.segments[0] as { images?: unknown }).images).toBeUndefined();
    const layer = spec.layers?.find((l) => l.id === "left");
    expect(layer?.segment).toBe(0);
    expect(layer?.flipX).toBe(true);
    expect(layer?.source?.kind).toBe("image");
    expect(layer?.drive?.y).toBe("wiggle(3, 1)");
  });

  it("rejects bad drive syntax on segment images", () => {
    expect(() =>
      parseSpec({
        title: "bad",
        segments: [{ kind: "video", source: "images/bg.jpg", dur: 2, images: [{ src: "images/a.png", drive: { x: "foo()" } }] }],
      }),
    ).toThrow(/drive\.x/);
  });

  it("expands inline svg images into layers with generated src", () => {
    const spec = parseSpec({
      title: "inline",
      segments: [
        {
          kind: "video",
          source: "images/bg.jpg",
          dur: 2,
          images: [{ id: "badge", svg: '<circle cx="50" cy="50" r="40" fill="red"/>' }],
        },
      ],
    });
    const layer = spec.layers?.find((l) => l.id === "badge");
    expect(layer?.source?.kind).toBe("image");
    expect(layer?.source?.src).toBe("generated/inline/badge.svg");
    expect(layer?.source?.svg).toContain("<circle");
  });

  it("accepts .svg file paths on segment images", () => {
    const spec = parseSpec({
      title: "svg-file",
      segments: [{ kind: "video", source: "images/bg.jpg", dur: 2, images: [{ src: "icons/star.svg" }] }],
    });
    expect(spec.layers?.[0]?.source?.src).toBe("icons/star.svg");
  });
});
