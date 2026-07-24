import { describe, it, expect } from "vitest";
import { SpecSchema } from "../src/spec/schema.js";

const valid = {
  brand: "acme",
  title: "seg-tex",
  segments: [{ kind: "avatar", text: "hi", caption: "hi" }],
};

describe("SpecSchema backgroundTextures video kind", () => {
  it("parses a { source, kind: 'video' } texture entry", () => {
    const s = SpecSchema.parse({ ...valid, backgroundTextures: [{ source: "masks/x/mask.mp4", kind: "video" }] });
    expect(s.backgroundTextures).toEqual([{ source: "masks/x/mask.mp4", kind: "video" }]);
  });
  it("still parses string and { source, param } entries", () => {
    const s = SpecSchema.parse({
      ...valid,
      backgroundTextures: ["tex/a.png", { source: "tex/b.html", param: "reveal" }],
    });
    expect(s.backgroundTextures).toHaveLength(2);
  });
  it("rejects a bogus kind", () => {
    expect(() =>
      SpecSchema.parse({ ...valid, backgroundTextures: [{ source: "masks/x/mask.mp4", kind: "nope" }] }),
    ).toThrow();
  });
});
