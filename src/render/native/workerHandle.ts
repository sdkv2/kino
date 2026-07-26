/** Frame worker — puppeteer page or electron offscreen window. */
export interface WorkerHandle {
  seekAndCapture: (frame: number) => Promise<Buffer | null>;
  flush: () => Promise<Buffer | null>;
  dumpProfile?: (frames: number, captureMs: number) => Promise<void>;
}
