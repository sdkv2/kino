// TEMPORARY diagnostic — delete once the Windows 4k render size is understood.
//
// tests/format-4k-parity.test.ts renders a 9:16-4k still (2160x3840) and gets a 1024x720 PNG back
// on windows-latest only. The stills path captures with webContents.capturePage(), whose image is
// the size of the offscreen VIEW, so the question is what size that view ends up at when the
// window is asked for one much larger than the desktop. Prints, for a matrix of BrowserWindow
// configs: what the window reports, what the page reports, and what capturePage() actually hands
// back. Run under the electron binary, not node.
const { app, BrowserWindow, screen } = require("electron");

// Mirrors gpuSwitches() in src/render/native/electron/app.ts for win32 — force-device-scale-factor
// in particular is load-bearing for anything size-related, so the probe must boot with it too.
for (const [sw, val] of [
  ["enable-gpu"], ["ignore-gpu-blocklist"], ["enable-gpu-rasterization"], ["enable-zero-copy"],
  ["disable-gpu-vsync"], ["enable-surface-synchronization"], ["disable-background-timer-throttling"],
  ["disable-renderer-backgrounding"], ["disable-backgrounding-occluded-windows"],
  ["force-device-scale-factor", "1"], ["force-color-profile", "srgb"],
  ["use-angle", process.platform === "darwin" ? "metal" : process.platform === "win32" ? "d3d11" : "vulkan"],
  ["use-gl", "angle"],
  ...(process.platform === "win32" ? [["disable-gpu-sandbox"], ["no-sandbox"]] : []),
]) {
  if (val === undefined) app.commandLine.appendSwitch(sw);
  else app.commandLine.appendSwitch(sw, val);
}

// about:blank, not a data: URL — a second data: load in the same process failed with ERR_FAILED
// while probing this on macOS, and the page content is irrelevant: capturePage() sizes itself from
// the view, not the document.
const PAGE = "about:blank";

/** One window config, booted and measured. Everything not named here matches OffscreenRenderWindow. */
async function probe(label, w, h, opts = {}) {
  const row = { label, asked: `${w}x${h}` };
  let win = null;
  try {
    win = new BrowserWindow({
      width: opts.createSmall ? 100 : w,
      height: opts.createSmall ? 100 : h,
      show: false,
      paintWhenInitiallyHidden: true,
      ...(opts.win ?? {}),
      webPreferences: {
        offscreen: { deviceScaleFactor: 1 },
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    if (opts.setMaximumSize) win.setMaximumSize(w, h);
    if (opts.setContentSize) win.setContentSize(w, h);
    if (opts.setBounds) win.setBounds({ x: 0, y: 0, width: w, height: h });
    await win.loadURL(PAGE);
    const inner = await win.webContents.executeJavaScript(
      "({iw: window.innerWidth, ih: window.innerHeight, dpr: window.devicePixelRatio})",
    );
    const b = win.getBounds();
    const cb = win.getContentBounds();
    const img = await win.webContents.capturePage();
    const s = img.getSize();
    row.bounds = `${b.width}x${b.height}`;
    row.content = `${cb.width}x${cb.height}`;
    row.page = `${inner.iw}x${inner.ih}@${inner.dpr}`;
    // getSize() is in DIP; the stills path writes toJPEG() bytes, which are physical pixels. They
    // differ on a retina Mac (scaleFactor 2) and agree on the CI runners (scaleFactor 1).
    row.capture = `${s.width}x${s.height}`;
    row.jpegBytes = img.toJPEG(95).length;
    row.ok = s.width === w && s.height === h ? "OK" : "WRONG";
  } catch (e) {
    row.error = String(e && e.message ? e.message : e);
  } finally {
    // Deliberately NOT destroyed: destroying an offscreen window mid-probe made every later window
    // fail its load with ERR_FAILED and then killed the process with SIGTRAP (macOS). The windows
    // are blank pages and the process exits at the end anyway. stopPainting keeps the idle OSR
    // pipelines from competing for the runner's cores.
    try {
      win?.webContents.stopPainting();
    } catch {
      // window already gone
    }
  }
  console.log(JSON.stringify(row));
}

app.whenReady().then(async () => {
  const d = screen.getPrimaryDisplay();
  console.log(
    JSON.stringify({
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      platform: process.platform,
      displays: screen.getAllDisplays().length,
      bounds: d.bounds,
      workArea: d.workArea,
      scaleFactor: d.scaleFactor,
    }),
  );

  for (const [w, h] of [
    [2160, 3840], // 9:16-4k — the failing render
    [1080, 1920], // its 1080-class twin, which the same test also asserts
    [1920, 1080], // 16:9, wider than the desktop but shorter
    [720, 1280], // 9:16 draft — smaller than the desktop in width only
  ]) {
    await probe("plain", w, h);
  }

  // Candidate escapes, all at the failing size.
  await probe("largerThanScreen", 2160, 3840, { win: { enableLargerThanScreen: true } });
  await probe("useContentSize", 2160, 3840, { win: { useContentSize: true } });
  await probe("frameless", 2160, 3840, { win: { frame: false } });
  await probe("frameless+larger", 2160, 3840, { win: { frame: false, enableLargerThanScreen: true } });
  await probe("setContentSize-after", 2160, 3840, { createSmall: true, setContentSize: true });
  await probe("setBounds-after", 2160, 3840, { createSmall: true, setBounds: true });
  await probe("larger+setContentSize", 2160, 3840, {
    createSmall: true,
    setContentSize: true,
    win: { enableLargerThanScreen: true },
  });
  // Windows fills MINMAXINFO.ptMaxTrackSize with a screen-sized default and Chromium only
  // overwrites it when the widget has an explicit maximum — so declaring one bigger than the
  // desktop is the targeted escape if the desktop is what is doing the clamping.
  await probe("maxSize-ctor", 2160, 3840, { win: { maxWidth: 2160, maxHeight: 3840 } });
  await probe("setMaximumSize-then-content", 2160, 3840, {
    createSmall: true,
    setMaximumSize: true,
    setContentSize: true,
  });

  // Exactly what OffscreenRenderWindow.boot() now does — construct at the asked size (which
  // Windows fits to the work area) and then resize. Run at every format's canvas, on every OS.
  for (const [w, h] of [
    [2160, 3840], [3840, 2160], [2160, 2880],
    [1080, 1920], [1920, 1080], [1080, 1440],
    [720, 1280],
  ]) {
    await probe("ctor-then-setContentSize", w, h, { setContentSize: true });
  }

  setTimeout(() => app.quit(), 100);
});
