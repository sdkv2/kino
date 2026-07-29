import { describe, it, expect } from "vitest";
import { measureLayers } from "../src/render/measure.js";
import { normalizeLayer } from "../src/render/native/page/compositor/graph.js";

const DIMS = { width: 1080, height: 1920 };
const layer = (id: string, rect: { x: number; y: number; w: number; h: number }, transform?: { scale: number; rotate: number; translate: [number, number] }) =>
  normalizeLayer({ id, source: { providerId: id }, rect, transform });

describe("measureLayers", () => {
  it("reports a full-frame layer as centered", () => {
    const [m] = measureLayers([layer("caption0", { x: 0, y: 0, w: 1080, h: 1920 })], DIMS);
    expect(m.label).toBe("caption0");
    expect(m.cxPct).toBeCloseTo(50, 5);
    expect(m.dxPct).toBeCloseTo(0, 5);
    expect(m.dyPct).toBeCloseTo(0, 5);
  });

  it("reports an off-center layer's signed offset", () => {
    const [m] = measureLayers([layer("logo", { x: 0, y: 0, w: 108, h: 108 })], DIMS);
    expect(m.cxPct).toBeCloseTo(5, 4);
    expect(m.dxPct).toBeCloseTo(-45, 4);
    expect(m.dyPct).toBeCloseTo(-47.1875, 4);
  });

  it("accounts for the layer transform, not just the rect", () => {
    const scaled = layer("seg0", { x: 0, y: 0, w: 1080, h: 1920 }, { scale: 2, rotate: 0, translate: [0, 0] });
    const [m] = measureLayers([scaled], DIMS);
    expect(m.w).toBeCloseTo(2160, 5);
    expect(m.h).toBeCloseTo(3840, 5);
    expect(m.cxPct).toBeCloseTo(50, 5);
  });

  it("accounts for translation", () => {
    const moved = layer("cap", { x: 0, y: 0, w: 1080, h: 1920 }, { scale: 1, rotate: 0, translate: [108, 0] });
    const [m] = measureLayers([moved], DIMS);
    expect(m.dxPct).toBeCloseTo(10, 4);
  });

  it("measures every layer, in draw order", () => {
    const ms = measureLayers([
      layer("backdrop", { x: 0, y: 0, w: 1080, h: 1920 }),
      layer("caption0", { x: 0, y: 1400, w: 1080, h: 300 }),
    ], DIMS);
    expect(ms.map((m) => m.label)).toEqual(["backdrop", "caption0"]);
  });

  it("returns an empty list for no layers", () => {
    expect(measureLayers([], DIMS)).toEqual([]);
  });

  it("drops adjustment layers (source: null) — they paint no pixels of their own", () => {
    const film = normalizeLayer({ id: "film", source: null, rect: { x: 0, y: 0, w: 1080, h: 1920 }, adjust: [] });
    const ms = measureLayers([
      layer("backdrop", { x: 0, y: 0, w: 1080, h: 1920 }),
      film,
    ], DIMS);
    expect(ms.map((m) => m.label)).toEqual(["backdrop"]);
    expect(ms.some((m) => m.label === "film")).toBe(false);
  });
});
