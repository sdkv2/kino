import { resolveProject } from "../config/project.js";
import { runSegment } from "../segment/segment.js";
import type { SegmentBackend } from "../segment/backend.js";
import { log } from "../log.js";

export async function segment(
  input: string,
  opts: {
    prompt?: string;
    objects?: string;
    out?: string;
    track?: boolean; // Commander --no-track flips this to false; default true
    backend?: string;
    format?: string;
  },
): Promise<void> {
  if (!opts.prompt) throw new Error("kino segment requires --prompt <text>");
  if (opts.backend && opts.backend !== "coreml" && opts.backend !== "cuda" && opts.backend !== "mock") {
    throw new Error(`--backend must be "coreml", "cuda", or "mock" (got ${opts.backend})`);
  }

  const project = resolveProject({ specPath: input });

  let result;
  try {
    result = await runSegment({
      input,
      prompt: opts.prompt,
      objects: opts.objects ? Number(opts.objects) : undefined,
      track: opts.track,
      out: opts.out,
      backend: opts.backend as SegmentBackend | undefined,
      projectRoot: project.projectRoot,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Distinguish setup-needed (no Mac/model) from bad-input so an agent can react — machine
    // output stays on stdout, exitCode non-zero without a hard process.exit() stack dump.
    if (message.includes("backend_unavailable")) {
      process.stdout.write(JSON.stringify({ error: "backend_unavailable", message }, null, 2) + "\n");
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  if (opts.format === "json" || !process.stdout.isTTY) {
    process.stdout.write(JSON.stringify(result.manifest, null, 2) + "\n");
  } else {
    log.ok(result.outDir);
    log.step(`${result.manifest.kind}, ${result.manifest.objects.length} object(s), backend=${result.manifest.backend}, tracked=${result.manifest.tracked}`);
  }
}
