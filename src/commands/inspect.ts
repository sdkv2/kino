import { prepare } from "./build.js";
import { inspectPlan } from "../render/preview.js";

// Print the resolved render plan as JSON (stdout) — the agent's map of every beat.
export async function inspect(specPath: string, opts: { real?: boolean; project?: string }): Promise<void> {
  const r = await prepare(specPath, { mock: !opts.real, project: opts.project });
  const plan = inspectPlan(r.props);
  // attach per-segment word timestamps (agents keyframe backgrounds/effects against these)
  const segments = plan.segments.map((s, i) => ({ ...s, words: r.words[i] ?? [] }));
  const out = { title: r.spec.title, timing: opts.real ? "real" : "mock-estimate", ...plan, segments };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}
