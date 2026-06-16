import { describe, it, expect } from "vitest";
import { withAlpha, resolveCaptionBackplate } from "../src/render/elements.js";

describe("withAlpha", () => {
  it("appends an alpha byte to a 6-digit hex", () => {
    expect(withAlpha("#0b1020", 0.82)).toBe("#0b1020d1"); // 0.82*255 = 209 = 0xd1
    expect(withAlpha("#000000", 1)).toBe("#000000ff");
    expect(withAlpha("#ffffff", 0)).toBe("#ffffff00");
  });

  it("expands a 3-digit hex before appending alpha", () => {
    expect(withAlpha("#abc", 1)).toBe("#aabbccff");
  });

  it("clamps opacity into 0..1", () => {
    expect(withAlpha("#101010", 2)).toBe("#101010ff");
    expect(withAlpha("#101010", -1)).toBe("#10101000");
  });

  it("passes non-hex colours through unchanged (best effort)", () => {
    expect(withAlpha("red", 0.5)).toBe("red");
    expect(withAlpha("rgb(1,2,3)", 0.5)).toBe("rgb(1,2,3)");
  });
});

describe("resolveCaptionBackplate", () => {
  it("returns null when unconfigured (no behaviour change)", () => {
    expect(resolveCaptionBackplate(undefined, "#0b1020")).toBeNull();
  });

  it("defaults colour to the brand night, opacity 0.82, appOnly true", () => {
    expect(resolveCaptionBackplate({}, "#0b1020")).toEqual({ bg: "#0b1020d1", appOnly: true });
  });

  it("honours explicit colour / opacity / appOnly", () => {
    expect(resolveCaptionBackplate({ color: "#111111", opacity: 0.5, appOnly: false }, "#0b1020")).toEqual({
      bg: "#11111180", // 0.5*255 = 128 = 0x80
      appOnly: false,
    });
  });
});
