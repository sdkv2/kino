import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, statSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { FFMPEG_PATH } from "../src/media/binPaths.js";
import { coremlBackend } from "../src/segment/coreml.js";
import { readManifest } from "../src/segment/manifest.js";

// The real CoreML engine: SAM3.1 text-prompt image seg on Apple Silicon. Runs for real on a
// configured Mac (downloads ~2.4GB models on first use, then ~15-20s/run). Skips off-darwin (CI)
// and on a Mac without a SAM Python configured — set KINO_SAM_PYTHON to a venv with coremltools +
// torch + the sam3 tokenizer (see docs/segmentation.md). It is NOT skipped because the engine is
// broken — the pipeline composes cleanly (ImageEncoder → TextEncoder → Detector).
function samPython(): string {
  return process.env.KINO_SAM_PYTHON ?? join(homedir(), ".kino", "sam", "venv", "bin", "python");
}
const ready = process.platform === "darwin" && existsSync(samPython());

describe("coreml backend (mac)", () => {
  it.skipIf(!ready)(
    "segments a fixture image → non-empty mask.png + manifest backend=coreml",
    async () => {
      const outDir = mkdtempSync(join(tmpdir(), "kino-coreml-"));
      const fixture = join(outDir, "fixture.png");
      // Tiny synthetic image: a light disc on dark — a concrete thing to segment. Model resizes to
      // 1008 internally, so keeping the fixture small only speeds the test.
      await execa(FFMPEG_PATH, [
        "-y", "-loglevel", "error",
        "-f", "lavfi", "-i", "color=black:s=256x256",
        "-frames:v", "1",
        "-vf", "geq=lum='if(lt(pow(X-128,2)+pow(Y-128,2),3600),235,10)'",
        "-pix_fmt", "rgb24",
        fixture,
      ]);

      const res = await coremlBackend.run({
        input: fixture, prompt: "circle", objects: 1, track: false, outDir,
      });

      const mask = join(outDir, "mask.png");
      expect(existsSync(mask)).toBe(true);
      expect(statSync(mask).size).toBeGreaterThan(0);
      const m = readManifest(outDir);
      expect(m.backend).toBe("coreml");
      expect(m.kind).toBe("image");
      expect(m.tracked).toBe(false);
      expect(m.width).toBe(256);
      expect(m.height).toBe(256);
      expect(m.objects.length).toBeGreaterThanOrEqual(1);
      expect(res.outDir).toBe(outDir);
    },
    240_000,
  );
});
