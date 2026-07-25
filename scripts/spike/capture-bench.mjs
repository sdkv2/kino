// M5: with the page reduced to a single canvas, which way out is cheaper —
// Chromium's JPEG screenshot, or readPixels plus a base64 hop over CDP?
import puppeteer from "puppeteer";
import { pct, summarize } from "./percentiles.mjs";

const W = 1080, H = 1920, N = 60;

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.setContent(
  `<!doctype html><body style="margin:0"><canvas id="c" width="${W}" height="${H}"
   style="width:100%;height:100%"></canvas></body>`,
);

// A canvas that actually changes per frame, so nothing can be cached away.
await page.evaluate((w, h) => {
  const gl = document.getElementById("c").getContext("webgl2", {
    preserveDrawingBuffer: true, premultipliedAlpha: true, antialias: false,
  });
  window.__draw = (i) => {
    gl.viewport(0, 0, w, h);
    gl.clearColor((i % 60) / 60, 0.3, 0.6, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.finish();
  };
}, W, H);

const cdp = [], read = [];
let cdpBytes = 0, readBytes = 0;

for (let i = 0; i < N; i++) {
  await page.evaluate((n) => window.__draw(n), i);
  const a = performance.now();
  const buf = await page.screenshot({ type: "jpeg", quality: 95 });
  cdp.push(performance.now() - a);
  cdpBytes = buf.length;

  await page.evaluate((n) => window.__draw(n), i);
  const b = performance.now();
  const dataUrl = await page.evaluate(() => document.getElementById("c").toDataURL("image/jpeg", 0.95));
  read.push(performance.now() - b);
  readBytes = Buffer.from(dataUrl.split(",")[1], "base64").length;
}

console.log(summarize("cdp-screenshot", cdp), `bytes=${cdpBytes}`);
console.log(summarize("canvas-toDataURL", read), `bytes=${readBytes}`);
await browser.close();
