import type { BrowserWindow, IpcMainInvokeEvent, NativeImage, WebContents } from "electron";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureElectronApp } from "./app.js";
import { CaptureProfiler } from "./captureProfile.js";
import {
  loadGpuCapture,
  resolveElectronCapture,
  type GpuCaptureNative,
} from "./gpuCapture.js";

const JPEG_Q = 95;
const SEEK_TIMEOUT_MS = 30_000;
const CAPTURE_TIMEOUT_MS = 5_000;
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

type CaptureKind = "shared" | "readback" | "direct" | "page";

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

/** Seek without gl.finish — present fence is readPixels or OSR paint. */
async function seekFrame(wc: WebContents, frame: number): Promise<string | null> {
  return withTimeout(
    wc.executeJavaScript(
      `window.kinoSeek(${frame}).then(() => window.__kinoFatal ?? null)`,
    ) as Promise<string | null>,
    SEEK_TIMEOUT_MS,
    `kinoSeek(${frame})`,
  );
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

  constructor(
    private readonly url: string,
    private readonly width: number,
    private readonly height: number,
    fps = 30,
  ) {
    this.fps = fps;
    this.kind = resolveElectronCapture();
    if ((this.kind === "shared" || this.kind === "readback") && !this.gpu) {
      throw new Error(`electron capture=${this.kind} requires gpu_capture native module`);
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
    const image = await withTimeout(wc.capturePage(), CAPTURE_TIMEOUT_MS, "capturePage");
    return Buffer.from(image.toJPEG(JPEG_Q));
  }

  private async seekPaint(wc: WebContents, frame: number): Promise<PaintFrame> {
    // Arm before seek: page's frameReady IPC invalidates while executeJavaScript is still open,
    // so CopyOutput starts before the seek promise settles on main.
    this.earlyInvalidated = false;
    const paintPromise = this.armPaintWait();
    const tAll = performance.now();
    const tSeek = performance.now();
    const fatal = await seekFrame(wc, frame);
    this.capProf.add("seek", performance.now() - tSeek);
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
    const result = (await withTimeout(
      wc.executeJavaScript(`
        (async () => {
          const fatal = await window.kinoSeek(${frame}).then(() => window.__kinoFatal ?? null);
          if (fatal) return { fatal: String(fatal) };
          if (typeof window.kinoCaptureH264Bytes !== "function") {
            return { fatal: "kinoCaptureH264Bytes missing — rebuild page bundle" };
          }
          if (!window.kinoElectron?.pushH264) return { fatal: "kinoElectron.pushH264 missing" };
          const t0 = performance.now();
          const bytes = await window.kinoCaptureH264Bytes();
          await window.kinoElectron.pushH264(bytes);
          return { fatal: null, encMs: performance.now() - t0, n: bytes.byteLength };
        })()
      `) as Promise<{ fatal: string | null; encMs?: number; n?: number }>,
      SEEK_TIMEOUT_MS,
      `seekDirect(${frame})`,
    )) as { fatal: string | null; encMs?: number; n?: number };

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
          const fatal = await window.kinoSeek(${frame}).then(() => window.__kinoFatal ?? null);
          if (fatal) return { fatal: String(fatal) };
          const c = document.getElementById("kino-stage");
          if (!(c instanceof HTMLCanvasElement)) return { fatal: "kino-stage canvas missing" };
          const gl = c.getContext("webgl2");
          if (!gl) return { fatal: "webgl2 context missing" };
          const w = c.width, h = c.height;
          const px = new Uint8Array(w * h * 4);
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
          if (!window.kinoElectron?.pushFrame) return { fatal: "kinoElectron preload missing" };
          await window.kinoElectron.pushFrame(px, w, h);
          return { fatal: null, w, h };
        })()
      `) as Promise<{ fatal: string | null; w?: number; h?: number }>,
      SEEK_TIMEOUT_MS,
      `seekReadback(${frame})`,
    )) as { fatal: string | null; w?: number; h?: number };

    if (result.fatal) throw new Error(`native render page reported a fatal fault on frame ${frame}:\n${result.fatal}`);
    const pixels = this.lastPixels;
    if (!pixels) throw new Error(`readback produced no pixels on frame ${frame}`);
    this.capProf.add("seek-readback", performance.now() - tAll);
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
        const tSeek = performance.now();
        const fatal = await seekFrame(wc, frame);
        this.capProf.add("seek", performance.now() - tSeek);
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
    const tSeek = performance.now();
    const fatal = await seekFrame(wc, frame);
    this.capProf.add("seek", performance.now() - tSeek);
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
