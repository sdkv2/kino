import type { MaskManifest } from "./manifest.js";

export type SegmentBackend = "coreml" | "mock";

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
  if (opts.platform === "darwin") return "coreml";
  throw new Error(`backend_unavailable: coreml segmentation needs macOS/Apple Silicon (got ${opts.platform}); use --backend mock or author masks on a Mac`);
}
