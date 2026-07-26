// WebCodecs H.264 capture — all-intra annex-B access units, one per frame.
import { ensureCaptureStream, readStreamFrame, resetCaptureStream } from "./captureStream.js";

export const H264_CODEC = "avc1.640028";
export const H264_BITRATE = 50_000_000;

export async function probeH264Capture(width: number, height: number, fps: number): Promise<boolean> {
  if (typeof VideoEncoder === "undefined") return false;
  try {
    const { supported } = await VideoEncoder.isConfigSupported({
      codec: H264_CODEC,
      width,
      height,
      bitrate: H264_BITRATE,
      framerate: fps,
      latencyMode: "quality",
      avc: { format: "annexb" },
    });
    return !!supported;
  } catch {
    return false;
  }
}

let encWorker: Worker | null = null;

function h264Worker(): Worker {
  if (encWorker) return encWorker;
  const src = `
const CODEC = ${JSON.stringify(H264_CODEC)};
const BITRATE = ${H264_BITRATE};

let encoder = null;
let encW = 0;
let encH = 0;
let encFps = 0;

function ensureEncoder(width, height, framerate, onChunk) {
  if (encoder && encW === width && encH === height && encFps === framerate) return encoder;
  if (encoder) {
    try { encoder.close(); } catch {}
    encoder = null;
  }
  encW = width;
  encH = height;
  encFps = framerate;
  encoder = new VideoEncoder({ output: onChunk, error: (err) => { throw err; } });
  encoder.configure({
    codec: CODEC, width, height, bitrate: BITRATE, framerate,
    latencyMode: "quality", avc: { format: "annexb" },
  });
  return encoder;
}

self.onmessage = async (e) => {
  const { bitmap, videoFrame, slot, origin, width, height, framerate } = e.data;
  const chunks = [];
  let frame = videoFrame ?? null;
  try {
    const enc = ensureEncoder(width, height, framerate, (chunk) => {
      const buf = new Uint8Array(chunk.byteLength);
      chunk.copyTo(buf);
      chunks.push(buf);
    });
    if (!frame) {
      frame = new VideoFrame(bitmap, { timestamp: 0 });
      bitmap.close();
    }
    enc.encode(frame, { keyFrame: true });
    frame.close();
    await enc.flush();
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    const res = await fetch(origin + "/__capture/" + slot, { method: "POST", body: out });
    if (!res.ok) throw new Error("capture POST " + res.status);
    self.postMessage({ ok: true });
  } catch (err) {
    try { bitmap?.close(); } catch {}
    try { videoFrame?.close(); } catch {}
    self.postMessage({ ok: false, err: String(err) });
  }
};`;
  encWorker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
  return encWorker;
}

type H264Payload = { bitmap?: ImageBitmap; videoFrame?: VideoFrame };

function postEncoded(slot: number, payload: H264Payload, width: number, height: number, fps: number): Promise<void> {
  const w = h264Worker();
  const xfer: Transferable[] = payload.videoFrame
    ? [payload.videoFrame]
    : payload.bitmap
      ? [payload.bitmap]
      : [];
  return new Promise((resolve, reject) => {
    const onMsg = (ev: MessageEvent<{ ok: boolean; err?: string }>) => {
      w.removeEventListener("message", onMsg);
      if (ev.data.ok) resolve();
      else reject(new Error(ev.data.err ?? "h264 encode failed"));
    };
    w.addEventListener("message", onMsg);
    w.postMessage(
      { ...payload, slot, origin: window.location.origin, width, height, framerate: fps },
      xfer,
    );
  });
}

export function resetH264Capture(): void {
  resetCaptureStream();
}

export async function encodeBitmapH264(
  slot: number,
  bitmap: ImageBitmap,
  width: number,
  height: number,
  fps: number,
): Promise<void> {
  await postEncoded(slot, { bitmap }, width, height, fps);
}

export async function encodeVideoFrameH264(
  slot: number,
  frame: VideoFrame,
  width: number,
  height: number,
  fps: number,
): Promise<void> {
  await postEncoded(slot, { videoFrame: frame }, width, height, fps);
}

export async function captureH264FromCanvas(
  slot: number,
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  fps: number,
  source: "bitmap" | "stream" | "videoframe",
): Promise<void> {
  if (source === "stream") {
    ensureCaptureStream(canvas);
    const bitmap = await readStreamFrame();
    await encodeBitmapH264(slot, bitmap, width, height, fps);
    return;
  }
  if (source === "videoframe") {
    const frame = new VideoFrame(canvas, { timestamp: 0 });
    await encodeVideoFrameH264(slot, frame, width, height, fps);
    return;
  }
  const bitmap = await createImageBitmap(canvas);
  await encodeBitmapH264(slot, bitmap, width, height, fps);
}

/** Reused main-thread encoder — returns annex-B (no __capture POST). For Electron present-bypass. */
let bytesEnc: VideoEncoder | null = null;
let bytesEncW = 0;
let bytesEncH = 0;
let bytesEncFps = 0;
/** Indirection so configure-once encoder can target each call's chunk list. */
let bytesSink: ((chunk: EncodedVideoChunk) => void) | null = null;

function ensureBytesEncoder(width: number, height: number, fps: number): VideoEncoder {
  if (bytesEnc && bytesEncW === width && bytesEncH === height && bytesEncFps === fps) return bytesEnc;
  if (bytesEnc) {
    try {
      bytesEnc.close();
    } catch {
      // already closed
    }
    bytesEnc = null;
  }
  bytesEncW = width;
  bytesEncH = height;
  bytesEncFps = fps;
  bytesEnc = new VideoEncoder({
    output: (chunk) => bytesSink?.(chunk),
    error: (err) => {
      throw err;
    },
  });
  bytesEnc.configure({
    codec: H264_CODEC,
    width,
    height,
    bitrate: H264_BITRATE,
    framerate: fps,
    latencyMode: "quality",
    hardwareAcceleration: "prefer-hardware",
    avc: { format: "annexb" },
  });
  return bytesEnc;
}

/**
 * Encode the WebGL canvas via WebCodecs VideoFrame — stays in Chromium's GPU/media path
 * (typically VideoToolbox on macOS). No OSR paint, no full-frame RGBA IPC.
 */
export async function encodeH264BytesFromCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  fps: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  bytesSink = (chunk) => {
    const buf = new Uint8Array(chunk.byteLength);
    chunk.copyTo(buf);
    chunks.push(buf);
  };
  try {
    const enc = ensureBytesEncoder(width, height, fps);
    const frame = new VideoFrame(canvas, { timestamp: 0, alpha: "discard" });
    try {
      enc.encode(frame, { keyFrame: true });
    } finally {
      frame.close();
    }
    await enc.flush();
  } finally {
    bytesSink = null;
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  if (total === 0) throw new Error("WebCodecs H.264 produced no output");
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
