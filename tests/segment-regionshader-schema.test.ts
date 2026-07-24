import { describe, it, expect } from "vitest";
import { SpecSchema } from "../src/spec/schema.js";

const valid = {
  brand: "acme",
  title: "seg-region",
  segments: [{ kind: "video", source: "clip.mp4", text: "hi", caption: "hi" }],
};

describe("SpecSchema video beat regionShader", () => {
  it("parses a regionShader with a mask + subject body", () => {
    const s = SpecSchema.parse({
      ...valid,
      segments: [{ ...valid.segments[0], regionShader: { mask: "masks/x", subject: "a.frag" } }],
    });
    const seg = s.segments[0];
    expect(seg.kind === "video" && seg.regionShader?.mask).toBe("masks/x");
    expect(seg.kind === "video" && seg.regionShader?.object).toBe(0); // default
  });

  it("rejects a regionShader with neither subject nor background", () => {
    expect(() =>
      SpecSchema.parse({
        ...valid,
        segments: [{ ...valid.segments[0], regionShader: { mask: "masks/x" } }],
      }),
    ).toThrow();
  });

  it("parses a regionShader with a masks[] union (multiple mask sources)", () => {
    const s = SpecSchema.parse({
      ...valid,
      segments: [
        {
          ...valid.segments[0],
          regionShader: {
            masks: [
              { mask: "masks/dog1", object: 0 },
              { mask: "masks/dog2", object: 0 },
            ],
            subject: "a.frag",
            background: "b.frag",
          },
        },
      ],
    });
    const seg = s.segments[0];
    expect(seg.kind === "video" && seg.regionShader?.masks?.length).toBe(2);
    expect(seg.kind === "video" && seg.regionShader?.masks?.[1].mask).toBe("masks/dog2");
  });

  it("parses a per-entry subject on a masks[] entry", () => {
    const s = SpecSchema.parse({
      ...valid,
      segments: [
        {
          ...valid.segments[0],
          regionShader: {
            masks: [
              { mask: "masks/dog", subject: "a.frag" },
              { mask: "masks/ball", object: 1, subject: "b.frag" },
              { mask: "masks/hand" },
            ],
            subject: "fallback.frag",
            background: "bg.frag",
          },
        },
      ],
    });
    const seg = s.segments[0];
    expect(seg.kind === "video" && seg.regionShader?.masks?.[0].subject).toBe("a.frag");
    expect(seg.kind === "video" && seg.regionShader?.masks?.[1].object).toBe(1);
    expect(seg.kind === "video" && seg.regionShader?.masks?.[2].subject).toBe(undefined);
  });

  // Per-object regions can be the WHOLE spec: every mask shades itself, nothing falls back, and the
  // background passes the beat asset through. The "needs a body" refine must count those.
  it("accepts per-entry subjects as the only shader bodies", () => {
    const s = SpecSchema.parse({
      ...valid,
      segments: [{ ...valid.segments[0], regionShader: { masks: [{ mask: "masks/dog", subject: "a.frag" }] } }],
    });
    expect(s.segments[0].kind === "video").toBe(true);
  });

  it("still rejects a regionShader with no shader body anywhere", () => {
    expect(() =>
      SpecSchema.parse({
        ...valid,
        segments: [{ ...valid.segments[0], regionShader: { masks: [{ mask: "masks/dog" }] } }],
      }),
    ).toThrow();
  });

  it("rejects a regionShader with neither mask nor masks", () => {
    expect(() =>
      SpecSchema.parse({
        ...valid,
        segments: [{ ...valid.segments[0], regionShader: { subject: "a.frag" } }],
      }),
    ).toThrow();
  });
});
