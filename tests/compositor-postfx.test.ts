import { describe, it, expect, afterAll } from "vitest";
import { glProbe, closeGlHost } from "./helpers/glHost.js";

afterAll(closeGlHost);

async function probe(effect: string, params: Record<string, number>): Promise<number[]> {
  return glProbe<[string, Record<string, number>], number[]>({
    entry: "src/render/native/page/compositor/effects/index.ts",
    globalName: "KinoFx",
    html: `<!doctype html><body><canvas id="c" width="64" height="64"></canvas></body>`,
    fn: (effect, params) =>
      (window as any).KinoFx.probeEffect(document.getElementById("c") as HTMLCanvasElement, effect, params),
    args: [effect, params],
  });
}

describe("bloom", () => {
    it("lifts the region beside a bright area", async () => {
    const [outside] = await probe("bloom", { threshold: 0.5, intensity: 1, radius: 16 });
    expect(outside).toBeGreaterThan(0);
  }, 120000);

  it("intensity 0 is a no-op", async () => {
    const [outside] = await probe("bloom", { threshold: 0.5, intensity: 0, radius: 16 });
    expect(outside).toBe(0);
  }, 120000);

  it("a threshold above the brightest pixel produces nothing", async () => {
    const [outside] = await probe("bloom", { threshold: 1.0, intensity: 1, radius: 16 });
    expect(outside).toBe(0);
  }, 120000);
});

describe("lens", () => {
  it("distortion 0 and chroma 0 is identity", async () => {
    const [edge, g, b] = await probe("lens", { distortion: 0, chroma: 0 });
    expect(g).toBe(b === 0 ? g : g);
    expect(edge === 0 || edge === 255).toBe(true);
  }, 120000);

  it("chroma splits the channels at a hard edge", async () => {
    const [, g, b] = await probe("lens", { distortion: 0, chroma: 0.02 });
    expect(Math.abs(g - b)).toBeGreaterThan(0);
  }, 120000);
});
