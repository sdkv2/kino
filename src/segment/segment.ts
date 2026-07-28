import { mkdirSync, unlinkSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { containedPath } from "../config/project.js";
import { pickBackend, type Backend, type SegmentBackend, type SegmentRequest, type SegmentResult } from "./backend.js";
import {
  cutoutAssetPath,
  cutoutRelPath,
  isImageSegmentInput,
  resolveSegmentInput,
  writeImageCutout,
} from "./cutout.js";
import { writeManifest } from "./manifest.js";
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
  cutout?: boolean;
  noMask?: boolean;
}

// Lazy-import coreml so mock-only builds/tests/CI never touch the python-runner path, and any
// load failure surfaces as a clean error instead of a crash. Literal specifier — tsc type-checks it.
async function loadCoremlBackend(): Promise<Backend> {
  try {
    const { coremlBackend } = await import("./coreml.js");
    return coremlBackend;
  } catch (err) {
    throw new Error(`coreml backend unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function loadCudaBackend(): Promise<Backend> {
  try {
    const { cudaBackend } = await import("./cuda.js");
    return cudaBackend;
  } catch (err) {
    throw new Error(`cuda backend unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function runSegment(opts: RunSegmentOpts): Promise<SegmentResult> {
  const cutout = opts.cutout === true;
  const writeMask = opts.noMask ? false : true;
  if (!writeMask && !cutout) throw new Error("segment needs a mask or --cutout (use --no-mask only with --cutout)");
  if (cutout && !isImageSegmentInput(opts.input)) {
    throw new Error("--cutout is image-only (jpg/png/webp); video masks stay mask-only for now");
  }

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
    cutout,
    writeMask,
  };

  const backend: Backend =
    backendName === "mock" ? mockBackend
    : backendName === "cuda" ? await loadCudaBackend()
    : await loadCoremlBackend();
  const result = await backend.run(req);

  if (cutout) {
    const inputAbs = resolveSegmentInput(opts.input, opts.projectRoot);
    const maskPath = join(result.outDir, "mask.png");
    const dest = cutoutAssetPath(opts.projectRoot, outName);
    writeImageCutout({
      input: inputAbs,
      maskPath,
      dest,
      width: result.manifest.width,
      height: result.manifest.height,
    });
    result.manifest.cutout = cutoutRelPath(outName);
    writeManifest(result.outDir, result.manifest);
  }

  if (!writeMask) {
    unlinkSync(join(result.outDir, "mask.png"));
  }

  return result;
}
