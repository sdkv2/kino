import { describe, it, expect } from "vitest";
import { BrandSchema } from "../src/config/brand.js";

describe("BrandSchema", () => {
  it("accepts a minimal valid brand", () => {
    const b = BrandSchema.parse({
      name: "EvidentCV",
      colors: { night: "#0b1020", mint: "#80e2b4", green: "#0c8d64" },
      disclosure: "AI avatar & voice · real app, sample data",
      bannedPhrases: ["get the job", "guaranteed interview"],
      defaultVoice: "will",
    });
    expect(b.name).toBe("EvidentCV");
    expect(b.bannedPhrases).toContain("get the job");
  });

  it("rejects a brand missing required colors", () => {
    expect(() => BrandSchema.parse({ name: "x", colors: {}, disclosure: "d" })).toThrow();
  });
});
