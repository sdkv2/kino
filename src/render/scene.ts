// Determinism/safety lint + static asset extraction for *.scene.js sources (3D scenes).
// A scene file is the body of scene(api) and must return update(env). Same trust model as
// Tier-2 motion (docs/3d-scenes.md): local config, linted here, new Function in the page.
import { stripJsNoise } from "./motiongraphic.js";

const BANNED_SCENE: { re: RegExp; msg: string }[] = [
  { re: /\bMath\.random\b/, msg: "Math.random breaks determinism — use api.random(seed)" },
  { re: /\b(Date\.now|performance\.now)\b/, msg: "Date.now/performance.now break determinism — drive motion from env.t / env.frame" },
  { re: /\bnew\s+Date\b/, msg: "new Date breaks determinism — drive motion from env.t / env.frame" },
  { re: /\b(requestAnimationFrame|setTimeout|setInterval)\b/, msg: "timers/RAF aren't allowed — kino calls update(env) once per frame" },
  { re: /\b(fetch|XMLHttpRequest)\b/, msg: "network access isn't allowed — assets load through api.texture/api.gltf" },
  { re: /\brequire\s*\(/, msg: "require() isn't allowed — the scene body must be self-contained" },
  { re: /\bimport\b\s*[('"\w{*]/, msg: "import isn't allowed — the scene body must be self-contained (three is reachable only through api.*)" },
  { re: /\bprocess\s*[.\[]/, msg: "process isn't available — the scene runs in the browser, not Node" },
  { re: /\b(globalThis|window|document)\s*[.\[]/, msg: "globalThis/window/document aren't allowed — build the scene through api.*" },
  { re: /\son\w+\s*=/i, msg: "inline event handlers (on*=) aren't allowed" },
  { re: /\beval\s*\(/, msg: "eval() isn't allowed — the scene must be a pure function of api and env" },
  { re: /\bFunction\s*\(/, msg: "the Function constructor isn't allowed" },
  { re: /\b(atob|btoa)\s*\(/, msg: "atob/btoa aren't allowed" },
  { re: /\b(Date|Math)\s*\[/, msg: "computed access to Date/Math isn't allowed — use dotted Math.* and env.t / env.frame" },
];

export function lintSceneJs(src: string): string[] {
  const code = stripJsNoise(src);
  return BANNED_SCENE.filter((b) => b.re.test(code)).map((b) => b.msg);
}

// api.texture("lit") | api.texture(api.param("name")) — same for gltf/screen/layer. Group 1 = call name.
const CALL_RE = /\bapi\s*\.\s*(texture|gltf|screen|layer)\s*\(\s*(?:"([^"]*)"|'([^']*)'|api\s*\.\s*param\s*\(\s*(?:"(\w+)"|'(\w+)')\s*\))/g;
const CALL_SITE_RE = /\bapi\s*\.\s*(?:texture|gltf|screen|layer)\s*\(/g;

function badPath(p: string): boolean {
  return p.startsWith("/") || p.split("/").includes("..") || /^[a-z]+:/i.test(p);
}

/** Statically resolve every asset reference in a scene source. Paths are project-asset-relative. */
export function extractSceneAssets(
  src: string,
  params: Record<string, number | string>,
): { assets: string[]; violations: string[] } {
  const violations: string[] = [];
  const assets = new Set<string>();
  // stripJsNoise blanks comment/string spans in place (offsets preserved). Match on raw src to read
  // the real path arg, but skip any call whose head is blanked in `stripped` — i.e. one written
  // inside a comment or string literal. Without this, `// api.texture("x.png")` extracts a phantom
  // asset that Task 3 would then require to exist, breaking builds on an ordinary example comment.
  const stripped = stripJsNoise(src);
  let extracted = 0;
  for (const m of src.matchAll(CALL_RE)) {
    if (stripped.slice(m.index ?? 0, (m.index ?? 0) + 3) !== "api") continue;
    extracted++;
    const literal = m[2] ?? m[3];
    const paramName = m[4] ?? m[5];
    let path: string | undefined = literal;
    if (paramName !== undefined) {
      const v = params[paramName];
      if (typeof v !== "string" || !v) {
        violations.push(`api.param("${paramName}") needs a string value in the beat's params (got ${JSON.stringify(v)})`);
        continue;
      }
      path = v;
    }
    if (!path) {
      violations.push(`empty asset path in api.texture/api.gltf/api.screen/api.layer`);
      continue;
    }
    if (badPath(path)) {
      violations.push(`asset path "${path}" must be a relative project asset path (no leading /, .., or URLs)`);
      continue;
    }
    assets.add(path);
  }
  // Both extraction (above) and this site count run against noise-stripped code, so a call inside a
  // comment/string is ignored by both and the tallies stay consistent. Any real call whose arg wasn't
  // an extractable literal/api.param form landed short of `extracted` and surfaces here.
  const sites = stripped.match(CALL_SITE_RE)?.length ?? 0;
  if (sites > extracted) {
    violations.push(`api.texture/api.gltf/api.screen/api.layer arguments must be string literals or api.param("name") — kino resolves and caches assets before render`);
  }
  return { assets: [...assets], violations };
}

/** Height/width ratio of an SVG source (viewBox first, width/height attrs as fallback). */
export function svgAspect(svg: string): number {
  const vb = svg.match(/viewBox\s*=\s*["']\s*[\d.eE+-]+[\s,]+[\d.eE+-]+[\s,]+([\d.eE+-]+)[\s,]+([\d.eE+-]+)/);
  if (vb) {
    const w = Number(vb[1]), h = Number(vb[2]);
    if (w > 0 && h > 0) return h / w;
  }
  const wAttr = svg.match(/<svg[^>]*\swidth\s*=\s*["']([\d.]+)/);
  const hAttr = svg.match(/<svg[^>]*\sheight\s*=\s*["']([\d.]+)/);
  if (wAttr && hAttr && Number(wAttr[1]) > 0 && Number(hAttr[1]) > 0) return Number(hAttr[1]) / Number(wAttr[1]);
  throw new Error("svg needs a viewBox (or width/height attrs) so the layer plane can be sized");
}

/** Categorized raster refs for the pre-rasterize pass: .html screens and .svg layers. */
export function extractSceneRefs(
  src: string,
  params: Record<string, number | string>,
): { screens: string[]; layers: string[]; violations: string[] } {
  const violations: string[] = [];
  const screens = new Set<string>();
  const layers = new Set<string>();
  const stripped = stripJsNoise(src);
  for (const m of src.matchAll(CALL_RE)) {
    if (stripped.slice(m.index ?? 0, (m.index ?? 0) + 3) !== "api") continue;
    const call = m[1];
    if (call !== "screen" && call !== "layer") continue;
    const paramName = m[4] ?? m[5];
    let path: string | undefined = m[2] ?? m[3];
    if (paramName !== undefined) {
      const v = params[paramName];
      if (typeof v !== "string" || !v) continue; // extractSceneAssets already reports this
      path = v;
    }
    if (!path || badPath(path)) continue; // ditto
    if (call === "screen") {
      if (path.toLowerCase().endsWith(".html")) screens.add(path);
      // non-html screen = static texture passthrough, no raster needed
    } else {
      if (path.toLowerCase().endsWith(".svg")) layers.add(path);
      else violations.push(`api.layer("${path}") must reference an .svg asset`);
    }
  }
  return { screens: [...screens], layers: [...layers], violations };
}
