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
