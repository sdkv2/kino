import { describe, it, expect } from "vitest";
import { FONTS, lookupFont } from "../src/fonts/registry.js";

describe("font registry", () => {
  it("lists 12 fonts, each with a name, family, description, and weight", () => {
    expect(FONTS).toHaveLength(12);
    for (const f of FONTS) {
      expect(f.name).toBeTruthy();
      expect(f.family).toBeTruthy();
      expect(f.description.length).toBeGreaterThan(3);
      expect(f.weight).toBeGreaterThan(0);
    }
  });
  it("looks up by name case-insensitively, undefined for unknown", () => {
    expect(lookupFont("anton")?.name).toBe("Anton");
    expect(lookupFont("ANTON")?.family).toBe("Anton");
    expect(lookupFont("Comic Sans")).toBeUndefined();
  });
});
