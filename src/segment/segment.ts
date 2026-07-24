import { mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { containedPath } from "../config/project.js";
import { pickBackend, type Backend, type SegmentBackend, type SegmentRequest, type SegmentResult } from "./backend.js";
import { mockBackend } from "./mock.js";

export interface RunSegmentOpts {
  input: string;
  prompt: string;
  objects?: number;
  track?: boolean;
  out?: string;
  backend?: SegmentBackend;
  projectRoot: string;
  platform?: NodeJS.Platform;
}

// coreml.ts doesn't exist until Task 7 — lazy-import it so mock-only builds/tests/CI never touch
// the python-runner path, and a missing module surfaces as a clean error instead of a crash.
async function loadCoremlBackend(): Promise<Backend> {
  try {
    // Non-literal specifier: keeps tsc from resolving this module at compile time (it doesn't
    // exist until Task 7), while Node still resolves it fine at runtime.
    const coremlModulePath = "./coreml.js";
    const mod = (await import(coremlModulePath)) as { coremlBackend: Backend };
    return mod.coremlBackend;
  } catch (err) {
    throw new Error(`coreml backend unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function runSegment(opts: RunSegmentOpts): Promise<SegmentResult> {
  const backendName = pickBackend({ requested: opts.backend, platform: opts.platform ?? process.platform });
  const outName = opts.out ?? basename(opts.input, extname(opts.input));
  const outDir = containedPath(join(opts.projectRoot, "assets", "masks"), outName);
  mkdirSync(outDir, { recursive: true });

  const req: SegmentRequest = {
    input: opts.input,
    prompt: opts.prompt,
    objects: opts.objects ?? 1,
    track: opts.track ?? true,
    outDir,
  };

  const backend: Backend = backendName === "mock" ? mockBackend : await loadCoremlBackend();
  return backend.run(req);
}
