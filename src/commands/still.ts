import { join } from "node:path";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { prepare } from "./build.js";
import { renderStills, type FrameMeasure } from "../render/render.js";
import { runMotionQa, qaReportPath } from "../render/motionQa.js";
import { parseQuality } from "../render/native/engine.js";
import { pickFrames, parseTimes, timesAround, inspectPlan } from "../render/preview.js";
import { montage } from "../media/montage.js";
import { parsePlatform } from "../render/platform.js";
import { dumpMotionAt, dumpHeader } from "../render/motionDump.js";
import { compDims } from "../render/formats.js";
import { resolveWordAnchors } from "../render/motionVars.js";
import { log } from "../log.js";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** `--segment 2` or `--segment 0,1,2` → beat indices. Rejects junk rather than rendering beat NaN. */
function parseSegments(raw: string): number[] {
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const out = parts.map((p) => {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0) throw new Error(`kino still --segment takes beat indices (got "${p}")`);
    return n;
  });
  if (!out.length) throw new Error("kino still --segment needs at least one beat index");
  return out;
}

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
  quality?: string;
  dumpHtml?: boolean;
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
    const asked = parseSegments(opts.segment);
    if (asked.length !== 1) throw new Error("kino still --word centers one sheet, so it needs a single --segment <n>");
    const segIdx = asked[0]!;
    if (!r.words[segIdx]) throw new Error(`--segment ${segIdx} out of range (spec has ${r.words.length} segments, 0-indexed 0..${r.words.length - 1})`);
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

  const sel = at ? { at } : opts.segment != null ? { segment: parseSegments(opts.segment) } : {};
  const picks = pickFrames(r.props.segments, r.props.fps, sel);
  const format = r.formats[0];
  const frames = picks.map((p) => ({ frame: p.frame, name: slug(p.label) || "frame" }));
  const outDir = join(r.project.outDir(r.spec.title), "stills");
  // Always cold-render: wipe prior PNGs so agents and QA never read a stale still by path. Say so —
  // silently deleting the previous run's frames is how a per-beat loop of single --segment calls
  // ends up with only the last beat on disk. (`--segment 0,1,2` renders them all in one run.)
  if (existsSync(outDir)) {
    const stale = readdirSync(outDir).filter((f) => f.endsWith(".png")).length;
    if (stale) log.info(`clearing ${stale} still${stale === 1 ? "" : "s"} from the previous run (each run is a cold render) → ${outDir}`);
    rmSync(outDir, { recursive: true, force: true });
  }
  const measurements: FrameMeasure[] = [];
  const outs = await renderStills({ props: r.props, publicDir: r.publicDir, format, frames, outDir, measureSink: opts.measure ? measurements : undefined, quality: parseQuality(opts.quality) });
  outs.forEach((o) => log.ok(o));

  // Authored-graphic QA in the authoring loop. A still shows one instant, so it cannot show that a
  // beat is frozen, that only the background is moving, or that a coloured effect rendered grey —
  // which is exactly what the agent iterating on this command needs to know. Diagnostic only.
  await runMotionQa({
    props: r.props,
    publicDir: r.publicDir,
    format,
    quality: parseQuality(opts.quality),
    reportPath: qaReportPath(outDir),
  });

  // --dump-html: the exact markup each motion graphic produced at these frames. A Tier-2 graphic
  // builds its markup in the page, so when a layer renders blank there is otherwise nothing to read.
  if (opts.dumpHtml) {
    const dims = compDims(format);
    let wrote = 0;
    for (const p of picks) {
      for (const d of dumpMotionAt(r.props, dims, p.frame)) {
        const file = join(outDir, `${slug(p.label) || "frame"}-seg${d.segment}-${d.slot}.html`);
        writeFileSync(file, dumpHeader(d) + d.html);
        wrote++;
        if (d.error) log.warn(`segment ${d.segment} proc threw at frame ${d.frame}: ${d.error}`);
        // A missing filter/mask id renders the element as NOTHING, so it is the likeliest reason a
        // dump is being read at all — point at it rather than making the agent diff the markup.
        for (const id of new Set((d.html.match(/url\(\s*['"]?#([-_a-zA-Z][\w-]*)/g) ?? []).map((u) => u.replace(/.*#/, "")))) {
          if (!new RegExp(`\\bid=["']${id}["']`).test(d.html) && !id.startsWith("kino-")) {
            log.warn(`segment ${d.segment} @ frame ${d.frame}: url(#${id}) has no matching id in the emitted markup — that layer renders nothing`);
          }
        }
        if (/\bNaN\b/.test(d.html)) {
          log.warn(`segment ${d.segment} @ frame ${d.frame}: emitted markup contains "NaN" — check for a stray unary plus (\`'x' + + f()\`) in the concat chain`);
        }
      }
    }
    if (wrote) log.ok(`${wrote} motion dump${wrote === 1 ? "" : "s"} → ${outDir}`);
    else log.info("--dump-html: no motion graphics live at the selected frames");
  }

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
