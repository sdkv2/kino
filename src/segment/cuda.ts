// CUDA (native-PyTorch) segmentation backend: shells scripts/sam_runner_cuda.py, which runs the
// FULL facebookresearch/sam3 SAM3.1 model in PyTorch. Unlike the CoreML backend (per-frame image
// seg, no tracker), the video path runs the REAL multiplex video predictor — genuine temporal
// object tracking (manifest tracked:true). Cross-platform author-time engine for Linux/Windows +
// NVIDIA; the mask artifacts it writes are plain files any platform renders.
//
// Like coreml.ts (and whisper.ts), the heavy Python runtime is a documented prerequisite, not
// something we auto-build: a CUDA torch + the sam3 package are not reliably scriptable here, so we
// resolve/verify a venv and error with guidance. Set KINO_SAM_PYTHON to a venv where
// `pip install -e sam3` + a CUDA-enabled torch are installed. Checkpoint auto-downloads on first run.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { log } from "../log.js";
import { readManifest } from "./manifest.js";
import type { Backend, SegmentRequest, SegmentResult } from "./backend.js";

const here = dirname(fileURLToPath(import.meta.url));
// dist/segment/cuda.js (and src/segment/cuda.ts) sit two levels under the package root.
const RUNNER = resolve(here, "../../scripts/sam_runner_cuda.py");

const VIDEO_EXT = /\.(mp4|mov|webm|mkv)$/i;

const samDir = (): string => join(homedir(), ".kino", "sam");

/** Runner Python: KINO_SAM_PYTHON override, else ~/.kino/sam/venv/bin/python. Null if neither exists. */
function resolvePython(): string | null {
  const cands = [process.env.KINO_SAM_PYTHON, join(samDir(), "venv", "bin", "python")];
  for (const p of cands) if (p && existsSync(p)) return p;
  return null;
}

const SETUP_HINT =
  "no usable SAM Python — point KINO_SAM_PYTHON at a venv with a CUDA-enabled torch and the sam3 " +
  "package (`pip install -e sam3` from github.com/facebookresearch/sam3), or create ~/.kino/sam/venv. " +
  "See docs/segmentation.md.";

async function pyCanImport(py: string, mod: string): Promise<boolean> {
  try {
    await execa(py, ["-c", `import ${mod}`]);
    return true;
  } catch {
    return false;
  }
}

/** Verify a Python able to import the sam3 package (the runner downloads the checkpoint itself).
 *  We do NOT build a GPU env here — CUDA torch + sam3 install is the user's documented step. */
export async function ensureCudaEnv(): Promise<string> {
  const py = resolvePython();
  if (!py) throw new Error(`sam_env_unavailable: ${SETUP_HINT}`);
  if (!(await pyCanImport(py, "sam3"))) {
    throw new Error(`sam_env_unavailable: ${py} cannot import sam3 — ${SETUP_HINT}`);
  }
  if (!(await pyCanImport(py, "torch"))) {
    throw new Error(`sam_env_unavailable: ${py} cannot import torch — ${SETUP_HINT}`);
  }
  return py;
}

export const cudaBackend: Backend = {
  name: "cuda",
  async run(req: SegmentRequest): Promise<SegmentResult> {
    const py = await ensureCudaEnv();
    const device = process.env.KINO_SAM_DEVICE ?? "cuda";
    const args = [
      RUNNER, "--input", req.input, "--prompt", req.prompt,
      "--out", req.outDir, "--objects", String(req.objects), "--device", device,
    ];
    if (VIDEO_EXT.test(req.input)) {
      // Real SAM3.1 multiplex video tracking — masks are temporally coherent (tracked:true).
      args.push("--video");
      log.step(`cuda video: real SAM3.1 temporal tracking (device=${device})`);
    }
    await execa(py, args, { stdio: ["ignore", "inherit", "inherit"] });
    const manifest = readManifest(req.outDir);
    return { manifest, outDir: req.outDir };
  },
};
