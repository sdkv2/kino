import { describe, it, expect } from "vitest";
import { SpecSchema } from "../src/spec/schema.js";

describe("SpecSchema loop field", () => {
  it("accepts loop:true on a motionOverlay", () => {
    const spec = SpecSchema.parse({
      title: "t",
      segments: [
        { kind: "app", asset: "screens/x.png", text: "look", caption: "c",
          motionOverlay: { source: "motion/sparkle.json", loop: true } },
      ],
    });
    expect((spec.segments[0] as any).motionOverlay.loop).toBe(true);
  });

  it("accepts loop on a kind:motion segment and defaults it to undefined when omitted", () => {
    const spec = SpecSchema.parse({
      title: "t",
      segments: [{ kind: "motion", source: "motion/confetti.json", text: "hi", loop: false }],
    });
    expect((spec.segments[0] as any).loop).toBe(false);
    const spec2 = SpecSchema.parse({
      title: "t",
      segments: [{ kind: "motion", source: "motion/confetti.json", text: "hi" }],
    });
    expect((spec2.segments[0] as any).loop).toBeUndefined();
  });

  it("rejects a non-boolean loop", () => {
    expect(() =>
      SpecSchema.parse({ title: "t", segments: [{ kind: "motion", source: "m/x.json", text: "h", loop: 1 }] }),
    ).toThrow();
  });
});
