import { describe, it, expect, afterAll } from "vitest";
import { glProbe, closeGlHost } from "./helpers/glHost.js";

afterAll(closeGlHost);

async function mixAt(kind: string, p: number): Promise<number> {
  return glProbe<[string, number], number>({
    entry: "src/render/native/page/compositor/transitions/index.ts",
    globalName: "KinoTx",
    html: `<!doctype html><body><canvas id="c" width="64" height="64"></canvas></body>`,
    fn: (kind, p) =>
      (window as any).KinoTx.probeMix(document.getElementById("c") as HTMLCanvasElement, kind, p),
    args: [kind, p],
  });
}

describe("transition shaders", () => {
  for (const kind of ["fade", "dissolve", "fly-left", "fly-up", "pop", "cut"]) {
    it(`${kind} is fully the outgoing beat at p=0`, async () => {
      expect(await mixAt(kind, 0)).toBeLessThanOrEqual(4);
    }, 120000);

    it(`${kind} is fully the incoming beat at p=1`, async () => {
      expect(await mixAt(kind, 1)).toBeGreaterThanOrEqual(251);
    }, 120000);
  }

  it("fade is monotonic through the middle", async () => {
    const [a, b] = [await mixAt("fade", 0.25), await mixAt("fade", 0.75)];
    expect(b).toBeGreaterThan(a);
  }, 240000);

  it("cut switches at the midpoint rather than blending", async () => {
    expect(await mixAt("cut", 0.49)).toBeLessThanOrEqual(4);
    expect(await mixAt("cut", 0.51)).toBeGreaterThanOrEqual(251);
  }, 240000);
});
