import { describe, it, expect } from "vitest";
import { normalizeLayer, IDENTITY_TRANSFORM } from "../src/render/native/page/compositor/graph.js";

describe("normalizeLayer", () => {
  it("fills defaults for a minimal layer", () => {
    const l = normalizeLayer({ id: "bg", source: { providerId: "bg" }, rect: { x: 0, y: 0, w: 1080, h: 1920 } });
    expect(l.opacity).toBe(1);
    expect(l.blend).toBe("normal");
    expect(l.transform).toEqual(IDENTITY_TRANSFORM);
    expect(l.effects).toEqual([]);
    expect(l.mask).toBeUndefined();
  });

  it("defaults textGamma to the display gamma for text-class layers, 1 for everything else", () => {
    const base = { source: { providerId: "p" }, rect: { x: 0, y: 0, w: 10, h: 10 } };
    expect(normalizeLayer({ id: "caption3", ...base }).textGamma).toBe(2.2);
    expect(normalizeLayer({ id: "text1_0", ...base }).textGamma).toBe(2.2);
    expect(normalizeLayer({ id: "disclosure", ...base }).textGamma).toBe(2.2);
    expect(normalizeLayer({ id: "bg", ...base }).textGamma).toBe(1);
    expect(normalizeLayer({ id: "motion2", ...base }).textGamma).toBe(1);
  });

  it("lets a spec override textGamma on any layer, clamped to 0.1..4", () => {
    const base = { source: { providerId: "p" }, rect: { x: 0, y: 0, w: 10, h: 10 } };
    expect(normalizeLayer({ id: "motion2", textGamma: 1.8, ...base }).textGamma).toBe(1.8);
    expect(normalizeLayer({ id: "caption0", textGamma: 1, ...base }).textGamma).toBe(1);
    expect(normalizeLayer({ id: "bg", textGamma: 99, ...base }).textGamma).toBe(4);
    expect(normalizeLayer({ id: "bg", textGamma: 0, ...base }).textGamma).toBe(0.1);
  });

  it("preserves explicit values", () => {
    const l = normalizeLayer({
      id: "cap", source: { providerId: "cap", key: "word-3" },
      rect: { x: 0, y: 1400, w: 1080, h: 300 },
      opacity: 0.5, blend: "screen",
      transform: { scale: 1.08, rotate: 0, translate: [0, -12] },
    });
    expect(l.opacity).toBe(0.5);
    expect(l.blend).toBe("screen");
    expect(l.transform.scale).toBe(1.08);
    expect(l.source.key).toBe("word-3");
  });

  it("clamps opacity into 0..1", () => {
    expect(normalizeLayer({ id: "a", source: { providerId: "a" }, rect: { x: 0, y: 0, w: 1, h: 1 }, opacity: 1.5 }).opacity).toBe(1);
    expect(normalizeLayer({ id: "a", source: { providerId: "a" }, rect: { x: 0, y: 0, w: 1, h: 1 }, opacity: -3 }).opacity).toBe(0);
  });
});
