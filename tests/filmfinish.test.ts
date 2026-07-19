import { describe, it, expect } from "vitest";
import { luminance, filmFinishParams } from "../src/render/filmFinish.js";

describe("luminance", () => {
  it("reads light vs dark hex", () => {
    expect(luminance("#F5F5F7")).toBeGreaterThan(0.5);
    expect(luminance("#0A0A0A")).toBeLessThan(0.5);
    expect(luminance("#141414")).toBeLessThan(0.5); // kino's ink `night` — why it misreads as "dark"
  });
});

describe("filmFinishParams", () => {
  it("full intensity (default) reproduces the legacy dark-brand vignette + grain", () => {
    const p = filmFinishParams("#0A0A0A", 1);
    expect(p.grainOpacity).toBeCloseTo(0.09);
    expect(p.vignette).toContain("rgba(0,0,0,0.460)");
  });
  it("full intensity reproduces the legacy light-brand vignette + grain", () => {
    const p = filmFinishParams("#F5F5F7", 1);
    expect(p.grainOpacity).toBeCloseTo(0.05);
    expect(p.vignette).toContain("rgba(28,20,12,0.180)");
  });
  it("intensity 0 removes the vignette and grain entirely (clean paper edges)", () => {
    const p = filmFinishParams("#F5F5F7", 0);
    expect(p.grainOpacity).toBe(0);
    expect(p.vignette).toContain("rgba(28,20,12,0.000)");
  });
  it("scales both effects linearly between 0 and 1", () => {
    const p = filmFinishParams("#0A0A0A", 0.5);
    expect(p.grainOpacity).toBeCloseTo(0.045);
    expect(p.vignette).toContain("rgba(0,0,0,0.230)");
  });
  it("defaults intensity to 1 when undefined", () => {
    expect(filmFinishParams("#0A0A0A").grainOpacity).toBeCloseTo(0.09);
  });
});
