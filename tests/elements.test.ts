import { describe, it, expect } from "vitest";
import { resolveLogoSize, resolveLogoPosition, LOGO_SIZES, LOGO_POSITIONS } from "../src/render/elements.js";

describe("resolveLogoSize", () => {
  it("maps presets, passes through numbers, defaults to medium", () => {
    expect(resolveLogoSize("small")).toBe(LOGO_SIZES.small);
    expect(resolveLogoSize("medium")).toBe(150);
    expect(resolveLogoSize("big")).toBe(LOGO_SIZES.big);
    expect(resolveLogoSize(300)).toBe(300);
    expect(resolveLogoSize(undefined)).toBe(150);
  });
});

describe("resolveLogoPosition", () => {
  it("maps cardinal + center, passes through custom {x,y}, defaults to top", () => {
    expect(resolveLogoPosition("center")).toEqual({ x: 50, y: 50 });
    expect(resolveLogoPosition("bottom")).toEqual(LOGO_POSITIONS.bottom);
    expect(resolveLogoPosition("left")).toEqual({ x: 12, y: 50 });
    expect(resolveLogoPosition({ x: 20, y: 70 })).toEqual({ x: 20, y: 70 });
    expect(resolveLogoPosition(undefined)).toEqual(LOGO_POSITIONS.top);
  });
});
