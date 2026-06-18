import { describe, it, expect } from "vitest";
import { SpecSchema } from "../src/spec/schema.js";
import { parseLottie } from "../src/render/lottie.js";

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

const minimalLottie = () => ({
  v: "5.7.4", fr: 30, ip: 0, op: 60, w: 1080, h: 1920, layers: [],
});

describe("parseLottie", () => {
  it("parses a minimal valid Lottie", () => {
    const { data } = parseLottie(JSON.stringify(minimalLottie()));
    expect(data.w).toBe(1080);
    expect(data.layers).toEqual([]);
  });
  it("throws on malformed JSON", () => {
    expect(() => parseLottie("{not json")).toThrow(/not valid JSON/i);
  });
  it("throws when core Bodymovin fields are missing", () => {
    const bad = JSON.stringify({ v: "5", w: 10, h: 10 }); // no fr/ip/op/layers
    expect(() => parseLottie(bad)).toThrow(/not a Lottie animation/i);
  });
  it("throws when duration is indeterminable (op <= ip or fr <= 0)", () => {
    const noDur = JSON.stringify({ ...minimalLottie(), op: 0, ip: 0 });
    expect(() => parseLottie(noDur)).toThrow(/determinable duration/i);
    const noFr = JSON.stringify({ ...minimalLottie(), fr: 0 });
    expect(() => parseLottie(noFr)).toThrow(/determinable duration/i);
  });
  it("throws when the top level is not a JSON object", () => {
    expect(() => parseLottie("[1,2,3]")).toThrow(/Lottie/i);
  });
});
