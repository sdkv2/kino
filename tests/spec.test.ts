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
