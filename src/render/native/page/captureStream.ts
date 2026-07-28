// canvas.captureStream(0) + ImageCapture.grabFrame() — alternative to createImageBitmap.

declare class ImageCapture {
  constructor(track: MediaStreamTrack);
  grabFrame(): Promise<ImageBitmap>;
}

let track: MediaStreamTrack | null = null;
let stream: MediaStream | null = null;

export function resetCaptureStream(): void {
  track = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

export function ensureCaptureStream(canvas: HTMLCanvasElement): void {
  if (track) return;
  stream = canvas.captureStream(0);
  track = stream.getVideoTracks()[0] ?? null;
  if (!track) throw new Error("captureStream: no video track");
}

/** Grab one frame via ImageCapture (TrackProcessor.read() hangs on WebGL canvas). */
export async function readStreamFrame(): Promise<ImageBitmap> {
  if (!track) throw new Error("captureStream not initialized");
  const ic = new ImageCapture(track);
  return ic.grabFrame();
}

export async function probeCaptureStream(canvas: HTMLCanvasElement): Promise<boolean> {
  if (typeof ImageCapture === "undefined") return false;
  try {
    const s = canvas.captureStream(0);
    const tr = s.getVideoTracks()[0];
    if (!tr) return false;
    const ic = new ImageCapture(tr);
    await ic.grabFrame();
    s.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}
