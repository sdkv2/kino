/** Frame worker — one Electron offscreen window. */
export interface WorkerHandle {
  seekAndCapture: (frame: number) => Promise<Buffer | null>;
  flush: () => Promise<Buffer | null>;
  dumpProfile?: (frames: number, captureMs: number) => Promise<void>;
}
