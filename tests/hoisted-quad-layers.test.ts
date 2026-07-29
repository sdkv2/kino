// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  measureHoistedQuads,
  parseQuadLayer,
  quadsForLayer,
} from "../src/render/native/page/underlay.js";

describe("hoisted quad layers", () => {
  it("parseQuadLayer defaults unknown values to sample", () => {
    expect(parseQuadLayer(null)).toBe("sample");
    expect(parseQuadLayer("")).toBe("sample");
    expect(parseQuadLayer("sample")).toBe("sample");
    expect(parseQuadLayer("chrome")).toBe("chrome");
    expect(parseQuadLayer("CHROME")).toBe("chrome");
    expect(parseQuadLayer("foreground")).toBe("sample");
  });

  it("quadsForLayer routes by batch", () => {
    const quads = [
      { src: "/a.png", relLeft: 0, relTop: 0, w: 10, h: 10 },
      { src: "/b.png", relLeft: 1, relTop: 1, w: 10, h: 10, layer: "chrome" as const },
      { src: "/c.png", relLeft: 2, relTop: 2, w: 10, h: 10, layer: "sample" as const },
    ];
    expect(quadsForLayer(quads, "sample").map((q) => q.src)).toEqual(["/a.png", "/c.png"]);
    expect(quadsForLayer(quads, "chrome").map((q) => q.src)).toEqual(["/b.png"]);
  });

  it("measureHoistedQuads reads data-layer and omits default sample", () => {
    const host = document.createElement("div");
    host.style.cssText = "position:relative;width:200px;height:100px";
    const mk = (cls: string, attrs: string, rect: DOMRect) => {
      const el = document.createElement("div");
      el.className = cls;
      for (const part of attrs.split(" ")) {
        const [k, v] = part.split("=");
        if (k && v) el.setAttribute(k, v);
      }
      el.getBoundingClientRect = () => rect;
      host.appendChild(el);
      return el;
    };
    mk(
      "thumb-q kino-quad",
      "data-src=/public/a.jpg",
      { left: 0, top: 0, right: 40, bottom: 30, width: 40, height: 30, x: 0, y: 0, toJSON: () => ({}) } as DOMRect,
    );
    mk(
      "dock-q kino-quad",
      "data-layer=chrome data-src=/public/b.png",
      { left: 50, top: 10, right: 70, bottom: 30, width: 20, height: 20, x: 50, y: 10, toJSON: () => ({}) } as DOMRect,
    );
    host.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    const quads = measureHoistedQuads(host, host.getBoundingClientRect());
    expect(quads).toHaveLength(2);
    const sample = quads.find((q) => q.src.endsWith("a.jpg"));
    const chrome = quads.find((q) => q.src.endsWith("b.png"));
    expect(sample?.layer).toBeUndefined();
    expect(chrome?.layer).toBe("chrome");
  });
});
