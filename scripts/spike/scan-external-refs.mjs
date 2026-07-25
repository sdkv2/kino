// M4: which references inside motion HTML would vanish in a foreignObject raster?
// SVG-as-image runs in a restricted mode: no external fetches. data: URLs and
// in-document fragment refs (#id) survive; everything else does not.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const IMG_SRC = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
const CSS_URL = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;

export function findExternalRefs(html) {
  const found = new Set();
  const add = (ref) => {
    const r = ref.trim();
    if (!r || r.startsWith("data:") || r.startsWith("#")) return;
    found.add(r);
  };
  for (const m of html.matchAll(IMG_SRC)) add(m[1]);
  for (const m of html.matchAll(CSS_URL)) add(m[1]);
  return [...found];
}

// --- corpus scan -------------------------------------------------------------

// Every place a spec's motion markup can live. `html` on a motion beat or overlay,
// and `html` on a region-shader texture channel.
function motionHtmlIn(spec) {
  const out = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node.html === "string") out.push(node.html);
    Object.values(node).forEach(visit);
  };
  visit(spec);
  return out;
}

function walkJson(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e === "node_modules" || e === ".git" || e === "out") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkJson(p, acc);
    else if (e.endsWith(".json")) acc.push(p);
  }
  return acc;
}

if (process.argv[1]?.endsWith("scan-external-refs.mjs")) {
  const corpora = ["examples", "demos", "projects", "assets-lib"];
  for (const corpus of corpora) {
    const files = walkJson(corpus);
    let specsWithHtml = 0, specsWithRefs = 0;
    const refs = new Set();
    for (const f of files) {
      let spec;
      try {
        spec = JSON.parse(readFileSync(f, "utf8"));
      } catch {
        continue;
      }
      const htmls = motionHtmlIn(spec);
      if (!htmls.length) continue;
      specsWithHtml++;
      const found = htmls.flatMap(findExternalRefs);
      if (found.length) {
        specsWithRefs++;
        found.forEach((r) => refs.add(r));
        console.log(`  ${f}: ${found.join(", ")}`);
      }
    }
    console.log(`${corpus}: ${files.length} json, ${specsWithHtml} with motion html, ${specsWithRefs} with external refs, ${refs.size} distinct refs`);
  }
}
