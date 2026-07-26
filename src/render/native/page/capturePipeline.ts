// Frame capture: WebCodecs H.264 (video) or JPEG q=0.95 (stills / fallback). Raw bytes POST to the
// render server — no base64 over CDP.
import {
  captureH264FromCanvas,
  encodeBitmapH264,
  probeH264Capture,
  resetH264Capture,
} from "./captureH264.js";
import { ensureCaptureStream, probeCaptureStream, readStreamFrame, resetCaptureStream } from "./captureStream.js";
import type { CaptureCodec } from "../captureCodec.js";
import type { CaptureSource } from "../captureSource.js";

const JPEG_QUALITY = 0.95;

let codec: CaptureCodec = "jpeg";
let source: CaptureSource = "bitmap";
let dims = { width: 0, height: 0, fps: 30 };
let chain: Promise<void> = Promise.resolve();
let encWorker: Worker | null = null;

export async function initCapture(opts: {
  codec: CaptureCodec;
  captureSource?: CaptureSource;
  width: number;
  height: number;
  fps: number;
}): Promise<{ codec: CaptureCodec; source: CaptureSource }> {
  dims = { width: opts.width, height: opts.height, fps: opts.fps };
  const want = opts.captureSource ?? "bitmap";
  if (opts.codec === "h264" && (await probeH264Capture(opts.width, opts.height, opts.fps))) {
    codec = "h264";
    const canvas = document.getElementById("kino-stage");
    if (want === "stream" && canvas instanceof HTMLCanvasElement && (await probeCaptureStream(canvas))) {
      source = "stream";
    } else if (want === "videoframe" && typeof VideoFrame !== "undefined") {
      source = "videoframe";
    } else {
      source = "bitmap";
    }
  } else {
    codec = "jpeg";
    source = "bitmap";
  }
  resetCapturePipeline();
  return { codec, source };
}

export function activeCaptureCodec(): CaptureCodec {
  return codec;
}

export function activeCaptureSource(): CaptureSource {
  return source;
}

function stageCanvas(): HTMLCanvasElement | null {
  const el = document.getElementById("kino-stage");
  return el instanceof HTMLCanvasElement ? el : null;
}

function jpegWorker(): Worker {
  if (encWorker) return encWorker;
  const src = `
self.onmessage = async (e) => {
  const { bitmap, slot, origin, quality } = e.data;
  try {
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("no 2d");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await c.convertToBlob({ type: "image/jpeg", quality });
    const res = await fetch(origin + "/__capture/" + slot, { method: "POST", body: blob });
    if (!res.ok) throw new Error("capture POST " + res.status);
    self.postMessage({ ok: true });
  } catch (err) {
    bitmap.close();
    self.postMessage({ ok: false, err: String(err) });
  }
};`;
  encWorker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
  return encWorker;
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", JPEG_QUALITY);
  });
}

async function postBlob(slot: number, blob: Blob): Promise<void> {
  const res = await fetch(`/__capture/${slot}`, { method: "POST", body: blob });
  if (!res.ok) throw new Error(`capture POST failed: ${res.status}`);
}

function encodeJpegInWorker(bitmap: ImageBitmap, slot: number): Promise<void> {
  const w = jpegWorker();
  return new Promise((resolve, reject) => {
    const onMsg = (ev: MessageEvent<{ ok: boolean; err?: string }>) => {
      w.removeEventListener("message", onMsg);
      if (ev.data.ok) resolve();
      else reject(new Error(ev.data.err ?? "jpeg encode failed"));
    };
    w.addEventListener("message", onMsg);
    w.postMessage({ bitmap, slot, origin: window.location.origin, quality: JPEG_QUALITY }, [bitmap]);
  });
}

async function kickH264(slot: number, canvas: HTMLCanvasElement): Promise<void> {
  if (source === "bitmap") {
    const bitmap = await createImageBitmap(canvas);
    await encodeBitmapH264(slot, bitmap, dims.width, dims.height, dims.fps);
    return;
  }
  await captureH264FromCanvas(slot, canvas, dims.width, dims.height, dims.fps, source);
}

/** Reset at page boot / kinoLoad. */
export function resetCapturePipeline(): void {
  chain = Promise.resolve();
  resetH264Capture();
  resetCaptureStream();
}

/** One-shot capture (no pipeline lag). */
export async function captureSync(slot: number): Promise<void> {
  const canvas = stageCanvas();
  if (!canvas) return;
  if (codec === "h264") {
    await kickH264(slot, canvas);
    return;
  }
  await postBlob(slot, await canvasBlob(canvas));
}

/** After seek(N): wait for the previous POST, snapshot N, kick async encode+POST. */
export async function capturePipelined(slot: number): Promise<void> {
  const canvas = stageCanvas();
  if (!canvas) return;
  await chain;
  if (codec === "h264") {
    if (source === "bitmap") {
      const bitmap = await createImageBitmap(canvas);
      chain = encodeBitmapH264(slot, bitmap, dims.width, dims.height, dims.fps);
    } else if (source === "stream") {
      chain = (async () => {
        ensureCaptureStream(canvas);
        const bitmap = await readStreamFrame();
        await encodeBitmapH264(slot, bitmap, dims.width, dims.height, dims.fps);
      })();
    } else {
      chain = kickH264(slot, canvas);
    }
    return;
  }
  const bitmap = await createImageBitmap(canvas);
  chain = encodeJpegInWorker(bitmap, slot);
}

/** Drain the last in-flight encode+POST when a worker finishes its frame queue. */
export async function flushCapturePipeline(): Promise<void> {
  await chain;
}
