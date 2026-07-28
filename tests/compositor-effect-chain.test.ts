import { describe, it, expect, afterAll } from "vitest";
import { glProbe, closeGlHost } from "./helpers/glHost.js";

afterAll(closeGlHost);

async function chainValue(passes: string[]): Promise<number> {
  return glProbe<[string[]], number>({
    entry: "src/render/native/page/compositor/effects/chain.ts",
    globalName: "KinoChain",
    html: `<!doctype html><body><canvas id="c" width="16" height="16"></canvas></body>`,
    fn: (passes) =>
      (window as any).KinoChain.probeChain(document.getElementById("c") as HTMLCanvasElement, passes),
    args: [passes],
  });
}

describe("runChain", () => {
  it("applies passes in order — two halvings quarter the value", async () => {
    const value = await chainValue(["halve", "halve"]);
    // 1.0 → 0.5 → 0.25 in linear light. The chain writes pool targets, which are SRGB8_ALPHA8,
    // so the byte read back is the sRGB ENCODING of 0.25 — 137, not 64. The halving arithmetic
    // this test exists to check is unchanged; only the storage encoding is.
    expect(value).toBeGreaterThanOrEqual(134);
    expect(value).toBeLessThanOrEqual(140);
  }, 120000);

  it("returns the source unchanged for an empty chain", async () => {
    expect(await chainValue([])).toBe(255);
  }, 120000);
});
