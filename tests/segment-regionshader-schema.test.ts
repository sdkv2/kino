import { describe, it, expect } from "vitest";
import { SpecSchema } from "../src/spec/schema.js";

const valid = {
  brand: "acme",
  title: "seg-region",
  segments: [{ kind: "app", asset: "clip.mp4", text: "hi", caption: "hi" }],
};

describe("SpecSchema app beat regionShader", () => {
  it("parses a regionShader with a mask + subject body", () => {
    const s = SpecSchema.parse({
      ...valid,
      segments: [{ ...valid.segments[0], regionShader: { mask: "masks/x", subject: "a.frag" } }],
    });
    const seg = s.segments[0];
    expect(seg.kind === "app" && seg.regionShader?.mask).toBe("masks/x");
    expect(seg.kind === "app" && seg.regionShader?.object).toBe(0); // default
  });

  it("rejects a regionShader with neither subject nor background", () => {
    expect(() =>
      SpecSchema.parse({
        ...valid,
        segments: [{ ...valid.segments[0], regionShader: { mask: "masks/x" } }],
      }),
    ).toThrow();
  });
});
