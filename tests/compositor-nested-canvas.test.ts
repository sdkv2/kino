import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";

describe("nested canvas lifting", () => {
  it("proves the trap is real, then that lifting fixes it", async () => {
    const bundle = await build({
      entryPoints: ["src/render/native/page/compositor/providers/nested.ts"],
      bundle: true, write: false, format: "iife", globalName: "KinoNested",
      platform: "browser", target: "chrome120", logLevel: "silent",
    });
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.setContent("<!doctype html><body></body>");
      await page.addScriptTag({ content: bundle.outputFiles[0].text });

      const result = await page.evaluate(async () => {
        const host = document.createElement("div");
        host.style.cssText = "position:absolute;left:0;top:0;width:100px;height:100px";
        const c = document.createElement("canvas");
        c.width = 100; c.height = 100;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = "#ff0000";
        ctx.fillRect(0, 0, 100, 100);
        host.appendChild(c);
        document.body.appendChild(host);

        // The trap: serializing the subtree drops the canvas pixels entirely.
        const xhtml = new XMLSerializer().serializeToString(host);
        const serializedHasPixels = xhtml.includes("data:image") || xhtml.includes("ff0000");

        // The fix: the canvas is found and lifted out as its own source.
        const found = (window as any).KinoNested.findNestedCanvases(host);
        return { serializedHasPixels, liftedCount: found.length, liftedWidth: found[0]?.rect.width };
      });

      expect(result.serializedHasPixels).toBe(false); // the trap, demonstrated
      expect(result.liftedCount).toBe(1);
      expect(result.liftedWidth).toBe(100);
    } finally {
      await browser.close();
    }
  }, 120000);
});
