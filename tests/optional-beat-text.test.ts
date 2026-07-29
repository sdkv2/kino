import { describe, it, expect } from "vitest";
import { assertBeatLengths } from "../src/spec/validate.js";
import { SpecSchema } from "../src/spec/schema.js";
import type { Spec } from "../src/spec/schema.js";

const spec = (segments: unknown[]) => ({ segments } as unknown as Spec);
const motion = (extra: Record<string, unknown>) => ({ kind: "motion", source: "motion/x.html", ...extra });

describe("assertBeatLengths", () => {
  it("rejects a beat with neither text nor dur — nothing defines its length", () => {
    expect(() => assertBeatLengths(spec([motion({})]))).toThrow(/segment\[0\].*no "text".*length/s);
  });

  it("accepts a purely visual beat that declares its own dur", () => {
    expect(() => assertBeatLengths(spec([motion({ dur: 1.5 })]))).not.toThrow();
  });

  it("accepts a speaking beat with no dur — the speech sets the length", () => {
    expect(() => assertBeatLengths(spec([motion({ text: "hello there" })]))).not.toThrow();
  });

  it("accepts a voFile beat with neither — the audio file sets the length", () => {
    expect(() => assertBeatLengths(spec([motion({ voFile: "vo/a.mp3" })]))).not.toThrow();
  });

  it("treats whitespace-only text as absent", () => {
    expect(() => assertBeatLengths(spec([motion({ text: "   " })]))).toThrow(/no "text"/);
    expect(() => assertBeatLengths(spec([motion({ text: "   ", dur: 2 })]))).not.toThrow();
  });

  it("names every offending beat, not just the first", () => {
    const e = (() => {
      try {
        assertBeatLengths(spec([motion({ dur: 1 }), motion({}), motion({ text: "ok" }), motion({})]));
      } catch (err) {
        return (err as Error).message;
      }
    })();
    expect(e).toMatch(/segment\[1\]/);
    expect(e).toMatch(/segment\[3\]/);
    expect(e).not.toMatch(/segment\[0\]/);
    expect(e).not.toMatch(/segment\[2\]/);
  });
});

describe("schema: segment text is optional", () => {
  const base = { title: "t", format: ["16:9"], fps: 30, provider: "none" };

  it("parses a motion beat with no text", () => {
    const r = SpecSchema.safeParse({
      ...base,
      segments: [{ kind: "motion", source: "motion/x.html", dur: 1.5 }],
    });
    expect(r.success).toBe(true);
  });

  it("parses scene and video beats with no text", () => {
    for (const seg of [
      { kind: "scene", dur: 1 },
      { kind: "video", source: "a.mp4", dur: 1 },
    ]) {
      expect(SpecSchema.safeParse({ ...base, segments: [seg] }).success).toBe(true);
    }
  });

  it("still rejects an empty-string text (omit it instead)", () => {
    const r = SpecSchema.safeParse({
      ...base,
      segments: [{ kind: "motion", source: "motion/x.html", text: "", dur: 1 }],
    });
    expect(r.success).toBe(false);
  });

  it("keeps text required on a texts[] overlay — an overlay with no words has nothing to draw", () => {
    const r = SpecSchema.safeParse({
      ...base,
      segments: [{ kind: "motion", source: "motion/x.html", dur: 1, texts: [{ at: 0 }] }],
    });
    expect(r.success).toBe(false);
  });
});
