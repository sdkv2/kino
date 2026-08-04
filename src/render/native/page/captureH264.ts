// WebCodecs H.264 capture — all-intra annex-B access units, one per frame.
import { ensureCaptureStream, readStreamFrame, resetCaptureStream } from "./captureStream.js";

export const H264_CODEC = "avc1.640028";
/** Bits per second for a 1080-class canvas. Larger canvases scale up — see h264Bitrate. */
export const H264_BITRATE = 50_000_000;
/** The canvas H264_BITRATE was chosen for: 1080-class, i.e. 1920×1080 (== 1080×1920 rotated). */
const H264_BITRATE_BASE_PIXELS = 1920 * 1080;

/**
 * Bitrate for a canvas, scaled by pixel count.
 *
 * A flat 50 Mbps starves the `*-4k` formats: they carry 4× the pixels on the same budget, so a
 * 4K render came out at **0.156 bits/px against a 1080 render's 0.765** — and the 4K FILE was
 * smaller (45MB vs 55MB) despite four times the pixels. That is not a size win, it is the encoder
 * hitting the cap: capture is all-intra and ffmpeg remuxes it with `-c:v copy`, so the captured
 * bitstream IS the deliverable and there is no later pass to recover the detail.
 *
 * Scales UP only. Every 1080-class format (and every draft, which renders onto a smaller canvas)
 * has at most this many pixels, so the clamp keeps them at exactly 50 Mbps — this changes 4K
 * output and nothing else. 9:16-4k and 16:9-4k land on 200 Mbps, 3:4-4k on 150.
 */
export function h264Bitrate(width: number, height: number): number {
  const scale = Math.max(1, (width * height) / H264_BITRATE_BASE_PIXELS);
  return Math.round(H264_BITRATE * scale);
}

/**
 * VideoEncoder latency mode — a measured speed/quality/size trade, NOT a free knob.
 *
 * Scope: this file is the **WebCodecs** capture path (`KINO_ELECTRON_CAPTURE=direct`, and the
 * Linux default). It is NOT what macOS runs by default — there `auto` resolves to `shared`, which
 * encodes through the native IOSurface→VideoToolbox addon and never reaches this code.
 *
 * On the WebCodecs path encode is the dominant per-frame cost. Profiled on an M4 with capture
 * forced to `direct` (1 host, 4 workers, shotstack-parity, KINO_PROFILE=1): WebCodecs cost
 * **37.25 ms/frame — 71% of the whole per-frame capture** — against 14.5 ms of actual page render,
 * with IPC at 0.29 ms and ffmpeg backpressure at 3.13 ms. So the capture funnel is not the
 * constraint on that path; the encoder is.
 *
 * Switching to `"realtime"` was measured on the same spec:
 *
 * | mode       | wall    | output   | PSNR vs quality |
 * |------------|---------|----------|-----------------|
 * | "quality"  | 33.25s  | 1.19 GB  | reference       |
 * | "realtime" | 20.05s  | 564 MB   | 42.9-43.3 dB    |
 *
 * 40% faster and half the bits — but 43 dB is **below** this repo's 45.9 dB equivalence bar, and
 * below the 47.6-59.9 dB run-to-run noise floor measured on the same spec, so it is a real
 * fidelity drop rather than encoder noise. It stays on "quality" because the captured bitstream IS
 * the deliverable: ffmpeg remuxes with `-c:v copy`, so nothing re-encodes it later and there is no
 * second chance to recover detail.
 *
 * Worth revisiting if the deliverable is known to be re-encoded downstream (social platforms all
 * do), where 43 dB at 75 Mbps all-intra would survive the round trip and the 40% is free.
 *
 * For scale, the same spec through the macOS default (shared/IOSurface→VideoToolbox) runs 17.24s
 * and writes 376 MB — faster and smaller than either WebCodecs mode. Where the native addon is
 * available, using it beats tuning this encoder.
 */
export const H264_LATENCY_MODE: LatencyMode = "quality";

/** Acceleration hint, or undefined to let Chromium pick. See resolveH264Accel. */
type Accel = "prefer-hardware" | undefined;

function h264Config(width: number, height: number, fps: number, accel: Accel): VideoEncoderConfig {
  const cfg: VideoEncoderConfig = {
    codec: H264_CODEC,
    width,
    height,
    bitrate: h264Bitrate(width, height),
    framerate: fps,
    latencyMode: H264_LATENCY_MODE,
    avc: { format: "annexb" },
  };
  if (accel) cfg.hardwareAcceleration = accel;
  return cfg;
}

/** Resolved acceleration per size — `false` once we know no config works at all. */
const accelCache = new Map<string, Accel | false>();
/** Sizes where `prefer-hardware` probed supported but then failed to configure. */
const hwRefused = new Set<string>();

function accelKey(width: number, height: number, fps: number): string {
  return `${width}x${height}@${fps}`;
}

/**
 * Pick the acceleration mode this box can actually configure, or null when H.264 is unavailable.
 *
 * Chromium reads `hardwareAcceleration: "prefer-hardware"` as a *requirement*, not a preference: on
 * a machine with no H.264 encoder Chromium can reach (a Linux box whose NVENC is only addressable
 * through CUDA/NVENC, not VAAPI) `isConfigSupported` answers false for it, and `configure()` fails
 * asynchronously with `OperationError: Encoder creation error`, closing the codec — the next
 * `encode()` then reports only "Cannot call 'encode' on a closed codec".
 *
 * So probe the exact config the encoder will be configured with, hardware first, and fall back to
 * letting Chromium choose. That still lands on VideoToolbox/NVENC where they exist and on OpenH264
 * where they do not, instead of demanding hardware that is not there.
 */
export async function resolveH264Accel(width: number, height: number, fps: number): Promise<Accel | null> {
  if (typeof VideoEncoder === "undefined") return null;
  const key = accelKey(width, height, fps);
  // `Map.get` cannot tell a stored `undefined` (the resolved "no acceleration hint" answer) apart
  // from a miss — `.has` is the only correct hit test here. Getting this wrong means the box this
  // was written for (no Chromium-visible hardware encoder) never hits the cache at all.
  if (accelCache.has(key)) {
    const cached = accelCache.get(key);
    return cached === false ? null : cached;
  }
  const order: Accel[] = hwRefused.has(key) ? [undefined] : ["prefer-hardware", undefined];
  for (const accel of order) {
    try {
      const { supported } = await VideoEncoder.isConfigSupported(h264Config(width, height, fps, accel));
      if (supported) {
        accelCache.set(key, accel);
        return accel;
      }
    } catch {
      // Malformed for this Chromium — try the next candidate.
    }
  }
  accelCache.set(key, false);
  return null;
}

export async function probeH264Capture(width: number, height: number, fps: number): Promise<boolean> {
  return (await resolveH264Accel(width, height, fps)) !== null;
}

let encWorker: Worker | null = null;

function h264Worker(): Worker {
  if (encWorker) return encWorker;
  const src = `
const CODEC = ${JSON.stringify(H264_CODEC)};
const BITRATE = ${H264_BITRATE};
const BASE_PX = ${H264_BITRATE_BASE_PIXELS};
// Same scaling as h264Bitrate(): scale UP only, so 1080-class stays at BITRATE.
const bitrateFor = (w, h) => Math.round(BITRATE * Math.max(1, (w * h) / BASE_PX));
const LATENCY = ${JSON.stringify(H264_LATENCY_MODE)};

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
    codec: CODEC, width, height, bitrate: bitrateFor(width, height), framerate,
    latencyMode: LATENCY, avc: { format: "annexb" },
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
/** WebCodecs reports a configure failure asynchronously on the error callback and then closes the
 *  codec. Throwing from that callback only produces an uncaught page exception — the caller's next
 *  encode() fails with a bare "Cannot call 'encode' on a closed codec", which names the symptom and
 *  hides the cause. Park it here so the encode path can report what actually went wrong. */
let bytesEncErr: unknown = null;
let bytesEncAccel: Accel = undefined;

function encErrText(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function ensureBytesEncoder(width: number, height: number, fps: number, accel: Accel): VideoEncoder {
  const reusable =
    bytesEnc && bytesEncW === width && bytesEncH === height && bytesEncFps === fps && bytesEncAccel === accel;
  if (reusable && bytesEnc!.state === "configured") return bytesEnc!;
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
  bytesEncAccel = accel;
  bytesEncErr = null;
  bytesEnc = new VideoEncoder({
    output: (chunk) => bytesSink?.(chunk),
    error: (err) => {
      bytesEncErr = err;
    },
  });
  bytesEnc.configure(h264Config(width, height, fps, accel));
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
  const accel = await resolveH264Accel(width, height, fps);
  if (accel === null) {
    throw new Error(`no usable WebCodecs H.264 config (codec ${H264_CODEC} ${width}x${height}@${fps})`);
  }
  try {
    return await encodeOnce(canvas, width, height, fps, accel);
  } catch (err) {
    // Only retire hardware when the codec's own error callback actually fired — isConfigSupported
    // said yes and configure/encode still failed asynchronously. `bytesEncErr` is that signal.
    // Anything else thrown from encodeOnce (a VideoFrame() construction failure, the "produced no
    // output" throw) is a different bug on this call and must not silently demote hardware for
    // every future call at this size on every platform, macOS included.
    if (accel !== "prefer-hardware" || !bytesEncErr) throw err;
    const key = accelKey(width, height, fps);
    hwRefused.add(key);
    accelCache.delete(key);
    console.warn(
      `[kino] retiring WebCodecs hardware H.264 for ${width}x${height}@${fps}` +
        ` — encode failed (${encErrText(bytesEncErr)}); falling back to software for this size`,
    );
    const next = await resolveH264Accel(width, height, fps);
    if (next === null) throw err;
    return encodeOnce(canvas, width, height, fps, next);
  }
}

async function encodeOnce(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  fps: number,
  accel: Accel,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  bytesSink = (chunk) => {
    const buf = new Uint8Array(chunk.byteLength);
    chunk.copyTo(buf);
    chunks.push(buf);
  };
  try {
    const enc = ensureBytesEncoder(width, height, fps, accel);
    if (enc.state !== "configured") {
      throw new Error(
        `VideoEncoder closed before encode (codec ${H264_CODEC} ${width}x${height}@${fps}` +
          `${accel ? ` ${accel}` : ""})` +
          (bytesEncErr ? `: ${encErrText(bytesEncErr)}` : " with no error reported"),
      );
    }
    const frame = new VideoFrame(canvas, { timestamp: 0, alpha: "discard" });
    try {
      enc.encode(frame, { keyFrame: true });
    } finally {
      frame.close();
    }
    await enc.flush();
  } catch (err) {
    // A configure/encode failure surfaces on the error callback, not on this call stack; prefer it.
    if (bytesEncErr) {
      throw new Error(
        `WebCodecs H.264 encode failed (codec ${H264_CODEC} ${width}x${height}@${fps}` +
          `${accel ? ` ${accel}` : ""}): ${encErrText(bytesEncErr)} [then: ${encErrText(err)}]`,
      );
    }
    throw err;
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
