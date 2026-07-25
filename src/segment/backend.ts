import type { MaskManifest } from "./manifest.js";

export type SegmentBackend = "coreml" | "cuda" | "mock";

export interface SegmentRequest {
  input: string;
  prompt: string;
  objects: number;
  track: boolean;
  outDir: string;
}

export interface SegmentResult {
  manifest: MaskManifest;
  outDir: string;
}

export interface Backend {
  name: SegmentBackend;
  run(req: SegmentRequest): Promise<SegmentResult>;
}

export function pickBackend(opts: { requested?: SegmentBackend; platform: NodeJS.Platform }): SegmentBackend {
  if (opts.requested) return opts.requested;
  // darwin → CoreML (Apple Silicon); everything else → CUDA (native PyTorch SAM3.1,
  // Linux/Windows + NVIDIA). Both need a Python env; kino doctor shows readiness.
  return opts.platform === "darwin" ? "coreml" : "cuda";
}
