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

  it("accepts params + beat-relative keyframes", () => {
    const s = SpecSchema.parse({
      ...valid,
      segments: [
        {
          ...valid.segments[0],
          regionShader: {
            mask: "masks/x",
            subject: "a.frag",
            params: { rim: 2, colorA: "#80e2b4" },
            keyframes: [{ at: 0, params: { rim: 2 } }, { at: 1.2, params: { rim: 14 }, ease: "easeInOut" }],
          },
        },
      ],
    });
    const seg = s.segments[0];
    expect(seg.kind === "video" && seg.regionShader?.params).toEqual({ rim: 2, colorA: "#80e2b4" });
    expect(seg.kind === "video" && seg.regionShader?.keyframes?.[1].at).toBe(1.2);
    expect(seg.kind === "video" && seg.regionShader?.keyframes?.[1].ease).toBe("easeInOut");
  });

  // The ceiling is on the UNION across params + every keyframe, because all bodies share ONE
  // uParam0..3 bank. extraParamNames silently slices past 4, which on a shared bank means a fifth
  // param quietly does nothing in up to six bodies at once — fail loudly instead.
  it("rejects more than 4 numeric params across params + keyframes", () => {
    expect(() =>
      SpecSchema.parse({
        ...valid,
        segments: [
          {
            ...valid.segments[0],
            regionShader: {
              mask: "masks/x",
              subject: "a.frag",
              params: { a: 1, b: 2, c: 3 },
              keyframes: [{ at: 1, params: { d: 4, e: 5 } }],
            },
          },
        ],
      }),
    ).toThrow(/uParam slots/);
  });

  it("does not count colorA/B/C or intensity against the 4 slots", () => {
    const s = SpecSchema.parse({
      ...valid,
      segments: [
        {
          ...valid.segments[0],
          regionShader: {
            mask: "masks/x",
            subject: "a.frag",
            // 4 numeric names + all 4 reserved ones — reserved drive their own uniforms, cost 0 slots.
            params: { a: 1, b: 2, c: 3, d: 4, colorA: "#fff", colorB: "#000", colorC: "#123456", intensity: 0.5 },
          },
        },
      ],
    });
    expect(s.segments[0].kind === "video").toBe(true);
  });

  it("parses texture channels and caps them at the two free uTex slots", () => {
    const s = SpecSchema.parse({
      ...valid,
      segments: [
        {
          ...valid.segments[0],
          regionShader: { mask: "masks/x", subject: "a.frag", textures: ["motion/badge.html", "sticker.png"] },
        },
      ],
    });
    const seg = s.segments[0];
    expect(seg.kind === "video" && seg.regionShader?.textures).toEqual(["motion/badge.html", "sticker.png"]);
    // A 3rd channel has no uTex to bind to (uTex0 is the beat's own asset, uTex1 the cutout
    // backdrop) — reject rather than drop.
    expect(() =>
      SpecSchema.parse({
        ...valid,
        segments: [
          { ...valid.segments[0], regionShader: { mask: "masks/x", subject: "a.frag", textures: ["a.html", "b.html", "c.html"] } },
        ],
      }),
    ).toThrow();
  });

  // Cutout compositing: `backdrop` is a SECOND source for the background region, and it is a
  // complete spec on its own — mask + backdrop with no .frag anywhere IS the virtual greenscreen,
  // so the "needs a body" refine has to count it.
  it("parses a backdrop as the only thing besides the mask", () => {
    const s = SpecSchema.parse({
      ...valid,
      segments: [{ ...valid.segments[0], regionShader: { mask: "masks/x", backdrop: "pexels/beach.mp4" } }],
    });
    const seg = s.segments[0];
    expect(seg.kind === "video" && seg.regionShader?.backdrop).toBe("pexels/beach.mp4");
  });

  it("accepts a backdrop alongside shader bodies", () => {
    const s = SpecSchema.parse({
      ...valid,
      segments: [
        { ...valid.segments[0], regionShader: { mask: "masks/x", subject: "a.frag", background: "b.frag", backdrop: "b.mp4" } },
      ],
    });
    expect(s.segments[0].kind === "video").toBe(true);
  });

  // The object stays strict — a typo'd key must not be silently stripped into a beat that renders
  // the beat's own plate behind the subject and looks merely disappointing.
  it("rejects a misspelled backdrop key", () => {
    expect(() =>
      SpecSchema.parse({
        ...valid,
        segments: [{ ...valid.segments[0], regionShader: { mask: "masks/x", backdropp: "pexels/beach.mp4" } }],
      }),
    ).toThrow();
  });

  // No trigger surface this phase (YAGNI) — a spec reaching for one should fail loudly, not have
  // the key silently stripped and render an unexplained still frame.
  it("rejects triggers on a regionShader", () => {
    expect(() =>
      SpecSchema.parse({
        ...valid,
        segments: [
          { ...valid.segments[0], regionShader: { mask: "masks/x", subject: "a.frag", triggers: [{ at: 0, action: "pulse" }] } },
        ],
      }),
    ).toThrow();
  });
});
