import { describe, it, expect } from "vitest";
import { SpecSchema } from "../src/spec/schema.js";

const valid = {
  brand: "acme",
  title: "fps-spec",
  segments: [{ kind: "avatar", text: "hi", caption: "hi" }],
};

describe("SpecSchema fps", () => {
  it("is optional — omitting it leaves the 30fps default to the render layer", () => {
    expect(SpecSchema.parse(valid).fps).toBeUndefined();
  });

  it("carries a higher rate through, so 60fps footage is not resampled to every other frame", () => {
    expect(SpecSchema.parse({ ...valid, fps: 60 }).fps).toBe(60);
  });

  it("rejects a fractional rate — frames are counted, not interpolated", () => {
    expect(() => SpecSchema.parse({ ...valid, fps: 29.97 })).toThrow();
  });

  it("rejects nonsense rates", () => {
    expect(() => SpecSchema.parse({ ...valid, fps: 0 })).toThrow();
    expect(() => SpecSchema.parse({ ...valid, fps: 240 })).toThrow();
  });
});
