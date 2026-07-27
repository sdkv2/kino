import { app, BrowserWindow } from "electron";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("force-color-profile", "srgb");
app.commandLine.appendSwitch("enable-gpu");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
if (process.platform === "darwin") app.commandLine.appendSwitch("use-angle", "metal");

const mode = process.argv[2] || "software"; // software | shared

async function main() {
  await app.whenReady();
  const offscreen =
    mode === "shared"
      ? { useSharedTexture: true, sharedTexturePixelFormat: "argb", deviceScaleFactor: 1 }
      : { deviceScaleFactor: 1 };

  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: { offscreen, backgroundThrottling: false },
  });
  const wc = win.webContents;
  wc.setFrameRate(240);
  const assets = pathToFileURL(join(ROOT, "assets")).href;
  await wc.loadURL(pathToFileURL(join(ROOT, "motion.html")).href + "?assets=" + encodeURIComponent(assets));
  const t0 = Date.now();
  while (!(await wc.executeJavaScript("window.__spikeReady===true"))) {
    if (Date.now() - t0 > 20000) throw new Error("ready timeout");
    await new Promise((r) => setTimeout(r, 30));
  }
  wc.startPainting();

  function armPaint() {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("paint timeout")), 3000);
      wc.once("paint", (details, _dr, image) => {
        clearTimeout(t);
        details.texture?.release?.();
        resolve(image);
      });
    });
  }

  async function grab(label, frameId, x, y) {
    await wc.executeJavaScript(`(async()=>{
      window.__spikeSetCursor(${x},${y},${frameId});
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      return true;
    })()`);
    const paintP = armPaint();
    wc.invalidate();
    const image = await paintP;
    const bmp = image.toBitmap();
    const size = image.getSize();
    const o = (36 * size.width + 1856) * 4;
    const mark = { b: bmp[o], g: bmp[o + 1], r: bmp[o + 2], a: bmp[o + 3] };
    const co = (y * size.width + x) * 4;
    const cur = { b: bmp[co], g: bmp[co + 1], r: bmp[co + 2], a: bmp[co + 3] };
    writeFileSync(join(ROOT, `out/diag-${mode}-${label}.png`), image.toPNG());
    console.log(label, "paint size", size, "marker", mark, "cursor", cur, "empty", image.isEmpty());

    const cap = await wc.capturePage();
    const cb = cap.toBitmap();
    const cs = cap.getSize();
    const mo = (36 * cs.width + 1856) * 4;
    const cmo = (y * cs.width + x) * 4;
    console.log(label, "capturePage marker", { b: cb[mo], g: cb[mo + 1], r: cb[mo + 2] }, "cursor", {
      b: cb[cmo],
      g: cb[cmo + 1],
      r: cb[cmo + 2],
    });
    writeFileSync(join(ROOT, `out/diag-${mode}-${label}-cap.png`), cap.toPNG());
  }

  console.log("mode", mode);
  await grab("a", 10, 400, 300);
  await grab("b", 200, 800, 600);
  await grab("c", 50, 200, 200);
  win.destroy();
  app.quit();
}

main().catch((e) => {
  console.error(e);
  app.exit(1);
});
