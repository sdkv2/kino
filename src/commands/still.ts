import { join } from "node:path";
import { prepare } from "./build.js";
import { renderStills } from "../render/render.js";
import { pickFrames, parseTimes } from "../render/preview.js";
import { log } from "../log.js";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Render one (or a few) still frames — fast preview, no video encode.
//   --at <sec,...>   specific timestamps      --segment <n>   one beat's midpoint
//   (neither)        one still per beat        --real          true VO/avatar + timing
export async function still(
  specPath: string,
  opts: { at?: string; segment?: string; real?: boolean; format?: string; font?: string; project?: string },
): Promise<void> {
  const r = await prepare(specPath, { mock: !opts.real, format: opts.format, font: opts.font, project: opts.project });
  const sel = opts.at
    ? { at: parseTimes(opts.at) }
    : opts.segment != null
      ? { segment: Number(opts.segment) }
      : {};
  const picks = pickFrames(r.props.segments, r.props.fps, sel);
  const format = r.formats[0] as "9:16" | "3:4";
  const frames = picks.map((p) => ({ frame: p.frame, name: slug(p.label) || "frame" }));
  const outDir = join(r.project.outDir(r.spec.title), "stills");
  const outs = await renderStills({ props: r.props, publicDir: r.publicDir, format, frames, outDir });
  outs.forEach((o) => log.ok(o));
}
