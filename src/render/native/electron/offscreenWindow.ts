import type { BrowserWindow, NativeImage, WebContents } from "electron";
import { ensureElectronApp } from "./app.js";
import { CaptureProfiler } from "./captureProfile.js";
import { gpuCaptureMode, loadGpuCapture } from "./gpuCapture.js";

const JPEG_Q = 95;
const SEEK_TIMEOUT_MS = 30_000;
const CAPTURE_TIMEOUT_MS = 5_000;

type PaintWaiter = {
  resolve: (buf: Buffer) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

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

async function seekFrame(wc: WebContents, frame: number): Promise<string | null> {
  return withTimeout(
    wc.executeJavaScript(
      `window.kinoSeek(${frame}).then(() => {
        const c = document.getElementById("kino-stage");
        const gl = c && "getContext" in c ? c.getContext("webgl2") : null;
        gl?.finish?.();
        return window.__kinoFatal ?? null;
      })`,
    ) as Promise<string | null>,
    SEEK_TIMEOUT_MS,
    `kinoSeek(${frame})`,
  );
}

/** Offscreen BrowserWindow — IOSurface or paint-bitmap → VideoToolbox, else capturePage JPEG. */
export class OffscreenRenderWindow {
  private win: BrowserWindow | null = null;
  private lagBuf: Buffer | null = null;
  private lagReady = false;
  private readonly vtPaint: boolean;
  private readonly tryIosurface: boolean;
  private readonly gpu = loadGpuCapture();
  private paintWait: PaintWaiter | null = null;
  private fps = 30;
  private readonly capProf = new CaptureProfiler();
  private encW = 0;
  private encH = 0;

  constructor(
    private readonly url: string,
    private readonly width: number,
    private readonly height: number,
    fps = 30,
  ) {
    this.fps = fps;
    this.vtPaint = this.gpu != null;
    this.tryIosurface = this.vtPaint && gpuCaptureMode() !== "page";
  }

  /** Worker boot line: shared = VT via paint (IOSurface when available). */
  usesSharedTexture(): boolean {
    return this.vtPaint;
  }

  private ensureEncoder(w: number, h: number): void {
    if (!this.gpu) return;
    if (this.encW === w && this.encH === h) return;
    this.gpu.initEncoder(w, h, this.fps);
    this.encW = w;
    this.encH = h;
  }

  private encodeSize(srcW: number, srcH: number): { w: number; h: number } {
    if (this.width > 0 && this.height > 0 && (this.width < srcW || this.height < srcH)) {
      return { w: this.width, h: this.height };
    }
    return { w: srcW, h: srcH };
  }

  private encodeFromPaint(tex: Electron.OffscreenSharedTexture | undefined, image: NativeImage): Buffer | null {
    if (!this.gpu) throw new Error("gpu_capture module unavailable");
    const t0 = performance.now();
    try {
      if (tex) {
        const info = tex.textureInfo;
        const handle = info.handle.ioSurface;
        if (!handle?.length) return null;
        const w = info.codedSize.width;
        const h = info.codedSize.height;
        const enc = this.encodeSize(w, h);
        this.ensureEncoder(enc.w, enc.h);
        return this.gpu.encodeSharedTexture(handle, w, h, info.pixelFormat, enc.w, enc.h);
      }
      if (this.tryIosurface) return null;
      const size = image.getSize();
      const w = size.width > 0 ? size.width : this.width;
      const h = size.height > 0 ? size.height : this.height;
      const bmp = image.toBitmap();
      if (bmp.length < w * h * 4) return null;
      const enc = this.encodeSize(w, h);
      this.ensureEncoder(enc.w, enc.h);
      return this.gpu.encodeBitmap(bmp, w, h, enc.w, enc.h);
    } finally {
      const key = tex ? "vt-iosurface" : "vt-bitmap";
      this.capProf.add(key, performance.now() - t0);
    }
  }

  async boot(): Promise<void> {
    await ensureElectronApp();
    const { BrowserWindow } = await import("electron");
    this.win = new BrowserWindow({
      width: this.width,
      height: this.height,
      show: false,
      webPreferences: {
        offscreen: this.tryIosurface ? { useSharedTexture: true } : true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    const wc = this.win.webContents;
    wc.setFrameRate(this.fps);

    if (this.vtPaint) {
      wc.on("paint", (details, _dirty, image) => {
        const waiter = this.paintWait;
        if (!waiter) {
          details.texture?.release();
          return;
        }
        const tex = details.texture;
        try {
          const buf = this.encodeFromPaint(tex, image);
          if (!buf) {
            this.capProf.bump(tex ? "paint-empty-tex" : "paint-skip");
            return;
          }
          clearTimeout(waiter.timer);
          this.paintWait = null;
          waiter.resolve(buf);
        } catch (e) {
          if (process.env.KINO_ELECTRON_DEBUG) {
            process.stderr.write(`[electron worker] paint encode failed: ${(e as Error).message}\n`);
          }
          clearTimeout(waiter.timer);
          this.paintWait = null;
          waiter.reject(e instanceof Error ? e : new Error(String(e)));
        } finally {
          tex?.release();
        }
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
    this.gpu?.shutdownEncoder();
    this.win?.destroy();
    this.win = null;
  }

  private webContents(): WebContents {
    if (!this.win) throw new Error("offscreen window not booted");
    return this.win.webContents;
  }

  private armPaintWait(): Promise<Buffer> {
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

  /** Pipelined lag: returns frame for previous seek; captures the frame just seeked. */
  async seekAndCapture(frame: number): Promise<Buffer | null> {
    const wc = this.webContents();
    const prev = this.lagReady ? this.lagBuf : null;

    if (process.env.KINO_ELECTRON_DEBUG) {
      process.stderr.write(
        `[electron worker] scap ${frame} (${this.vtPaint ? "vt-paint" : "capturePage"})\n`,
      );
    }

    const paintPromise = this.vtPaint ? this.armPaintWait() : null;
    const tSeek = performance.now();
    const fatal = await seekFrame(wc, frame);
    this.capProf.add("seek", performance.now() - tSeek);
    if (fatal) throw new Error(`native render page reported a fatal fault on frame ${frame}:\n${fatal}`);

    if (this.vtPaint) {
      const tPaint = performance.now();
      wc.invalidate();
      this.lagBuf = await paintPromise!;
      this.capProf.add("paint-wait", performance.now() - tPaint);
    } else {
      this.lagBuf = await this.captureJpeg(wc);
    }
    this.lagReady = true;
    return prev;
  }

  async flush(): Promise<Buffer | null> {
    if (!this.lagReady) return null;
    const buf = this.lagBuf;
    this.lagBuf = null;
    this.lagReady = false;
    return buf;
  }

  async profile(): Promise<Array<{ key: string; ms: number; n: number }>> {
    const page = (await this.webContents().executeJavaScript(
      "window.__kinoProf ? window.__kinoProf() : []",
    )) as Array<{ key: string; ms: number; n: number }>;
    return [...page, ...this.capProf.drain()];
  }
}
