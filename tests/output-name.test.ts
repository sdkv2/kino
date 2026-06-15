import { describe, it, expect } from "vitest";
import { variantName } from "../src/render/render.js";

describe("variantName", () => {
  it("returns the title unchanged when there is no tag", () => {
    expect(variantName("spot-the-lie")).toBe("spot-the-lie");
  });
  it("appends a tag so variants are stored side-by-side instead of overwriting", () => {
    expect(variantName("spot-the-lie", "aurora")).toBe("spot-the-lie-aurora");
  });
  it("treats an empty tag as no tag", () => {
    expect(variantName("spot-the-lie", "")).toBe("spot-the-lie");
  });
});
