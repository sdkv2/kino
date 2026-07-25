// M2: how long does one foreignObject raster take, at composition size?
import { build } from "esbuild";
import puppeteer from "puppeteer";
import { pct, summarize } from "./percentiles.mjs";

const W = 1080, H = 1920, N = 60;

const THEME = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
};

// A full-screen motion graphic whose CSS reads frame vars — the `dynamic` worst case.
const MOTION = `<style>
.card{position:absolute;left:8%;right:8%;top:30%;bottom:30%;border-radius:48px;
  background:linear-gradient(135deg,#0c8d64,#80e2b4);
  transform:translateY(calc(var(--progress,0) * -40px)) scale(calc(1 + var(--progress,0) * 0.06));}
.h{position:absolute;inset:0;display:grid;place-items:center;font:700 96px Arial;color:#fff}
</style><div class="card"></div><div class="h">Ship faster</div>`;

// One caption line — the `keyed` case.
const CAPTION = `<style>.c{font:800 74px Arial;color:#fff;-webkit-text-stroke:9px #0b1020;
  paint-order:stroke fill;text-align:center}</style><div class="c">deterministic by design</div>`;

const bundle = await build({
  entryPoints: ["src/render/native/page/spike-entry.ts"],
  bundle: true, write: false, format: "iife", platform: "browser",
  target: "chrome120", jsx: "automatic", logLevel: "silent",
});
const js = bundle.outputFiles[0].text;

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.setContent("<!doctype html><body style='margin:0'></body>");
await page.addScriptTag({ content: js });

for (const [label, html, size] of [
  ["motion-fullscreen", MOTION, { w: W, h: H }],
  ["caption-line", CAPTION, null],
]) {
  for (const scale of [1, 2]) {
    const samples = await page.evaluate(
      async (html, theme, size, scale, n) => {
        const tpl = await window.__spike.buildTemplate(html, theme, { size: size ?? undefined, scale });
        const out = [];
        for (let i = 0; i < n; i++) {
          // A distinct scrub value every iteration and a null cache — the dynamic
          // cadence, where no raster is ever reused.
          const css = window.__spike.scrubCss(i / 30);
          const t0 = performance.now();
          await window.__spike.rasterAt(tpl, String(i), css, null);
          out.push(performance.now() - t0);
        }
        return out;
      },
      html, THEME, size, scale, N,
    );
    console.log(summarize(`${label} SS=${scale}`, samples));
  }
}

await browser.close();
