import { join } from "node:path";
import { prepare } from "./build.js";
import { renderStills } from "../render/render.js";
import { pickFrames } from "../render/preview.js";
import { montage } from "../media/montage.js";
import { log } from "../log.js";

// One labeled still per beat, tiled into a single contact sheet — review the whole video at a glance.
export async function storyboard(specPath: string, opts: { real?: boolean; format?: string }): Promise<void> {
  const r = await prepare(specPath, { mock: !opts.real, format: opts.format });
  const picks = pickFrames(r.props.segments, r.props.fps, {});
  const format = r.formats[0] as "9:16" | "3:4";
  const frames = picks.map((_, i) => ({ frame: picks[i].frame, name: `sb-${i}` }));
  const outDir = join(r.project.outDir(r.spec.title), "stills");
  const stills = await renderStills({ props: r.props, publicDir: r.publicDir, format, frames, outDir });
  const out = join(r.project.outDir(r.spec.title), "storyboard.png");
  await montage(stills.map((p, i) => ({ path: p, label: picks[i].label })), out);
  log.ok(out);
}
