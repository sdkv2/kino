// M3: does a foreignObject raster of a subtree match what Chromium paints for the
// same subtree? Text edges are the thing that matters.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer";

const W = 1080, H = 1920, OUT = "/tmp/kino-m3";
mkdirSync(OUT, { recursive: true });

const THEME = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
};

const CASES = {
  "caption-stroke": `<style>.c{position:absolute;inset:0;display:grid;place-items:center;
    font:800 74px Arial;color:#fff;-webkit-text-stroke:9px #0b1020;paint-order:stroke fill}
    </style><div class="c">deterministic by design</div>`,
  "small-label": `<style>.l{position:absolute;inset:0;display:grid;place-items:center;
    font:500 28px Arial;color:#80e2b4;letter-spacing:0.08em}
    </style><div class="l">RENDERED FROM A SPEC</div>`,
  "gradient-card": `<style>.g{position:absolute;left:10%;right:10%;top:35%;bottom:35%;
    border-radius:48px;background:linear-gradient(135deg,#0c8d64,#d99a20)}
    </style><div class="g"></div>`,
};

const bundle = await build({
  entryPoints: ["src/render/native/page/spike-entry.ts"],
  bundle: true, write: false, format: "iife", platform: "browser",
  target: "chrome120", jsx: "automatic", logLevel: "silent",
});

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });

for (const [name, html] of Object.entries(CASES)) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });

  // A: what Chromium paints today.
  await page.setContent(
    `<!doctype html><body style="margin:0;width:${W}px;height:${H}px;background:#0b1020">
     <div style="position:relative;width:${W}px;height:${H}px">${html}</div></body>`,
  );
  await page.screenshot({ path: `${OUT}/${name}-dom.png` });

  // B: the same subtree through the raster path, drawn onto the same backdrop.
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const dataUrl = await page.evaluate(
    async (html, theme, w, h) => {
      const tpl = await window.__spike.buildTemplate(html, theme, { size: { w, h }, scale: 2 });
      const raster = await window.__spike.rasterAt(tpl, "fid", "", null);
      const out = document.createElement("canvas");
      out.width = w; out.height = h;
      const ctx = out.getContext("2d");
      ctx.fillStyle = "#0b1020";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(raster, 0, 0, w, h);
      return out.toDataURL("image/png");
    },
    html, THEME, W, H,
  );
  writeFileSync(`${OUT}/${name}-raster.png`, Buffer.from(dataUrl.split(",")[1], "base64"));

  const meanDiff = execFileSync("magick", [
    `${OUT}/${name}-dom.png`, `${OUT}/${name}-raster.png`,
    "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:",
  ]).toString().trim();
  console.log(`${name}: meanDiff=${meanDiff}`);
  await page.close();
}

await browser.close();
console.log(`PNG pairs in ${OUT} — open them and look at the text edges.`);
