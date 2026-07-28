// Mac/Apple-Silicon CoreML segmentation backend: shells scripts/sam_runner.py (SAM3.1 CoreML text
// -prompt image seg) and reads back the manifest it writes. Author-time only — the mask artifacts
// it produces are plain files any platform renders. Mirrors the whisper.ts pattern: lazy download-
// once into ~/.kino/sam/, and (like whisper.cpp) the heavy Python runtime is a documented
// prerequisite rather than something we auto-build — coremltools 9.0 + torch 2.7.0 + the patched
// sam3 tokenizer is not reliably scriptable, so we resolve/verify a venv and error with guidance.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { log } from "../log.js";
import { readManifest } from "./manifest.js";
import type { Backend, SegmentRequest, SegmentResult } from "./backend.js";

const here = dirname(fileURLToPath(import.meta.url));
// dist/segment/coreml.js (and src/segment/coreml.ts) sit two levels under the package root.
const RUNNER = resolve(here, "../../scripts/sam/sam_runner.py");

const VIDEO_EXT = /\.(mp4|mov|webm|mkv)$/i;

const HF_REPO = "AllanVester/SAM3.1-CoreML-FP16";
// mlpackage dir stems in the HF repo; each gated by existsSync so re-downloads are skipped.
const PACKAGES = ["SAM3.1_ImageEncoder_FP16", "SAM3.1_TextEncoder_FP16", "SAM3.1_Detector_FP16"];

// Stateful CoreML tracker for REAL video tracking (public repo, tracker/ subdir). Lands under
// modelsDir/models/ (locally flattened); sam_track.py resolves it from either spot.
const MODEL_REPO = "sdkv2/sam3.1-coreml";
const TRACKER_PKG = "dense_sam3_trackstep.mlpackage";
const trackerPath = (dir: string): string => join(dir, "models", TRACKER_PKG);

// Per-frame vision backbone (trunk + propagation FPN + conv_s0/s1) — backbone/ subdir upstream,
// same models/ nest locally.
const BACKBONE_PKG = "sam3_vision_backbone.mlpackage";
const backbonePath = (dir: string): string => join(dir, "models", BACKBONE_PKG);
const backbonePresent = (dir: string): boolean =>
  existsSync(backbonePath(dir)) || existsSync(join(dir, BACKBONE_PKG));

const samDir = (): string => join(homedir(), ".kino", "sam");
const modelsDir = (): string => process.env.KINO_SAM_MODEL ?? join(samDir(), "models");

/** Runner Python: KINO_SAM_PYTHON override, else ~/.kino/sam/venv/bin/python. Null if neither exists. */
function resolvePython(): string | null {
  const cands = [process.env.KINO_SAM_PYTHON, join(samDir(), "venv", "bin", "python")];
  for (const p of cands) if (p && existsSync(p)) return p;
  return null;
}

const SETUP_HINT =
  "no usable SAM Python — point KINO_SAM_PYTHON at a venv with coremltools 9.0 + torch 2.7.0 + the " +
  "sam3 package (its CLIP-BPE tokenizer), or create ~/.kino/sam/venv. See docs/segmentation.md.";

/** Ensure the three AllanVester mlpackages exist under modelsDir (download once via the runner
 *  Python's huggingface_hub), and that a Python able to import coremltools is available. */
export async function ensureSamEnv(): Promise<string> {
  if (process.platform !== "darwin") {
    throw new Error("backend_unavailable: coreml segmentation needs macOS/Apple Silicon");
  }
  const py = resolvePython();
  if (!py) throw new Error(`sam_env_unavailable: ${SETUP_HINT}`);
  if (!(await pyCanImport(py, "coremltools"))) {
    throw new Error(`sam_env_unavailable: ${py} cannot import coremltools — ${SETUP_HINT}`);
  }

  const dir = modelsDir();
  const missing = PACKAGES.filter((p) => !existsSync(join(dir, `${p}.mlpackage`)));
  if (missing.length) {
    if (!(await pyCanImport(py, "huggingface_hub"))) {
      throw new Error(
        `sam_models_missing: ${missing.join(", ")} absent from ${dir} and ${py} lacks huggingface_hub ` +
          `to download them — pip install huggingface_hub, or huggingface-cli download --local-dir ${dir} ${HF_REPO}`,
      );
    }
    log.step(`downloading SAM3.1 CoreML models (~2.4GB, one-time) → ${dir}`);
    // Only the .mlpackage payloads; snapshot_download skips files already present.
    await execa(py, [
      "-c",
      "import sys;from huggingface_hub import snapshot_download;" +
        "snapshot_download(sys.argv[1], local_dir=sys.argv[2], allow_patterns=['*.mlpackage/*'])",
      HF_REPO,
      dir,
    ]);
    // SAM License is share-alike/attribution — leave a note next to the redistributed weights.
    writeFileSync(
      join(dir, "LICENSE_NOTE.txt"),
      `SAM3.1 CoreML weights from ${HF_REPO}, derivative of Meta's SAM 3.1 (SAM License:\n` +
        "https://github.com/facebookresearch/sam3/blob/main/LICENSE — share-alike, field-of-use, attribution).\n",
    );
  }

  // Tracker package (~86MB) for real video tracking — fetched alongside the image models.
  if (!existsSync(trackerPath(dir))) {
    if (!(await pyCanImport(py, "huggingface_hub"))) {
      throw new Error(
        `sam_tracker_missing: ${TRACKER_PKG} absent from ${dir} and ${py} lacks huggingface_hub — ` +
          `pip install huggingface_hub, or huggingface-cli download --local-dir ${dir} ${MODEL_REPO}`,
      );
    }
    log.step(`downloading SAM3.1 CoreML tracker (~86MB, one-time) → ${dir}`);
    await execa(py, [
      "-c",
      "import sys;from huggingface_hub import snapshot_download;" +
        `snapshot_download(sys.argv[1], local_dir=sys.argv[2], allow_patterns=['tracker/models/${TRACKER_PKG}/*'])`,
      MODEL_REPO,
      dir,
    ]);
    flattenDownload(dir, "tracker");
  }

  // Vision backbone (~875MB fp16) for per-frame features — MLX preferred at runtime when
  // KINO_SAM_MLX_PYTHON is set; this CoreML package is the default Apple-Silicon fallback.
  if (!backbonePresent(dir)) {
    if (!(await pyCanImport(py, "huggingface_hub"))) {
      throw new Error(
        `sam_backbone_missing: ${BACKBONE_PKG} absent from ${dir} and ${py} lacks huggingface_hub — ` +
          `pip install huggingface_hub, or huggingface-cli download --local-dir ${dir} ${MODEL_REPO}`,
      );
    }
    log.step(`downloading SAM3.1 CoreML vision backbone (~875MB, one-time) → ${dir}`);
    await execa(py, [
      "-c",
      "import sys;from huggingface_hub import snapshot_download;" +
        `snapshot_download(sys.argv[1], local_dir=sys.argv[2], allow_patterns=['backbone/models/${BACKBONE_PKG}/*'])`,
      MODEL_REPO,
      dir,
    ]);
    flattenDownload(dir, "backbone");
  }
  return py;
}

/** The merged HF repo nests packages under tracker/models/ and backbone/models/; flatten the
 *  just-downloaded subdir's models/ into dir/models/ so trackerPath/backbonePath keep working. */
function flattenDownload(dir: string, subdir: string): void {
  const src = join(dir, subdir, "models");
  const dest = join(dir, "models");
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) renameSync(join(src, name), join(dest, name));
  rmSync(join(dir, subdir), { recursive: true, force: true });
}

async function pyCanImport(py: string, mod: string): Promise<boolean> {
  try {
    await execa(py, ["-c", `import ${mod}`]);
    return true;
  } catch {
    return false;
  }
}

export const coremlBackend: Backend = {
  name: "coreml",
  async run(req: SegmentRequest): Promise<SegmentResult> {
    const py = await ensureSamEnv();
    const args = [RUNNER, "--input", req.input, "--prompt", req.prompt, "--out", req.outDir, "--objects", String(req.objects)];
    if (VIDEO_EXT.test(req.input)) {
      args.push("--video");
      if (req.track) {
        // REAL temporal tracking: frame-0 text→mask seeds the PyTorch mask-prompt init, then
        // MLX (preferred) or CoreML vision backbone → stateful CoreML tracker (tracked:true).
        // ~1.9s/frame measured (CoreML + every=2); MLX when KINO_SAM_MLX_PYTHON set; ~7–8s PyTorch.
        args.push("--track");
        log.step("coreml video: real temporal tracking (~1.9s/frame; --no-track for the fast per-frame path)");
      } else {
        // Per-frame image seg — masks independent per frame; fast motion can flicker. tracked:false.
        log.step("coreml video: per-frame segmentation (no tracking; fast, flicker possible on fast motion)");
      }
    }
    await execa(py, args, { stdio: ["ignore", "inherit", "inherit"] });
    const manifest = readManifest(req.outDir);
    return { manifest, outDir: req.outDir };
  },
};
