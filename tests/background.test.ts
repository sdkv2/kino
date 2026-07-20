import { describe, it, expect } from "vitest";
import { resolveBackgroundKind, resolveBackgroundColors, resolveBackgroundIntensity } from "../src/render/background.js";
import type { Brand } from "../src/config/brand.js";
import type { Spec } from "../src/spec/schema.js";

const palette = { night: "#000", mint: "#1", green: "#2", gold: "#3", white: "#fff" };

describe("resolveBackgroundKind", () => {
  it("defaults to glow when nothing is set", () => {
    expect(resolveBackgroundKind({} as unknown as Brand, {} as unknown as Spec)).toBe("glow");
  });
  it("does not infer image from facelessBackdrop alone — set background explicitly", () => {
    expect(resolveBackgroundKind({ facelessBackdrop: "bg.png" } as unknown as Brand, {} as unknown as Spec)).toBe("glow");
  });
  it("honours brand.background", () => {
    expect(
      resolveBackgroundKind({ facelessBackdrop: "bg.png", background: "image" } as unknown as Brand, {} as unknown as Spec),
    ).toBe("image");
  });
  it("spec.background wins over the brand", () => {
    expect(
      resolveBackgroundKind({ background: "mesh" } as unknown as Brand, { background: "aurora" } as unknown as Spec),
    ).toBe("aurora");
  });
});

describe("resolveBackgroundColors", () => {
  it("derives [mint, green, gold] from the brand palette by default", () => {
    expect(resolveBackgroundColors({ colors: palette } as unknown as Brand)).toEqual(["#1", "#2", "#3"]);
  });
  it("honours an explicit backgroundColors override", () => {
    expect(
      resolveBackgroundColors({ colors: palette, backgroundColors: ["#a", "#b"] } as unknown as Brand),
    ).toEqual(["#a", "#b"]);
  });
});

describe("resolveBackgroundIntensity", () => {
  it("defaults to 0.5; brand overrides; spec wins over brand", () => {
    expect(resolveBackgroundIntensity({} as unknown as Brand, {} as unknown as Spec)).toBe(0.5);
    expect(resolveBackgroundIntensity({ backgroundIntensity: 0.8 } as unknown as Brand, {} as unknown as Spec)).toBe(0.8);
    expect(
      resolveBackgroundIntensity({ backgroundIntensity: 0.8 } as unknown as Brand, { backgroundIntensity: 0.2 } as unknown as Spec),
    ).toBe(0.2);
  });
});
