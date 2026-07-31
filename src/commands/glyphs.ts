// `kino glyphs "Showreel"` — letterform outlines as SVG path data.
//
// A motion page can already do a lot with text AS text (clipPath through letterforms, stroke-dasharray
// draw-on, per-tspan colour). What it cannot do is treat a glyph as geometry, so `data-kino-morph-stops`
// — which interpolates a `d` attribute — has nothing to bite on. This command is the bridge: it prints
// real path data the author pastes into their own <svg>, then morphs, strokes or clips like any path.
//
// A command rather than an engine attribute on purpose. Morph endpoints are static strings, and a title
// card's copy does not change per frame, so resolving outlines at author time keeps the render path
// untouched and makes the result inspectable before it ships.
import { readFileSync } from "node:fs";
import { ensureFont, resolveFont } from "../fonts/manager.js";
import { parseTtf, textOutlines } from "../fonts/glyf.js";
import { log } from "../log.js";

export interface GlyphsOpts {
  font?: string;
  size?: string;
  letterSpacing?: string;
  combined?: boolean;
  json?: boolean;
}

export async function glyphs(text: string, opts: GlyphsOpts): Promise<void> {
  const name = opts.font ?? "Inter";
  const def = await resolveFont(name);
  if (!def) {
    throw new Error(`"${name}" is a CSS font stack — outlines need a single family name (run \`kino fonts\` for the shortlist)`);
  }
  const ttf = await ensureFont(def.family, def.weight);
  if (!ttf) {
    const hint = def.suggestion ? ` Did you mean "${def.suggestion}"?` : "";
    throw new Error(`Font "${def.family}" could not be downloaded (unknown family, or offline?) — outlines need the TTF.${hint}`);
  }
  const font = parseTtf(readFileSync(ttf));
  const size = opts.size ? Number(opts.size) : 100;
  if (!Number.isFinite(size) || size <= 0) throw new Error(`--size must be a positive number, got "${opts.size}"`);
  const letterSpacing = opts.letterSpacing ? Number(opts.letterSpacing) : 0;
  const run = textOutlines(font, text, { size, letterSpacing });

  if (opts.json) {
    console.log(JSON.stringify(run, null, 2));
    return;
  }

  // Baseline at y=0 with Y flipped, so the box spans the ascender (negative) to the descender.
  const top = Math.floor(-run.ascender);
  const height = Math.ceil(run.ascender - run.descender);
  const width = Math.ceil(run.advance);
  const drawn = run.glyphs.filter((g) => g.d);

  log.info(`${def.family} ${def.weight} · ${size}px em · advance ${run.advance.toFixed(1)} · ${drawn.length}/${run.glyphs.length} glyphs with outlines`);
  log.info(`viewBox="0 ${top} ${width} ${height}"   (baseline is y=0; ascender is negative)`);
  console.log("");
  if (opts.combined) {
    console.log(`<path d="${drawn.map((g) => g.d).join("")}"/>`);
  } else {
    for (const g of drawn) {
      console.log(`<!-- ${JSON.stringify(g.char)} x=${g.x.toFixed(1)} adv=${g.advance.toFixed(1)} -->`);
      console.log(`<path d="${g.d}"/>`);
    }
  }
  console.log("");
  log.info("Morph between two runs of the SAME string at different sizes/fonts, or between a glyph and a");
  log.info("shape you author — data-kino-morph-stops needs both endpoints to share command structure, so");
  log.info("`kino glyphs` twice on the same text gives a pair that always matches. See `kino motion`.");
}
