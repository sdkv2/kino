import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";

const GL_ARGS = ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"];

async function mixAt(kind: string, p: number): Promise<number> {
  const bundle = await build({
    entryPoints: ["src/render/native/page/compositor/transitions/index.ts"],
    bundle: true, write: false, format: "iife", globalName: "KinoTx",
    platform: "browser", target: "chrome120", logLevel: "silent",
  });
  const browser = await puppeteer.launch({ headless: true, args: GL_ARGS });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><body><canvas id="c" width="64" height="64"></canvas></body>`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    return await page.evaluate((kind, p) => (window as any).KinoTx.probeMix(
      document.getElementById("c") as HTMLCanvasElement, kind, p,
    ), kind, p);
  } finally {
    await browser.close();
  }
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
