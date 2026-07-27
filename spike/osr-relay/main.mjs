/**
 * Spike: live-DOM motion OSR → BGRA paint → IPC → WebGL compositor.
 * Run: node_modules/.bin/electron spike/osr-relay/main.mjs
 *
 * Phase A: motion window alone (2 OSR windows starve software-OSR paint on Electron 40/macOS).
 * Phase B: compositor window + IPC upload of captured frames.
 */
import { app, BrowserWindow, ipcMain } from "electron";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "out");
const W = 1920;
const H = 1080;
const ITERS = 30;
const PAINT_TIMEOUT_MS = 5000;

app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("force-color-profile", "srgb");
app.commandLine.appendSwitch("enable-gpu");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
if (process.platform === "darwin") app.commandLine.appendSwitch("use-angle", "metal");
app.commandLine.appendSwitch("use-gl", "angle");

function pct(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}
function stats(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = s.length % 2 ? s[(s.length - 1) >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return {
    n: s.length,
    median: +mid.toFixed(3),
    p95: +pct(s, 95).toFixed(3),
    min: +s[0].toFixed(3),
    max: +s[s.length - 1].toFixed(3),
    mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3),
  };
}

function cursorPos(i) {
  const t = i / Math.max(1, ITERS - 1);
  const x = Math.round(200 + t * 1520);
  const y = Math.round(200 + Math.sin(t * Math.PI * 2) * 300 + 400);
  return { x, y };
}

function makeOsWindow(opts = {}) {
  return new BrowserWindow({
    width: W,
    height: H,
    show: false,
    frame: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      offscreen: { deviceScaleFactor: 1 },
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: opts.preload,
    },
  });
}

function waitReady(wc, flag, ms = 60000) {
  const deadline = Date.now() + ms;
  return (async () => {
    for (;;) {
      if (await wc.executeJavaScript(`window.${flag} === true`)) return;
      if (Date.now() > deadline) throw new Error(`${flag} timeout`);
      await new Promise((r) => setTimeout(r, 25));
    }
  })();
}

async function waitNonEmptyPaint(wc, timeoutMs = PAINT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const image = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        wc.removeListener("paint", onPaint);
        reject(new Error("paint timeout"));
      }, Math.min(1000, Math.max(50, deadline - Date.now())));
      function onPaint(_d, _dr, img) {
        clearTimeout(timer);
        wc.removeListener("paint", onPaint);
        resolve(img);
      }
      wc.on("paint", onPaint);
      wc.invalidate();
    }).catch(() => null);
    if (image && !image.isEmpty() && image.getSize().width > 0) return image;
    await new Promise((r) => setTimeout(r, 8));
  }
  throw new Error("no non-empty paint");
}

function readMarker(buf) {
  const x = 1856;
  const y = 36;
  const o = (y * W + x) * 4;
  return { b: buf[o], g: buf[o + 1], r: buf[o + 2], a: buf[o + 3] };
}

function markerMatches(mark, frameId) {
  return mark.r === 255 && mark.g === (frameId & 255) && mark.b === 128;
}

async function mutateAndCapture(motion, x, y, frameId) {
  const wc = motion.webContents;
  const tMut = performance.now();
  await wc.executeJavaScript(`(async () => {
    window.__spikeSetCursor(${x}, ${y}, ${frameId});
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return true;
  })()`);
  const mutateMs = performance.now() - tMut;

  if (!wc.isPainting()) wc.startPainting();

  const tPaint0 = performance.now();
  let buf = null;
  let size = { width: W, height: H };
  let copyMs = 0;
  let attempts = 0;
  const deadline = Date.now() + PAINT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    attempts++;
    const image = await waitNonEmptyPaint(wc, deadline - Date.now());
    const tCopy0 = performance.now();
    const bmp = image.toBitmap();
    const copied = Buffer.from(bmp);
    copyMs = performance.now() - tCopy0;
    size = image.getSize();
    const mark = readMarker(copied);
    if (markerMatches(mark, frameId)) {
      buf = copied;
      break;
    }
    if (attempts <= 8) {
      console.log(`  stale paint frameId=${frameId} attempt=${attempts} gotG=${mark.g} wantG=${frameId & 255}`);
    }
    await new Promise((r) => setTimeout(r, 8));
  }
  const paintWaitMs = performance.now() - tPaint0;
  if (!buf) throw new Error(`paint never matched marker frameId=${frameId} after ${attempts} attempts`);
  return { buf, size, paintWaitMs, copyMs, mutateMs, attempts };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await app.whenReady();

  const assetsDir = join(__dirname, "assets");
  const motionUrl =
    pathToFileURL(join(__dirname, "motion.html")).href +
    "?assets=" +
    encodeURIComponent(pathToFileURL(assetsDir).href);

  // --- Phase A: motion alone ---
  const motion = makeOsWindow();
  motion.webContents.setFrameRate(240);
  await motion.loadURL(motionUrl);
  await waitReady(motion.webContents, "__spikeReady");
  motion.webContents.startPainting();
  await waitNonEmptyPaint(motion.webContents);
  await mutateAndCapture(motion, 960, 540, 1); // warm

  async function captureLoop(label, idBase) {
    const samples = [];
    const hashes = [];
    const frames = [];
    for (let i = 0; i < ITERS; i++) {
      const { x, y } = cursorPos(i);
      const frameId = idBase + i + 1;
      const cap = await mutateAndCapture(motion, x, y, frameId);
      const hash = createHash("sha256").update(cap.buf).digest("hex");
      hashes.push(hash);
      frames.push(cap.buf);
      samples.push({
        i,
        x,
        y,
        frameId,
        attempts: cap.attempts,
        paintWaitMs: +cap.paintWaitMs.toFixed(3),
        copyMs: +cap.copyMs.toFixed(3),
        mutateMs: +cap.mutateMs.toFixed(3),
        bytes: cap.buf.length,
        hash,
      });
    }
    const table = {
      paintWaitMs: stats(samples.map((s) => s.paintWaitMs)),
      copyMs: stats(samples.map((s) => s.copyMs)),
      mutateMs: stats(samples.map((s) => s.mutateMs)),
      attempts: stats(samples.map((s) => s.attempts)),
    };
    console.log(`\n=== ${label} capture (n=${ITERS}) ===`);
    for (const k of ["paintWaitMs", "copyMs", "mutateMs"]) {
      const t = table[k];
      console.log(
        `  ${k.padEnd(14)} median=${t.median.toFixed(2)}  p95=${t.p95.toFixed(2)}  mean=${t.mean.toFixed(2)}  min=${t.min.toFixed(2)}  max=${t.max.toFixed(2)}`,
      );
    }
    console.log(`  attempts       median=${table.attempts.median} max=${table.attempts.max}`);
    return { samples, hashes, table, frames };
  }

  const run1 = await captureLoop("run1", 100);
  const run2 = await captureLoop("run2", 100);

  const detMismatches = [];
  for (let i = 0; i < ITERS; i++) {
    if (run1.hashes[i] !== run2.hashes[i]) {
      detMismatches.push({ i, h1: run1.hashes[i], h2: run2.hashes[i], pos: cursorPos(i) });
    }
  }
  console.log(`\n=== determinism ===`);
  console.log(`  identical frames: ${ITERS - detMismatches.length}/${ITERS}`);
  if (detMismatches.length) console.log(`  mismatches:`, JSON.stringify(detMismatches.slice(0, 5)));

  // Mid frame for fidelity (from run2)
  const midIdx = Math.floor(ITERS / 2);
  const mid = cursorPos(midIdx);
  const midBuf = run2.frames[midIdx];
  const bmp = midBuf;
  const px = (x, y) => {
    const o = (y * W + x) * 4;
    return { b: bmp[o], g: bmp[o + 1], r: bmp[o + 2], a: bmp[o + 3] };
  };
  const formatProbe = {
    cursorCenter: px(mid.x, mid.y),
    nearCursor: px(Math.min(W - 1, mid.x + 2), mid.y),
    wallpaperCorner: px(10, 10),
    marker: readMarker(bmp),
    note: "toBitmap()=B,G,R,A. Opaque #ff2d55 → b≈85,g≈45,r≈255,a≈255. Premultiplied edges: channel<=alpha.",
  };
  console.log("\n=== BGRA probe ===");
  console.log(JSON.stringify(formatProbe, null, 2));

  // Stop motion painting before opening compositor (avoid 2-OSR starve).
  try {
    motion.webContents.stopPainting();
  } catch {
    /* */
  }

  // --- Phase B: compositor + IPC ---
  const comp = makeOsWindow({ preload: join(__dirname, "preload.cjs") });
  // Compositor does not need OSR paint for tex upload — canvas.toDataURL works in-process.
  // Keep offscreen so window stays headless; stopPainting to avoid GPU contend.
  await comp.loadURL(pathToFileURL(join(__dirname, "compositor.html")).href);
  await waitReady(comp.webContents, "__spikeReady");
  try {
    comp.webContents.stopPainting();
  } catch {
    /* */
  }

  const pending = new Map();
  let seq = 0;
  ipcMain.on("spike:upload-done", (_e, result) => {
    const p = pending.get(result.seq);
    if (p) {
      pending.delete(result.seq);
      p.resolve(result);
    }
  });

  await comp.webContents.executeJavaScript(`
    (() => {
      if (!window.spike) throw new Error("preload spike API missing");
      window.spike.onFrame((payload) => {
        const t0 = performance.now();
        const bgra = payload.bgra instanceof ArrayBuffer
          ? new Uint8Array(payload.bgra)
          : new Uint8Array(payload.bgra);
        const recvMs = performance.now() - t0;
        const up = window.__spikeUpload(bgra, payload.w, payload.h, payload.premul);
        window.spike.uploadDone({
          seq: payload.seq,
          recvMs,
          uploadMs: up.uploadMs,
          drawMs: up.drawMs,
          bytes: bgra.byteLength,
        });
      });
      true;
    })()
  `);

  function uploadViaIpc(buf, w, h, premul = 1) {
    const mySeq = ++seq;
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(mySeq);
        reject(new Error("upload timeout"));
      }, 10000);
      const tSend = performance.now();
      pending.set(mySeq, {
        resolve: (got) => {
          clearTimeout(timer);
          const roundTripMs = performance.now() - tSend;
          resolve({
            ipcMs: Math.max(0, roundTripMs - got.uploadMs - got.drawMs),
            uploadMs: got.uploadMs,
            drawMs: got.drawMs,
            bytes: got.bytes,
            roundTripMs,
            recvMs: got.recvMs,
          });
        },
      });
      comp.webContents.send("spike:frame", { seq: mySeq, w, h, premul, bgra: ab });
    });
  }

  async function uploadLoop(label, frames) {
    const samples = [];
    for (let i = 0; i < frames.length; i++) {
      const up = await uploadViaIpc(frames[i], W, H, 1);
      samples.push({
        i,
        ipcMs: +up.ipcMs.toFixed(3),
        uploadMs: +up.uploadMs.toFixed(3),
        drawMs: +up.drawMs.toFixed(3),
        roundTripMs: +up.roundTripMs.toFixed(3),
      });
    }
    const table = {
      ipcMs: stats(samples.map((s) => s.ipcMs)),
      uploadMs: stats(samples.map((s) => s.uploadMs)),
      drawMs: stats(samples.map((s) => s.drawMs)),
    };
    console.log(`\n=== ${label} upload (n=${frames.length}) ===`);
    for (const k of ["ipcMs", "uploadMs", "drawMs"]) {
      const t = table[k];
      console.log(
        `  ${k.padEnd(14)} median=${t.median.toFixed(2)}  p95=${t.p95.toFixed(2)}  mean=${t.mean.toFixed(2)}  min=${t.min.toFixed(2)}  max=${t.max.toFixed(2)}`,
      );
    }
    return { samples, table };
  }

  const up1 = await uploadLoop("upload-run1", run1.frames);
  const up2 = await uploadLoop("upload-run2", run2.frames);

  await uploadViaIpc(midBuf, W, H, 1);
  const relayPngDataUrl = await comp.webContents.executeJavaScript(`window.__spikeReadbackPNG()`);
  writeFileSync(join(OUT, "relay.png"), Buffer.from(relayPngDataUrl.split(",")[1], "base64"));

  await uploadViaIpc(midBuf, W, H, 0);
  const relayNopremul = await comp.webContents.executeJavaScript(`window.__spikeReadbackPNG()`);
  writeFileSync(join(OUT, "relay-nopremul.png"), Buffer.from(relayNopremul.split(",")[1], "base64"));

  // FO fidelity
  const assetFiles = {
    wall: "macos-wallpaper-sonoma.jpg",
    sprite: "yt-watch-sprite.jpg",
    ...Object.fromEntries([..."abcdefghi"].map((L) => [L, `yt-thumb-${L}.jpg`])),
  };
  const dataUrls = {};
  for (const [k, file] of Object.entries(assetFiles)) {
    dataUrls[k] = `data:image/jpeg;base64,${readFileSync(join(assetsDir, file)).toString("base64")}`;
  }
  const thumbs = [..."abcdefghi"]
    .map(
      (L) =>
        `<img src="${dataUrls[L]}" alt="" style="width:280px;height:160px;object-fit:cover;display:block;border-radius:8px" />`,
    )
    .join("");
  const midFrameId = 100 + midIdx + 1;
  const foInner =
    `<div style="position:relative;width:1920px;height:1080px;overflow:hidden;margin:0;background:#000;` +
    `caret-color:transparent;user-select:none">` +
    `<img src="${dataUrls.wall}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block" />` +
    `<div style="position:absolute;left:80px;top:120px;display:grid;grid-template-columns:repeat(3,280px);` +
    `grid-template-rows:repeat(3,160px);gap:24px">${thumbs}</div>` +
    `<img src="${dataUrls.sprite}" alt="" style="position:absolute;right:80px;bottom:80px;width:320px;height:180px;` +
    `object-fit:cover;display:block;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.45)" />` +
    `<div style="position:absolute;left:1840px;top:20px;width:32px;height:32px;background:rgb(255,${midFrameId & 255},128)"></div>` +
    `<div style="position:absolute;left:${mid.x}px;top:${mid.y}px;width:24px;height:24px;background:#ff2d55;` +
    `border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.5);transform:translate(-50%,-50%)"></div>` +
    `</div>`;

  const foResult = await comp.webContents.executeJavaScript(
    `window.__spikeForeignObjectRaster(${JSON.stringify(foInner)}, ${W}, ${H})`,
  );
  writeFileSync(join(OUT, "foreignObject.png"), Buffer.from(foResult.png.split(",")[1], "base64"));
  console.log(`\n=== FO raster === decode=${foResult.decodeMs.toFixed(1)}ms draw=${foResult.drawMs.toFixed(1)}ms`);

  let fidelity = {};
  try {
    let stderr = "";
    try {
      execFileSync(
        "magick",
        ["compare", "-metric", "RMSE", join(OUT, "relay.png"), join(OUT, "foreignObject.png"), join(OUT, "diff.png")],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (e) {
      stderr = (e.stderr || e.message || "").toString();
    }
    const maxAbs = await comp.webContents.executeJavaScript(`
      (async () => {
        const fo = ${JSON.stringify(foResult.png)};
        const rel = ${JSON.stringify(relayPngDataUrl)};
        function load(u){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=u;});}
        const a = await load(rel), b = await load(fo);
        const ca = document.createElement("canvas"); ca.width=${W}; ca.height=${H};
        const cb = document.createElement("canvas"); cb.width=${W}; cb.height=${H};
        const xa = ca.getContext("2d"), xb = cb.getContext("2d");
        xa.drawImage(a,0,0); xb.drawImage(b,0,0);
        const da = xa.getImageData(0,0,${W},${H}).data;
        const db = xb.getImageData(0,0,${W},${H}).data;
        let max=0, sum=0, n=${W}*${H}*4;
        for (let i=0;i<n;i++){ const d=Math.abs(da[i]-db[i]); if(d>max)max=d; sum+=d*d; }
        return { maxAbs: max, rmse: Math.sqrt(sum/n) };
      })()
    `);
    fidelity = { magickRmse: stderr.trim(), maxAbsChannel: maxAbs.maxAbs, rmse: maxAbs.rmse };
    console.log("\n=== fidelity relay vs FO ===");
    console.log(JSON.stringify(fidelity, null, 2));
  } catch (e) {
    fidelity = { error: String(e) };
    console.error("fidelity failed", e);
  }

  // Prefer later timing run for the report table.
  const report = {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    size: { W, H },
    iters: ITERS,
    caveats: [
      "Two concurrent software-OSR paint streams starve motion updates on Electron 40/macOS — capture with motion alone, then open compositor.",
      "Software OSR paint is ~1 frame behind DOM; flush one invalidate before matching marker.",
    ],
    run1: { capture: run1.table, upload: up1.table },
    run2: { capture: run2.table, upload: up2.table },
    determinism: { mismatches: detMismatches.length, samples: detMismatches.slice(0, 10) },
    formatProbe,
    fidelity,
    foRasterMs: { decodeMs: foResult.decodeMs, drawMs: foResult.drawMs },
    midCursor: mid,
    expectedBytes: W * H * 4,
  };
  writeFileSync(join(OUT, "metrics.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(OUT, "run1-samples.json"), JSON.stringify({ capture: run1.samples, upload: up1.samples }, null, 2));
  writeFileSync(join(OUT, "run2-samples.json"), JSON.stringify({ capture: run2.samples, upload: up2.samples }, null, 2));
  console.log(`\nWrote ${OUT}/metrics.json`);

  motion.destroy();
  comp.destroy();
  app.quit();
}

main().catch((err) => {
  console.error(err);
  app.exit(1);
});
