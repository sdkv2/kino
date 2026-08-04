import type { BrowserWindow, IpcMainInvokeEvent, NativeImage, WebContents } from "electron";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureElectronApp } from "./app.js";
import { CaptureProfiler } from "./captureProfile.js";
import { ERR_TEXT_JS } from "./errText.js";
import { READBACK_HELPERS_JS, syncReadbackEnabled } from "./readbackJs.js";
import {
  loadGpuCapture,
  reconcileCapture,
  resolveElectronCapture,
  type CaptureKind,
  type GpuCaptureNative,
} from "./gpuCapture.js";

const JPEG_Q = 95;
const SEEK_TIMEOUT_MS = 30_000;
// True SwiftShader software rendering (KINO_GPU=0, see ../angle.ts) is far slower than hardware
// ANGLE, especially at higher supersampling — a supersampled (SS=2) capture measured comfortably
// past 5s on a otherwise-idle dev machine once the swiftshader backend was actually engaged
// (previously silently ignored, see angleBackend's KINO_GPU handling).
const CAPTURE_TIMEOUT_MS = 15_000;
// Offscreen paint cadence ceiling — NOT the output timeline fps.
const CAPTURE_PAINT_FPS = 240;

type PaintFrame = {
  tex: Electron.OffscreenSharedTexture | undefined;
  image: NativeImage;
};

type PaintWaiter = {
  resolve: (frame: PaintFrame) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Platform shared-texture handle buffer from Electron OSR paint. */
function sharedTextureHandle(tex: Electron.OffscreenSharedTexture): Buffer | undefined {
  const h = tex.textureInfo?.handle;
  if (!h) return undefined;
  if (process.platform === "win32") return h.ntHandle;
  return h.ioSurface;
}

async function awaitBoot(wc: WebContents): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const state = (await wc.executeJavaScript(
      "window.__kinoError ?? (window.__kinoReady === true)",
    )) as string | boolean;
    if (typeof state === "string") throw new Error(`native render page failed to boot:\n${state}`);
    if (state === true) return;
    if (Date.now() > deadline) throw new Error("native render page did not become ready within 60s");
    await new Promise((r) => setTimeout(r, 50));
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** seekReadback result: the frame plus a per-leg split of where its wall time went. */
type ReadbackLegs = {
  fatal: string | null;
  w?: number;
  h?: number;
  msSeek?: number;
  msRead?: number;
  msPush?: number;
};

/** seekFrame result with in-page Date.now() stamps for cross-process attribution. */
type SeekResult = { fatal: string | null; tEnter: number; tExit: number };

/** Seek without gl.finish — present fence is readPixels or OSR paint. tEnter/tExit are Date.now()
 *  taken inside the renderer (same wall clock as main, 1ms grain) so the caller can split the
 *  executeJavaScript round trip into dispatch / in-page / return legs. */
async function seekFrame(wc: WebContents, frame: number): Promise<SeekResult> {
  const result = (await withTimeout(
    wc.executeJavaScript(`
      (async () => {
        const errText = ${ERR_TEXT_JS};
        const tEnter = Date.now();
        try {
          const fatal = await window.kinoSeek(${frame}).then(() => window.__kinoFatal ?? null);
          if (fatal) return { fatal: String(fatal), tEnter, tExit: Date.now() };
          return { fatal: null, tEnter, tExit: Date.now() };
        } catch (e) {
          // Reject-in-page would reach the caller as a prototype-stripped clone ("[object
          // Object]"). Stringify here, where the Error is still an Error.
          return { fatal: "in-page seek threw: " + errText(e), tEnter, tExit: Date.now() };
        }
      })()
    `) as Promise<SeekResult>,
    SEEK_TIMEOUT_MS,
    `kinoSeek(${frame})`,
  )) as SeekResult;
  return result;
}

function preloadPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const local = join(here, "preload.cjs");
  if (existsSync(local)) return local;
  const fromSrc = join(here, "../../../../src/render/native/electron/preload.cjs");
  if (existsSync(fromSrc)) return fromSrc;
  throw new Error(`electron preload.cjs missing (tried ${local}); run npm run build`);
}

/**
 * Offscreen BrowserWindow — readPixels→VT, IOSurface paint→VT, WebCodecs direct, or capturePage JPEG.
 *
 * Shared present: arm paint waiter → seek → page `frameReady` invalidates early (CopyOutput starts
 * before executeJavaScript returns) → await paint → VT. The ~16ms paint-wait is FrameSink
 * CopyOutput itself; scheduling tricks don't remove it. Encode overlaps the next seek+paint.
 */
export class OffscreenRenderWindow {
  private win: BrowserWindow | null = null;
  private encodeInflight: Promise<Buffer> | null = null;
  /** Shared paint-lag: in-flight paint→encode for the just-seeked frame. */
  private paintInflight: Promise<Buffer> | null = null;
  private readonly kind: CaptureKind;
  private readonly gpu: GpuCaptureNative | null = loadGpuCapture();
  private paintWait: PaintWaiter | null = null;
  /** Set by kino:frame-ready — skip a second invalidate() that can delay the in-flight CopyOutput. */
  private earlyInvalidated = false;
  private fps = 30;
  private readonly capProf = new CaptureProfiler();
  private encW = 0;
  private encH = 0;
  private sessionId: number | null = null;
  private ipcBound = false;
  private lastPixels: { rgba: Buffer; w: number; h: number } | null = null;
  private lastH264: Buffer | null = null;
  private static readonly byContents = new Map<number, OffscreenRenderWindow>();
  /** One process-wide handler — windows boot in parallel and must not race ipcMain.handle. */
  private static pushFrameIpc: Promise<void> | null = null;
  /** Gates the demotion notice below to once per process — every worker window on a degraded box
   *  (e.g. a driverless Linux NVENC fallback) reconciles to the same demoted kind, and up to
   *  MAX_WORKERS_ELECTRON copies of the same line is just noise. */
  private static demotionNoticePrinted = false;

  constructor(
    private readonly url: string,
    private readonly width: number,
    private readonly height: number,
    fps = 30,
  ) {
    this.fps = fps;
    const wanted = resolveElectronCapture();
    // The addon file existing is not the addon working — settle that here, where it has been
    // dlopen'd, and degrade an auto pick rather than killing the worker. See reconcileCapture.
    this.kind = reconcileCapture(wanted, this.gpu != null);
    if (this.kind !== wanted && !OffscreenRenderWindow.demotionNoticePrinted) {
      OffscreenRenderWindow.demotionNoticePrinted = true;
      console.error(
        `[kino] gpu_capture native module unusable here — capture ${wanted} → ${this.kind}`,
      );
    }
  }

  /** Worker boot line: shared | readback | direct | page. */
  captureKind(): CaptureKind {
    return this.kind;
  }

  /** @deprecated use captureKind — kept for call sites that only care about VT vs JPEG. */
  usesSharedTexture(): boolean {
    return this.kind === "shared" || this.kind === "readback" || this.kind === "direct";
  }

  private ensureEncoder(w: number, h: number): number {
    if (!this.gpu) throw new Error("gpu_capture module unavailable");
    if (this.sessionId != null && this.encW === w && this.encH === h) return this.sessionId;
    if (this.sessionId != null) {
      this.gpu.shutdownEncoder(this.sessionId);
      this.sessionId = null;
    }
    this.sessionId = this.gpu.initEncoder(w, h, this.fps);
    this.encW = w;
    this.encH = h;
    return this.sessionId;
  }

  private encodeSize(srcW: number, srcH: number): { w: number; h: number } {
    if (this.width > 0 && this.height > 0 && (this.width < srcW || this.height < srcH)) {
      return { w: this.width, h: this.height };
    }
    return { w: srcW, h: srcH };
  }

  private encodeFromPaintSync(tex: Electron.OffscreenSharedTexture | undefined, image: NativeImage): Buffer | null {
    if (!this.gpu) throw new Error("gpu_capture module unavailable");
    const t0 = performance.now();
    try {
      if (tex) {
        const info = tex.textureInfo;
        const handle = sharedTextureHandle(tex);
        if (!handle?.length) return null;
        const w = info.codedSize.width;
        const h = info.codedSize.height;
        const enc = this.encodeSize(w, h);
        const sid = this.ensureEncoder(enc.w, enc.h);
        return this.gpu.encodeSharedTexture(sid, handle, w, h, info.pixelFormat, enc.w, enc.h);
      }
      if (this.kind === "shared") return null;
      const size = image.getSize();
      const w = size.width > 0 ? size.width : this.width;
      const h = size.height > 0 ? size.height : this.height;
      const bmp = image.toBitmap();
      if (bmp.length < w * h * 4) return null;
      const enc = this.encodeSize(w, h);
      const sid = this.ensureEncoder(enc.w, enc.h);
      return this.gpu.encodeBitmap(sid, bmp, w, h, enc.w, enc.h);
    } finally {
      const key = tex ? "gpu-shared" : "gpu-bitmap";
      this.capProf.add(key, performance.now() - t0);
    }
  }

  private encodePaintedAsync(frame: number, painted: PaintFrame): Promise<Buffer> {
    if (!this.gpu) return Promise.reject(new Error("gpu_capture module unavailable"));
    const tex = painted.tex;
    if (tex && typeof this.gpu.encodeSharedTextureAsync === "function") {
      const info = tex.textureInfo;
      const handle = sharedTextureHandle(tex);
      if (!handle?.length) {
        tex.release();
        return Promise.reject(new Error(`paint produced empty shared texture on frame ${frame}`));
      }
      const w = info.codedSize.width;
      const h = info.codedSize.height;
      const enc = this.encodeSize(w, h);
      const sid = this.ensureEncoder(enc.w, enc.h);
      const t0 = performance.now();
      const p = this.gpu.encodeSharedTextureAsync(sid, handle, w, h, info.pixelFormat, enc.w, enc.h);
      tex.release();
      return p.finally(() => this.capProf.add("gpu-shared", performance.now() - t0));
    }
    return Promise.resolve().then(() => {
      try {
        const buf = this.encodeFromPaintSync(painted.tex, painted.image);
        if (!buf) throw new Error(`paint produced empty encode on frame ${frame}`);
        return buf;
      } finally {
        painted.tex?.release();
      }
    });
  }

  private static ensurePushFrameIpc(): Promise<void> {
    if (!OffscreenRenderWindow.pushFrameIpc) {
      OffscreenRenderWindow.pushFrameIpc = (async () => {
        const { ipcMain } = await import("electron");
        ipcMain.removeHandler("kino:push-frame");
        ipcMain.removeHandler("kino:push-h264");
        ipcMain.handle("kino:push-frame", (event: IpcMainInvokeEvent, rgba: Uint8Array, w: number, h: number) => {
          const self = OffscreenRenderWindow.byContents.get(event.sender.id);
          if (!self) return false;
          self.lastPixels = { rgba: Buffer.from(rgba), w, h };
          return true;
        });
        ipcMain.handle("kino:push-h264", (event: IpcMainInvokeEvent, annexB: Uint8Array) => {
          const self = OffscreenRenderWindow.byContents.get(event.sender.id);
          if (!self) return false;
          self.lastH264 = Buffer.from(annexB);
          return true;
        });
        // Early invalidate: page signals GL done while executeJavaScript is still in flight.
        ipcMain.removeAllListeners("kino:frame-ready");
        ipcMain.on("kino:frame-ready", (event, _frame: number) => {
          const self = OffscreenRenderWindow.byContents.get(event.sender.id);
          if (!self?.paintWait || !self.win || self.earlyInvalidated) return;
          self.earlyInvalidated = true;
          self.win.webContents.invalidate();
          self.capProf.bump("invalidate-early");
        });
      })();
    }
    return OffscreenRenderWindow.pushFrameIpc;
  }

  private async bindIpc(): Promise<void> {
    if (this.ipcBound) return;
    this.ipcBound = true;
    await OffscreenRenderWindow.ensurePushFrameIpc();
  }

  async boot(): Promise<void> {
    await ensureElectronApp();
    await this.bindIpc();
    const { BrowserWindow } = await import("electron");
    const useOsShared = this.kind === "shared";
    this.win = new BrowserWindow({
      width: this.width,
      height: this.height,
      show: false,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        offscreen: useOsShared
          ? { useSharedTexture: true, sharedTexturePixelFormat: "argb", deviceScaleFactor: 1 }
          : { deviceScaleFactor: 1 },
        preload: preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    // A window's INITIAL bounds are fitted to the display work area — Chromium does this in
    // views::Widget, so the constructor size above is a request the desktop is allowed to shrink.
    // Offscreen rendering has no reason to care how big the monitor is, and the shrink is silent:
    // the page lays out at the capped size and every capture comes back at it. Measured on a
    // 1024x768 windows-latest runner (work area 1024x720): a 2160x3840 still rendered 1024x720, and
    // so did 1080x1920 — the whole Windows render path was quietly capped at the desktop, not just
    // 4k. macOS and X11 honour the constructor, which is why only Windows showed it.
    //
    // A resize AFTER construction is not fitted, so ask again here (measured: exact at 2160x3840 on
    // that same 1024x720 desktop) and refuse to render at a size nobody asked for.
    this.win.setContentSize(this.width, this.height);
    const [gotW, gotH] = this.win.getContentSize();
    if (gotW !== this.width || gotH !== this.height) {
      const win = this.win;
      this.win = null;
      win.destroy();
      throw new Error(
        `offscreen window would not size to ${this.width}x${this.height} (got ${gotW}x${gotH}) — ` +
          "every frame would be captured at the wrong size",
      );
    }
    const wc = this.win.webContents;
    OffscreenRenderWindow.byContents.set(wc.id, this);
    wc.setFrameRate(CAPTURE_PAINT_FPS);

    if (this.kind === "readback") {
      wc.stopPainting();
      this.ensureEncoder(this.width, this.height);
    } else if (this.kind === "direct") {
      wc.stopPainting();
    } else if (this.kind === "shared") {
      wc.startPainting();
      wc.on("paint", (details, _dirty, image) => {
        const waiter = this.paintWait;
        if (!waiter) {
          details.texture?.release();
          return;
        }
        const tex = details.texture;
        const handle = tex ? sharedTextureHandle(tex) : undefined;
        if (!tex || !handle?.length) {
          this.capProf.bump(tex ? "paint-empty-tex" : "paint-skip");
          tex?.release();
          return;
        }
        clearTimeout(waiter.timer);
        this.paintWait = null;
        waiter.resolve({ tex, image });
      });
      this.ensureEncoder(this.width, this.height);
    }

    await wc.loadURL(`${this.url}/index.html`);
    await awaitBoot(wc);
  }

  async reloadConfig(): Promise<void> {
    await this.webContents().executeJavaScript("window.kinoLoad()");
  }

  async close(): Promise<void> {
    if (this.paintWait) {
      clearTimeout(this.paintWait.timer);
      this.paintWait.reject(new Error("offscreen window closed during capture"));
      this.paintWait = null;
    }
    if (this.win) OffscreenRenderWindow.byContents.delete(this.win.webContents.id);
    this.encodeInflight = null;
    this.paintInflight = null;
    this.lastPixels = null;
    this.lastH264 = null;
    if (this.sessionId != null && this.gpu) {
      this.gpu.shutdownEncoder(this.sessionId);
      this.sessionId = null;
    }
    this.win?.destroy();
    this.win = null;
  }

  private webContents(): WebContents {
    if (!this.win) throw new Error("offscreen window not booted");
    return this.win.webContents;
  }

  /** seekFrame + attribution: `seek` is the full executeJavaScript round trip; `seek:dispatch`
   *  (main send → page script start), `seek:page` (in-page wall) and `seek:return` (page done →
   *  main resolve) split it. The return leg is where renderer main-thread busyness — e.g. the
   *  compositor commit the early invalidate just queued — shows up. */
  private async seekTimed(wc: WebContents, frame: number): Promise<string | null> {
    const t0 = performance.now();
    const tSend = Date.now();
    const r = await seekFrame(wc, frame);
    const tBack = Date.now();
    this.capProf.add("seek", performance.now() - t0);
    this.capProf.add("seek:dispatch", r.tEnter - tSend);
    this.capProf.add("seek:page", r.tExit - r.tEnter);
    this.capProf.add("seek:return", tBack - r.tExit);
    return r.fatal;
  }

  private armPaintWait(): Promise<PaintFrame> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.paintWait) this.paintWait = null;
        reject(new Error("shared texture paint timeout"));
      }, CAPTURE_TIMEOUT_MS);
      this.paintWait = { resolve, reject, timer };
    });
  }

  private async captureJpeg(wc: WebContents): Promise<Buffer> {
    // capturePage() returns whatever the compositor has COMMITTED, which is not necessarily the
    // frame kinoSeek just drew: executeJavaScript resolves when the draw returns, before the
    // commit. Two rAFs land us after the next committed frame.
    //
    // The video loop hid this by construction — it only awaits frame N's encode once seek(N+1) is
    // already running, and that lag was doing double duty as a commit barrier. Stills have no such
    // lag, so without this they captured the PREVIOUS frame: three different frames came back as
    // identical pixels.
    await wc.executeJavaScript(
      "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))",
    );
    const image = await withTimeout(wc.capturePage(), CAPTURE_TIMEOUT_MS, "capturePage");
    return Buffer.from(image.toJPEG(JPEG_Q));
  }

  private async seekPaint(wc: WebContents, frame: number): Promise<PaintFrame> {
    // Arm before seek: page's frameReady IPC invalidates while executeJavaScript is still open,
    // so CopyOutput starts before the seek promise settles on main.
    this.earlyInvalidated = false;
    const paintPromise = this.armPaintWait();
    const tAll = performance.now();
    const fatal = await this.seekTimed(wc, frame);
    if (fatal) {
      if (this.paintWait) {
        clearTimeout(this.paintWait.timer);
        this.paintWait = null;
      }
      throw new Error(`native render page reported a fatal fault on frame ${frame}:\n${fatal}`);
    }

    // Fallback only when frameReady didn't fire (old bundle / non-electron).
    if (this.paintWait && !this.earlyInvalidated) {
      wc.invalidate();
      this.capProf.bump("invalidate-fallback");
    }
    const tWait = performance.now();
    const painted = await paintPromise;
    this.capProf.add("paint-wait", performance.now() - tWait); // post-seek stall
    this.capProf.add("seek-paint", performance.now() - tAll); // full present cost
    return painted;
  }

  /**
   * Seek + WebCodecs VideoFrame(canvas) → annex-B. Bypasses OSR paint (the ~15ms FrameSink
   * CopyOutput tax). AU goes page → preload IPC (small), not executeJavaScript clone.
   */
  private async seekDirect(wc: WebContents, frame: number): Promise<Buffer> {
    this.lastH264 = null;
    const tAll = performance.now();
    const tSend = Date.now();
    const result = (await withTimeout(
      wc.executeJavaScript(`
        (async () => {
          const errText = ${ERR_TEXT_JS};
          const tEnter = Date.now();
          try {
            const fatal = await window.kinoSeek(${frame}).then(() => window.__kinoFatal ?? null);
            if (fatal) return { fatal: String(fatal), tEnter, tExit: Date.now() };
            if (typeof window.kinoCaptureH264Bytes !== "function") {
              return { fatal: "kinoCaptureH264Bytes missing — rebuild page bundle", tEnter, tExit: Date.now() };
            }
            if (!window.kinoElectron?.pushH264) return { fatal: "kinoElectron.pushH264 missing", tEnter, tExit: Date.now() };
            const t0 = performance.now();
            const bytes = await window.kinoCaptureH264Bytes();
            await window.kinoElectron.pushH264(bytes);
            return { fatal: null, encMs: performance.now() - t0, n: bytes.byteLength, tEnter, tExit: Date.now() };
          } catch (e) {
            // Reject-in-page would reach the worker as a prototype-stripped clone ("[object
            // Object]"). Stringify here, where the Error is still an Error.
            return { fatal: "in-page direct capture threw: " + errText(e), tEnter, tExit: Date.now() };
          }
        })()
      `) as Promise<{ fatal: string | null; encMs?: number; n?: number; tEnter: number; tExit: number }>,
      SEEK_TIMEOUT_MS,
      `seekDirect(${frame})`,
    )) as { fatal: string | null; encMs?: number; n?: number; tEnter: number; tExit: number };
    const tBack = Date.now();
    // Same three legs as seekTimed — here `seek:page` includes the in-page WebCodecs encode+push.
    this.capProf.add("seek:dispatch", result.tEnter - tSend);
    this.capProf.add("seek:page", result.tExit - result.tEnter);
    this.capProf.add("seek:return", tBack - result.tExit);

    if (result.fatal) throw new Error(`native render page reported a fatal fault on frame ${frame}:\n${result.fatal}`);
    const buf = this.lastH264 as Buffer | null;
    this.lastH264 = null;
    if (!buf || buf.byteLength === 0) throw new Error(`direct WebCodecs produced empty AU on frame ${frame}`);
    this.capProf.add("seek+webcodecs", performance.now() - tAll);
    if (result.encMs != null) this.capProf.add("webcodecs", result.encMs);
    return buf;
  }

  /** Seek + WebGL readPixels → IPC — bypasses OSR paint-wait entirely. */
  private async seekReadback(wc: WebContents, frame: number): Promise<{ rgba: Buffer; w: number; h: number }> {
    this.lastPixels = null;
    const tAll = performance.now();
    const result = (await withTimeout(
      wc.executeJavaScript(`
        (async () => {
          const errText = ${ERR_TEXT_JS};
          ${READBACK_HELPERS_JS}
          const t0 = performance.now();
          try {
            const fatal = await window.kinoSeek(${frame}).then(() => window.__kinoFatal ?? null);
            if (fatal) return { fatal: String(fatal) };
            const c = document.getElementById("kino-stage");
            if (!(c instanceof HTMLCanvasElement)) return { fatal: "kino-stage canvas missing" };
            const gl = c.getContext("webgl2");
            if (!gl) return { fatal: "webgl2 context missing" };
            const w = c.width, h = c.height;
            const tSeeked = performance.now();
            const px = ${syncReadbackEnabled()} ? syncRead(gl, w, h) : pboRead(gl, w, h);
            const tRead = performance.now();
            if (!window.kinoElectron?.pushFrame) return { fatal: "kinoElectron preload missing" };
            await window.kinoElectron.pushFrame(px, w, h);
            const tPush = performance.now();
            return { fatal: null, w, h,
              msSeek: tSeeked - t0, msRead: tRead - tSeeked, msPush: tPush - tRead };
          } catch (e) {
            return { fatal: "in-page readback threw: " + errText(e) };
          }
        })()
      `) as Promise<ReadbackLegs>,
      SEEK_TIMEOUT_MS,
      `seekReadback(${frame})`,
    )) as ReadbackLegs;

    if (result.fatal) throw new Error(`native render page reported a fatal fault on frame ${frame}:\n${result.fatal}`);
    const pixels = this.lastPixels;
    if (!pixels) throw new Error(`readback produced no pixels on frame ${frame}`);
    this.capProf.add("seek-readback", performance.now() - tAll);
    // Leg split: which of seek / pixel transport / IPC actually costs. `rb:read` is the transport
    // (PBO, or the old sync readPixels under KINO_RB_SYNC=1); `rb:push` the 8.3MB hop to the worker.
    if (result.msSeek != null) {
      this.capProf.add("rb:seek", result.msSeek);
      this.capProf.add("rb:read", result.msRead ?? 0);
      this.capProf.add("rb:push", result.msPush ?? 0);
    }
    this.lastPixels = null;
    return pixels;
  }

  private encodeReadbackAsync(frame: number, pixels: { rgba: Buffer; w: number; h: number }): Promise<Buffer> {
    if (!this.gpu?.encodeRgbaAsync) {
      return Promise.reject(new Error("encodeRgbaAsync unavailable — rebuild gpu_capture"));
    }
    const enc = this.encodeSize(pixels.w, pixels.h);
    const sid = this.ensureEncoder(enc.w, enc.h);
    const t0 = performance.now();
    return this.gpu
      .encodeRgbaAsync(sid, pixels.rgba, pixels.w, pixels.h, true, enc.w, enc.h)
      .finally(() => this.capProf.add("vt-rgba", performance.now() - t0));
  }

  /**
   * Pipelined lag: returns bytes for the previous frame (parent storeLag contract).
   * Shared: paint(N) overlaps encode(N-1)+seek(N+1); VT encode of N-1 is awaited so lag stays 1.
   */
  async seekAndCapture(frame: number): Promise<Buffer | null> {
    const wc = this.webContents();

    if (process.env.KINO_ELECTRON_DEBUG) {
      process.stderr.write(`[electron worker] scap ${frame} (${this.kind})\n`);
    }

    if (this.kind === "direct") {
      const prev = this.encodeInflight ? await this.encodeInflight : null;
      this.encodeInflight = this.seekDirect(wc, frame);
      return prev;
    }

    if (this.kind === "readback") {
      const prevP = this.encodeInflight;
      const [pixels, prev] = await Promise.all([
        this.seekReadback(wc, frame),
        prevP ?? Promise.resolve(null),
      ]);
      this.encodeInflight = this.encodeReadbackAsync(frame, pixels);
      return prev;
    }

    if (this.kind === "shared") {
      // Paint-lag: seek(N) overlaps paint+encode(N-1). Await+release before next invalidate so
      // the GMB/IOSurface pool and single paintWait slot stay coherent.
      if (process.env.KINO_ELECTRON_PAINT_LAG === "1") {
        const prev = this.paintInflight;
        const fatal = await this.seekTimed(wc, frame);
        if (fatal) throw new Error(`native render page reported a fatal fault on frame ${frame}:\n${fatal}`);
        const out = prev ? await prev : null;
        this.paintInflight = (async () => {
          const tWait = performance.now();
          const paintPromise = this.armPaintWait();
          wc.invalidate();
          const painted = await paintPromise;
          this.capProf.add("paint-wait", performance.now() - tWait);
          return this.encodePaintedAsync(frame, painted);
        })();
        return out;
      }
      // Default: encode(N-1) overlaps seek+paint(N).
      const prevP = this.encodeInflight;
      const [painted, prev] = await Promise.all([
        this.seekPaint(wc, frame),
        prevP ?? Promise.resolve(null),
      ]);
      this.encodeInflight = this.encodePaintedAsync(frame, painted);
      return prev;
    }

    const prevEncode = this.encodeInflight;
    const fatal = await this.seekTimed(wc, frame);
    if (fatal) throw new Error(`native render page reported a fatal fault on frame ${frame}:\n${fatal}`);
    this.encodeInflight = this.captureJpeg(wc);
    return prevEncode ? await prevEncode : null;
  }

  async flush(): Promise<Buffer | null> {
    if (this.kind === "shared" && this.paintInflight) {
      const buf = await this.paintInflight;
      this.paintInflight = null;
      return buf;
    }
    if (!this.encodeInflight) return null;
    const buf = await this.encodeInflight;
    this.encodeInflight = null;
    return buf;
  }

  async profile(): Promise<Array<{ key: string; ms: number; n: number }>> {
    const page = (await this.webContents().executeJavaScript(
      "window.__kinoProf ? window.__kinoProf() : []",
    )) as Array<{ key: string; ms: number; n: number }>;
    return [...page, ...this.capProf.drain()];
  }
}

declare global {
  interface Window {
    kinoElectron?: {
      pushFrame: (rgba: Uint8Array, width: number, height: number) => Promise<boolean>;
      pushH264: (annexB: Uint8Array) => Promise<boolean>;
      frameReady: (frame: number) => void;
    };
  }
}
