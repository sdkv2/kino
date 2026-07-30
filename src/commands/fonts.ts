import { FONTS } from "../fonts/registry.js";
import { cachedFontPath, ensureFont, resolveFont } from "../fonts/manager.js";
import { googleFontsKey, loadCatalog, searchCatalog } from "../fonts/googleApi.js";
import { renderFontPreview, PREVIEW_FORMATS } from "../fonts/preview.js";
import { DEFAULT_BRAND, loadBrand, type Brand } from "../config/brand.js";
import { resolveWorkspace } from "../config/project.js";
import { parseFormatList } from "../render/formats.js";
import { log } from "../log.js";

export interface FontsOpts {
  search?: string;
  preview?: string;
  brand?: string;
  format?: string;
  refresh?: boolean;
}

// The curated shortlist is a recommendation surface, not a whitelist: ANY Google Fonts family name
// works in brand.font. Say so here, since this listing is where an author decides what to type.
function listCurated(): void {
  process.stdout.write("Curated fonts (● cached · ○ downloads on first use):\n\n");
  for (const f of FONTS) {
    const dot = cachedFontPath(f.family, f.weight) ? "●" : "○";
    process.stdout.write(`  ${dot} ${f.name.padEnd(18)} ${f.description}\n`);
  }
  process.stdout.write(
    '\nUse a name as brand.font (e.g. "Anton") or brand.labelFont.\n' +
      "Any other Google Fonts family works too — this list is just the tuned shortlist.\n" +
      "  kino fonts --search <term>      find families in the full catalog (needs GOOGLE_FONTS_API_KEY)\n" +
      "  kino fonts --preview <family>   render a specimen still in 9:16 + 16:9\n",
  );
}

async function search(term: string, refresh: boolean): Promise<void> {
  const catalog = await loadCatalog({ refresh });
  if (!catalog) {
    // Not an error: the catalog is the only thing a key unlocks, and every other font path works
    // without one. Say exactly what is missing rather than failing the command.
    log.warn("No font catalog available — searching needs the Google Fonts API.");
    process.stdout.write(
      "\nSet a (free) key to search the full catalog:\n" +
        "  1. https://console.cloud.google.com/apis/library/webfonts.googleapis.com → Enable\n" +
        "  2. Credentials → Create credentials → API key\n" +
        "  3. export GOOGLE_FONTS_API_KEY=...\n\n" +
        "Without a key you can still use any family by its exact name (kino fonts --preview <family>).\n",
    );
    return;
  }
  const hits = searchCatalog(catalog, term);
  if (!hits.length) {
    process.stdout.write(`No families match "${term}" (searched ${catalog.length} families).\n`);
    return;
  }
  process.stdout.write(`${hits.length} of ${catalog.length} families match "${term}" (most popular first):\n\n`);
  for (const f of hits) {
    const weights = f.weights.length ? f.weights.join(" ") : "—";
    process.stdout.write(`  ${f.family.padEnd(28)} ${f.category.padEnd(13)} ${weights}\n`);
  }
  process.stdout.write("\nPreview one: kino fonts --preview \"<family>\"\n");
}

/** The brand whose colours + caption size the specimen is rendered with. Falls back to the kino
 *  house defaults, so a preview works outside a workspace entirely. */
function previewBrand(name: string | undefined): Brand {
  if (!name) return DEFAULT_BRAND;
  return loadBrand(resolveWorkspace().brandDir(name));
}

async function preview(name: string, opts: FontsOpts): Promise<void> {
  const font = await resolveFont(name);
  if (!font) {
    throw new Error(`"${name}" is a CSS font stack, not a family to preview — pass a single family name (e.g. "Space Mono")`);
  }
  const formats = opts.format ? parseFormatList(opts.format) : PREVIEW_FORMATS;
  const ttf = await ensureFont(font.family, font.weight);
  if (!ttf) {
    // Render anyway — the still shows the system fallback, which is itself the answer to "why does
    // my build not look like the font I asked for".
    const hint = font.suggestion ? ` Did you mean "${font.suggestion}"?` : "";
    log.warn(`Could not download "${font.family}" (unknown family, or offline).${hint} Previewing the system fallback instead.`);
  }
  const brand = previewBrand(opts.brand);
  const outs = await renderFontPreview(font, ttf, { brand, formats });
  const weights = font.available?.length ? `  ·  available cuts: ${font.available.join(" ")}` : "";
  log.info(`${font.family}  ·  caption cut ${font.weight}${font.curated ? " (curated)" : ""}${weights}`);
  outs.forEach((o) => log.ok(o));
}

// List the curated fonts, search the full Google Fonts catalog, or render a specimen still.
export async function fonts(opts: FontsOpts = {}): Promise<void> {
  if (opts.preview) return preview(opts.preview, opts);
  if (opts.search) return search(opts.search, !!opts.refresh);
  if (opts.refresh) {
    const catalog = await loadCatalog({ refresh: true });
    if (!catalog) throw new Error("Could not refresh the font catalog — set GOOGLE_FONTS_API_KEY and check the network");
    log.ok(`Font catalog refreshed: ${catalog.length} families`);
    return;
  }
  listCurated();
  if (!googleFontsKey()) {
    process.stdout.write("  (set GOOGLE_FONTS_API_KEY to search the full catalog and read real weight lists)\n");
  }
}
