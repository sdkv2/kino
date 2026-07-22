import { join } from "node:path";
import { prepare } from "./build.js";
import { renderStills } from "../render/render.js";
import { pickFrames } from "../render/preview.js";
import { montage } from "../media/montage.js";
import { parsePlatform } from "../render/platform.js";
import { log } from "../log.js";

// One labeled still per beat, tiled into a single contact sheet — review the whole video at a glance.
export async function storyboard(
  specPath: string,
  opts: { real?: boolean; format?: string; font?: string; project?: string; frames?: string; platform?: string },
): Promise<void> {
  const r = await prepare(specPath, { mock: !opts.real, format: opts.format, font: opts.font, project: opts.project });
  const platformGuide = parsePlatform(opts.platform);
  if (platformGuide) r.props.platformGuide = platformGuide;
  // Frames per beat: default 2 — the composition frame plus the fully-revealed end-state, where a
  // caption's overflow or a collision with a `texts` overlay actually shows. Cap at 4.
  const perBeat = Math.min(4, Math.max(1, Math.round(Number(opts.frames) || 2)));
  const picks = pickFrames(r.props.segments, r.props.fps, {}, perBeat);
  const format = r.formats[0];
  const frames = picks.map((p, i) => ({ frame: p.frame, name: `sb-${i}` }));
  const outDir = join(r.project.outDir(r.spec.title), "stills");
  const stills = await renderStills({ props: r.props, publicDir: r.publicDir, format, frames, outDir });
  const out = join(r.project.outDir(r.spec.title), "storyboard.png");
  // Keep each beat's frames grouped on a row: cols = perBeat × (beats-per-row).
  const cols = perBeat * Math.max(1, Math.floor(4 / perBeat));
  await montage(stills.map((p, i) => ({ path: p, label: picks[i].label })), out, { font: r.labelFont ?? undefined, cols });
  log.ok(out);
}
