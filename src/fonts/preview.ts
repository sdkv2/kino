// `kino fonts --preview <family>` — a type specimen rendered through the REAL caption pipeline.
//
// The point is to answer "what will this font look like in my video", and a generic specimen card
// cannot: what decides whether a face works here is the caption treatment (900 weight, black stroke,
// hero size, accent-coloured active word) over the brand's own background, at the brand's own
// captionFontSize. Two aspect ratios because the same face reads differently at 1080 wide with a
// wrapped hero line than at 1920 wide on one line.
//
// So this synthesises a one-beat KinoProps by hand and hands it to renderStills — no spec file, no
// VO, no project. That bypass is deliberate: prepare() would demand a spec, a title, a voice and a
// project on disk to show a font swatch.
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { renderStills } from "../render/render.js";
import type { FormatId } from "../render/formats.js";
import type { KinoProps, KinoSegment, WordTiming } from "../render/props.js";
import type { ResolvedText } from "../render/textStyles.js";
import type { Brand } from "../config/brand.js";
import { resolveCaptionBackplate } from "../render/elements.js";
import { scratchDir } from "../scratch.js";
import type { ResolvedFont } from "./manager.js";

/** The specimen. A pangram, so every letterform is on screen, but one that still scans as a line of
 *  copy — a font here has to be judged as a caption, not as an alphabet in a box.
 *
 *  Its LAST word carries the accent highlight: the caption layer's active word is the last one whose
 *  start time has passed, and every word here starts at 0, so the whole line is up and the highlight
 *  lands on the end.
 *
 *  It also carries the specimen ALONE — there is deliberately no alphabet/symbol row beside it. A
 *  `texts[]` overlay holding a dense run (an all-caps alphabet, a symbol row) comes out of the raster
 *  horizontally CRUSHED: glyphs overlap their neighbours, worst on the ones whose ink fills the
 *  advance (M, W, @, &). A mixed-case string with spaces at the same size and slot renders clean, and
 *  swapping a dense and a sparse overlay between two slots showed the crush following the STRING, not
 *  the slot. That is a pre-existing defect in the overlay raster path — the caption surface is
 *  unaffected, since its words are laid out as separate boxes — and it is not this command's to fix.
 *  A specimen must not stand on it, or every font would look broken here for a reason that has
 *  nothing to do with the font. */
const SPECIMEN_LINE = "Pack my box with five dozen liquor jugs";

/** Font-name label size, as a fraction of the brand caption size — subordinate to the caption, which
 *  is the thing actually being judged. */
const LABEL_SCALE = 0.5;

const FPS = 30;
const BEAT_SEC = 2;
/** Sampled late in the beat so every entrance animation has settled — a specimen must not catch
 *  the caption mid-pop. */
const SAMPLE_SEC = 1.6;

export const PREVIEW_FORMATS: FormatId[] = ["9:16", "16:9"];

export function previewDir(): string {
  return join(homedir(), ".kino", "font-previews");
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function specimenWords(line: string): WordTiming[] {
  // All start at 0: the hero caption shows a word once its start has passed, so the full line is up,
  // and "last word whose start has passed" lands on the final word — the one we want highlighted.
  return line.split(/\s+/).map((word) => ({ word, start: 0, end: BEAT_SEC }));
}

function specimenProps(font: ResolvedFont, brand: Brand, fontUrl: string | null): KinoProps {
  const c = brand.colors;
  const labelPx = Math.round(brand.captionStyle.fontSize * LABEL_SCALE);
  const overlay = (text: string, y: number): ResolvedText => ({
    text,
    fromSec: 0,
    durSec: BEAT_SEC,
    x: 50,
    y,
    sizePx: labelPx,
    style: "minimal",
    animation: "none",
  });
  const segment: KinoSegment = {
    kind: "scene",
    caption: SPECIMEN_LINE,
    startSec: 0,
    endSec: BEAT_SEC,
    captionMode: "words",
    words: specimenWords(SPECIMEN_LINE),
    captionReveal: "all",
    // The brand's own caption look, so the specimen shows the treatment this font will actually be
    // wearing (a stroke face and a highlight face are not the same judgement).
    captionStyle: brand.captionStyle.style,
    texts: [overlay(`${font.family} · ${font.weight}`, 12)],
  };
  return {
    theme: {
      // Same shape build.ts stages: the downloaded face under a fixed family name, with the real
      // family behind it so a failed download still previews the closest system match.
      font: fontUrl ? `"KinoBrandFont", "${font.family}", Helvetica, Arial, sans-serif` : `"${font.family}", Helvetica, Arial, sans-serif`,
      fontUrl,
      fontFaces: null,
      bg: c.bg,
      accent: c.accent,
      deep: c.deep,
      accent2: c.accent2,
      fg: c.fg,
      captionFontSize: brand.captionStyle.fontSize,
      captionStroke: brand.captionStyle.strokeWidth,
      captionBg: resolveCaptionBackplate(brand.captionStyle.background, c.bg),
      film: 0, // a specimen wants clean glyph edges, not vignette + grain
    },
    fps: FPS,
    avatar: null, // no presenter → the caption renders as centered hero text
    avatarWindows: [],
    voTrack: null,
    background: {
      kind: "solid",
      image: null,
      customCode: null,
      shaderCode: null,
      params: { colorA: c.bg, colorB: c.bg, colorC: c.accent, intensity: 1 },
      keyframes: [],
      triggers: [],
    },
    disclosure: "",
    segments: [segment],
  };
}

export interface FontPreviewOpts {
  brand: Brand;
  formats?: FormatId[];
  outDir?: string;
}

/**
 * Render one specimen PNG per format. Returns the written paths (in `formats` order) for an agent
 * or a human to open.
 *
 * `ttfPath` is the already-downloaded caption cut, or null to preview whatever system face the
 * family name resolves to — a preview that silently showed Helvetica for an unavailable font would
 * be worse than useless, so callers warn when they pass null.
 */
export async function renderFontPreview(font: ResolvedFont, ttfPath: string | null, opts: FontPreviewOpts): Promise<string[]> {
  const formats = opts.formats ?? PREVIEW_FORMATS;
  const outDir = opts.outDir ?? join(previewDir(), slug(font.family));
  // Cold render: a stale PNG from a previous font is exactly the failure this command exists to
  // avoid, and the paths are stable per family so they would otherwise be read as current.
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const publicDir = scratchDir("kino-font-preview-");
  let fontUrl: string | null = null;
  if (ttfPath) {
    copyFileSync(ttfPath, join(publicDir, "font.ttf"));
    fontUrl = "font.ttf";
  }
  const props = specimenProps(font, opts.brand, fontUrl);

  const out: string[] = [];
  for (const format of formats) {
    const written = await renderStills({
      props,
      publicDir,
      format,
      frames: [{ frame: Math.round(SAMPLE_SEC * FPS), name: `${slug(font.family)}-${format.replace(/:/g, "x")}` }],
      outDir,
    });
    out.push(...written);
  }
  return out;
}
