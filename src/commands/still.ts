import { join } from "node:path";
import { prepare } from "./build.js";
import { renderStills } from "../render/render.js";
import { pickFrames, parseTimes, timesAround, inspectPlan } from "../render/preview.js";
import { montage } from "../media/montage.js";
import { parsePlatform } from "../render/platform.js";
import { log } from "../log.js";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export type StillOpts = {
  at?: string;
  segment?: string;
  around?: string;
  span?: string;
  count?: string;
  montage?: boolean;
  real?: boolean;
  format?: string;
  font?: string;
  project?: string;
  platform?: string;
};

// Render one (or a few) still frames — fast preview, no video encode.
//   --at <sec,...>   specific timestamps      --segment <n>   one beat's midpoint
//   --around <sec>   N frames in a window around a point (implies montage)
//   (neither)        one still per beat        --real          true VO/avatar + timing
//   --montage        tile multiple stills into one contact sheet
export async function still(specPath: string, opts: StillOpts): Promise<void> {
  const r = await prepare(specPath, { mock: !opts.real, format: opts.format, font: opts.font, project: opts.project });
  const platformGuide = parsePlatform(opts.platform);
  if (platformGuide) r.props.platformGuide = platformGuide;
  const plan = inspectPlan(r.props);

  let at: number[] | undefined;
  if (opts.around != null) {
    const center = Number(opts.around);
    if (!Number.isFinite(center)) throw new Error(`kino still --around needs a number (got ${opts.around})`);
    at = timesAround(center, {
      count: opts.count ? Number(opts.count) : undefined,
      span: opts.span ? Number(opts.span) : undefined,
      min: 0,
      max: plan.durationSec,
    });
  } else if (opts.at) {
    at = parseTimes(opts.at);
  }

  const sel = at
    ? { at }
    : opts.segment != null
      ? { segment: Number(opts.segment) }
      : {};
  const picks = pickFrames(r.props.segments, r.props.fps, sel);
  const format = r.formats[0] as "9:16" | "3:4";
  const frames = picks.map((p) => ({ frame: p.frame, name: slug(p.label) || "frame" }));
  const outDir = join(r.project.outDir(r.spec.title), "stills");
  const outs = await renderStills({ props: r.props, publicDir: r.publicDir, format, frames, outDir });
  outs.forEach((o) => log.ok(o));

  // --around is for reading a moment as a strip; tile by default. --montage tiles any multi-frame still.
  const wantMontage = opts.montage || opts.around != null;
  if (wantMontage && outs.length > 1) {
    const tag = opts.around != null ? `around-${opts.around}s` : "montage";
    const sheet = join(outDir, `${slug(r.spec.title) || "still"}-${tag}.png`);
    await montage(
      outs.map((p, i) => ({ path: p, label: picks[i].label })),
      sheet,
      { font: r.labelFont ?? undefined, cols: outs.length },
    );
    log.ok(sheet);
  }
}
