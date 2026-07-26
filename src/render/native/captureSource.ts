/** How pixels reach VideoEncoder: bitmap (createImageBitmap), stream (captureStream), videoframe (VideoFrame(canvas)). */
export type CaptureSource = "bitmap" | "stream" | "videoframe";
