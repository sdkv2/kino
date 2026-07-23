import { join } from "node:path";
import { prepare } from "./build.js";
import { renderStills, type FrameMeasure } from "../render/render.js";
import { pickFrames, parseTimes, timesAround, inspectPlan } from "../render/preview.js";
import { montage } from "../media/montage.js";
import { parsePlatform } from "../render/platform.js";
import { resolveWordAnchors } from "../render/motionVars.js";
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
  word?: string;
  grid?: boolean;
  measure?: boolean;
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
  if (opts.grid) r.props.grid = true;
  const plan = inspectPlan(r.props);

  // --word: center the sheet on a spoken word's start — no hand-copying times from `kino inspect`.
  // r.words are absolute timeline seconds, so the anchor is already a global timestamp.
  let wordCenter: number | undefined;
  if (opts.word != null) {
    if (opts.segment == null) throw new Error("kino still --word needs --segment <n> (the beat that speaks it)");
    const segIdx = Number(opts.segment);
    const anchored = resolveWordAnchors([{ atWord: opts.word, action: "seek" }], r.words[segIdx], `segment[${segIdx}]`);
    wordCenter = anchored![0].at;
  }

  let at: number[] | undefined;
  if (opts.around != null || wordCenter != null) {
    const center = wordCenter ?? Number(opts.around);
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

  const sel = at ? { at } : opts.segment != null ? { segment: Number(opts.segment) } : {};
  const picks = pickFrames(r.props.segments, r.props.fps, sel);
  const format = r.formats[0] as "9:16" | "3:4" | "16:9";
  const frames = picks.map((p) => ({ frame: p.frame, name: slug(p.label) || "frame" }));
  const outDir = join(r.project.outDir(r.spec.title), "stills");
  const measurements: FrameMeasure[] = [];
  const outs = await renderStills({ props: r.props, publicDir: r.publicDir, format, frames, outDir, measureSink: opts.measure ? measurements : undefined });
  outs.forEach((o) => log.ok(o));

  // --measure: deterministic element geometry so alignment is read as numbers, not eyeballed.
  // Δx/Δy are the element center's signed offset from frame center in % (0 = dead-center).
  if (opts.measure) {
    for (const fm of measurements) {
      if (!fm.elements.length) {
        log.warn(`measure @ ${fm.name}: no [data-measure] elements — tag nodes with data-measure="name" to probe them`);
        continue;
      }
      log.info(`measure @ ${fm.name} (${fm.width}×${fm.height}, center ${fm.width / 2},${fm.height / 2}):`);
      for (const e of fm.elements) {
        const sx = e.dxPct >= 0 ? "+" : "";
        const sy = e.dyPct >= 0 ? "+" : "";
        log.info(
          `  ${e.label.padEnd(16)} cx ${e.cxPct.toFixed(1).padStart(5)}% (Δx ${sx}${e.dxPct.toFixed(1)})  ` +
            `cy ${e.cyPct.toFixed(1).padStart(5)}% (Δy ${sy}${e.dyPct.toFixed(1)})  ` +
            `box [${Math.round(e.x)},${Math.round(e.y)} ${Math.round(e.w)}×${Math.round(e.h)}]`,
        );
      }
    }
  }

  // --around/--word read a moment as a strip; tile by default. --montage tiles any multi-frame still.
  const wantMontage = opts.montage || opts.around != null || opts.word != null;
  if (wantMontage && outs.length > 1) {
    const tag = opts.word != null ? `word-${slug(opts.word)}` : opts.around != null ? `around-${opts.around}s` : "montage";
    const sheet = join(outDir, `${slug(r.spec.title) || "still"}-${tag}.png`);
    await montage(
      outs.map((p, i) => ({ path: p, label: picks[i].label })),
      sheet,
      { font: r.labelFont ?? undefined, cols: outs.length },
    );
    log.ok(sheet);
  }
}
