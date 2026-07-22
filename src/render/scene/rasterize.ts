// Pre-rasterize pass for 3D scene beats: agent-authored HTML → per-frame PNG sequence (animated,
// VO-synced screen texture) and SVG → one alpha PNG (layer plane). Runs headless Chrome via the
// existing pool BEFORE Blender; output is content-addressed so the scene hash busts on content
// change and unchanged raster work is skipped. Same var/scrub injection as MotionGraphic — same
// bytes, same pixels.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "puppeteer";
import { acquireBrowser, releaseBrowser } from "../native/browser.js";
import { buildMotionVars, wordsShownAt } from "../motionVars.js";
import { paramsAt, pulseAt } from "../bgparams.js";
import { KINO_SCRUB_STYLE, KINO_DEFS } from "../motionCss.js";
import { svgAspect } from "../scene.js";
import type { Theme, WordTiming, BgKeyframe, BgTrigger, BgParamValue } from "../props.js";

// devicePhone screen inset is 0.94·(1 × 2.16) → aspect 1:2.16; 720px wide keeps raster cheap and
// legible mid-orbit. Bump RASTER_V when wrapper markup or var math changes (busts all digests).
export const SCREEN_W = 720;
export const SCREEN_H = 1556;
export const LAYER_MAX_DIM = 2048;
const RASTER_V = 1;

export interface ScreenRasterOpts {
  html: string; // sanitized Tier-1 markup (sanitizeMotionHtml already applied by the caller)
  words: WordTiming[];
  theme: Theme;
  params: Record<string, BgParamValue>;
  keyframes: BgKeyframe[];
  triggers: BgTrigger[];
  fps: number;
  durationFrames: number;
}

export function screenDigest(o: ScreenRasterOpts): string {
  return createHash("sha1")
    .update(
      JSON.stringify([
        RASTER_V,
        SCREEN_W,
        SCREEN_H,
        KINO_SCRUB_STYLE,
        KINO_DEFS,
        o.html,
        o.words,
        o.theme,
        o.params,
        o.keyframes,
        o.triggers,
        o.fps,
        o.durationFrames,
      ]),
    )
    .digest("hex");
}

export function layerDigest(svg: string): string {
  return createHash("sha1")
    .update(JSON.stringify([RASTER_V, LAYER_MAX_DIM, KINO_SCRUB_STYLE, KINO_DEFS, svg]))
    .digest("hex");
}

// The shadow-DOM host page: same injection order as MotionGraphic's ShadowHtml (scrub style +
// defs + agent html), vars set on the host so they inherit across the shadow boundary.
function screenPage(html: string): string {
  return `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;width:${SCREEN_W}px;height:${SCREEN_H}px;overflow:hidden;background:#000}</style>
<div id="host" style="position:absolute;inset:0"></div>
<script>
const host = document.getElementById("host");
const shadow = host.attachShadow({ mode: "open" });
shadow.innerHTML = ${JSON.stringify(KINO_SCRUB_STYLE + KINO_DEFS + html)};
window.__kinoSetVars = (vars) => { for (const [k, v] of Object.entries(vars)) host.style.setProperty(k, v); };
</script>`;
}

async function withPage<T>(w: number, h: number, fn: (page: Page) => Promise<T>): Promise<T> {
  const browser = await acquireBrowser();
  try {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
      return await fn(page);
    } finally {
      await page.close();
    }
  } finally {
    await releaseBrowser();
  }
}

/** Rasterize an html screen to outDir/f00001.png… — one frame per beat frame, VO-synced vars. */
export async function rasterizeScreen(o: ScreenRasterOpts & { outDir: string }): Promise<void> {
  mkdirSync(o.outDir, { recursive: true });
  await withPage(SCREEN_W, SCREEN_H, async (page) => {
    // ponytail: brief used networkidle0; puppeteer ≥25 dropped it from setContent (never worked — crbug/498000321)
    await page.setContent(screenPage(o.html), { waitUntil: "domcontentloaded" });
    for (let f = 0; f < o.durationFrames; f++) {
      const tt = f / o.fps;
      const progress = o.durationFrames > 0 ? Math.min(1, Math.max(0, f / o.durationFrames)) : 0;
      const vars = buildMotionVars(o.theme, {
        frame: f,
        t: tt,
        progress,
        pulse: pulseAt(o.triggers, tt),
        params: paramsAt(o.params, o.keyframes, tt, { implicitBase: true }),
        captionBottom: 0, // a screen lives inside the device — no caption band to clear
        wordsShown: wordsShownAt(o.words, tt),
        wordCount: o.words.length,
      });
      await page.evaluate((v) => (window as unknown as { __kinoSetVars(v: Record<string, string>): void }).__kinoSetVars(v), vars);
      const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: SCREEN_W, height: SCREEN_H } });
      writeFileSync(join(o.outDir, `f${String(f + 1).padStart(5, "0")}.png`), png);
    }
  });
}

/** Rasterize one SVG element to a single alpha PNG at LAYER_MAX_DIM on its long edge. */
export async function rasterizeLayer(o: { svg: string; outPath: string }): Promise<void> {
  const aspect = svgAspect(o.svg);
  const w = aspect <= 1 ? LAYER_MAX_DIM : Math.max(1, Math.round(LAYER_MAX_DIM / aspect));
  const h = aspect <= 1 ? Math.max(1, Math.round(LAYER_MAX_DIM * aspect)) : LAYER_MAX_DIM;
  await withPage(w, h, async (page) => {
    const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${w}px;height:${h}px}</style>${o.svg}`;
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const png = await page.screenshot({ type: "png", omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
    writeFileSync(o.outPath, png);
  });
}
