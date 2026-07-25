import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";

const GL_ARGS = ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"];

describe("TargetPool", () => {
  it("reuses a released target instead of allocating a new one", async () => {
    const bundle = await build({
      entryPoints: ["src/render/native/page/compositor/targets.ts"],
      bundle: true, write: false, format: "iife", globalName: "KinoTargets",
      platform: "browser", target: "chrome120", logLevel: "silent",
    });
    const browser = await puppeteer.launch({ headless: true, args: GL_ARGS });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><body><canvas id="c" width="64" height="64"></canvas></body>`);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const result = await page.evaluate(() => {
        const gl = (document.getElementById("c") as HTMLCanvasElement).getContext("webgl2")!;
        const pool = new (window as any).KinoTargets.TargetPool();
        const a = pool.acquire(gl, 64, 64);
        pool.release(a);
        const b = pool.acquire(gl, 64, 64);
        const c = pool.acquire(gl, 64, 64);
        return { reused: a.tex === b.tex, distinct: b.tex !== c.tex, size: [b.w, b.h] };
      });
      expect(result.reused).toBe(true);   // released target came back
      expect(result.distinct).toBe(true); // a second live target is its own allocation
      expect(result.size).toEqual([64, 64]);
    } finally {
      await browser.close();
    }
  }, 120000);

  it("does not hand back a target of the wrong size", async () => {
    const bundle = await build({
      entryPoints: ["src/render/native/page/compositor/targets.ts"],
      bundle: true, write: false, format: "iife", globalName: "KinoTargets",
      platform: "browser", target: "chrome120", logLevel: "silent",
    });
    const browser = await puppeteer.launch({ headless: true, args: GL_ARGS });
    try {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><body><canvas id="c" width="64" height="64"></canvas></body>`);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const reused = await page.evaluate(() => {
        const gl = (document.getElementById("c") as HTMLCanvasElement).getContext("webgl2")!;
        const pool = new (window as any).KinoTargets.TargetPool();
        const a = pool.acquire(gl, 64, 64);
        pool.release(a);
        return pool.acquire(gl, 32, 32).tex === a.tex;
      });
      expect(reused).toBe(false);
    } finally {
      await browser.close();
    }
  }, 120000);
});
