import { describe, it, expect } from "vitest";
import { SpecSchema } from "../src/spec/schema.js";

const valid = {
  brand: "evidentcv",
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
