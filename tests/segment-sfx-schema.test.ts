// Schema shape for beat-level sound effects. The anchoring rules are enforced here rather than at
// build time so a malformed placement fails on `kino validate`, before anything is rendered.
import { describe, it, expect } from "vitest";
import { SpecSchema } from "../src/spec/schema.js";

const spec = (sfx: unknown) => ({
  title: "seg-sfx",
  segments: [{ kind: "scene", text: "it should be doing something", caption: "x", sfx }],
});

describe("segment sfx schema", () => {
  it("accepts a beat-relative `at`", () => {
    const s = SpecSchema.parse(spec([{ src: "sfx/click.wav", at: 0.4 }]));
    expect((s.segments[0] as { sfx: { at: number }[] }).sfx[0].at).toBe(0.4);
  });

  it("accepts an `atWord` anchor, by word or by index", () => {
    expect(() => SpecSchema.parse(spec([{ src: "sfx/click.wav", atWord: "doing" }]))).not.toThrow();
    expect(() => SpecSchema.parse(spec([{ src: "sfx/click.wav", atWord: 3 }]))).not.toThrow();
  });

  it("requires exactly one anchor — neither is as wrong as both", () => {
    expect(() => SpecSchema.parse(spec([{ src: "sfx/click.wav" }]))).toThrow(/exactly one of at \/ atWord/);
    expect(() => SpecSchema.parse(spec([{ src: "sfx/click.wav", at: 1, atWord: "doing" }]))).toThrow(/exactly one of at \/ atWord/);
  });

  it("rejects `offset` without `atWord`", () => {
    // With a plain `at` the offset would be a second number for one instant, and which one reads
    // as authoritative depends on which the author looked at last.
    expect(() => SpecSchema.parse(spec([{ src: "sfx/click.wav", at: 1, offset: -0.04 }]))).toThrow(/offset needs atWord/);
  });

  it("allows a negative offset — a transient often wants to land just BEFORE the word", () => {
    expect(() => SpecSchema.parse(spec([{ src: "sfx/click.wav", atWord: "doing", offset: -0.04 }]))).not.toThrow();
  });

  it("shares the mixer knobs with a top-level effect", () => {
    const s = SpecSchema.parse(spec([{ src: "sfx/click.wav", atWord: "doing", volume: 0.5, pan: -0.8, rate: 1.5 }]));
    expect((s.segments[0] as { sfx: Record<string, unknown>[] }).sfx[0]).toMatchObject({ volume: 0.5, pan: -0.8, rate: 1.5 });
  });

  it("still rejects unknown keys", () => {
    expect(() => SpecSchema.parse(spec([{ src: "sfx/click.wav", at: 1, atword: "doing" }]))).toThrow();
  });

  it("no longer tells the author sfx is top-level only", () => {
    // The rejection message that used to fire here is gone; segment sfx are the recommended shape.
    expect(() => SpecSchema.parse(spec([{ src: "sfx/click.wav", at: 1 }]))).not.toThrow();
  });
});
