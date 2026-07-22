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

// api.texture("lit") | api.texture('lit') | api.texture(api.param("name")) — same for api.gltf.
const CALL_RE = /\bapi\s*\.\s*(?:texture|gltf)\s*\(\s*(?:"([^"]*)"|'([^']*)'|api\s*\.\s*param\s*\(\s*(?:"(\w+)"|'(\w+)')\s*\))/g;
const CALL_SITE_RE = /\bapi\s*\.\s*(?:texture|gltf)\s*\(/g;

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
  let extracted = 0;
  for (const m of src.matchAll(CALL_RE)) {
    extracted++;
    const literal = m[1] ?? m[2];
    const paramName = m[3] ?? m[4];
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
      violations.push(`empty asset path in api.texture/api.gltf`);
      continue;
    }
    if (badPath(path)) {
      violations.push(`asset path "${path}" must be a relative project asset path (no leading /, .., or URLs)`);
      continue;
    }
    assets.add(path);
  }
  // Call sites counted on noise-stripped code (comments/strings can't fake them); every real
  // call must have matched an extractable arg form above.
  const sites = stripJsNoise(src).match(CALL_SITE_RE)?.length ?? 0;
  if (sites > extracted) {
    violations.push(`api.texture/api.gltf arguments must be string literals or api.param("name") — kino resolves and caches assets before render`);
  }
  return { assets: [...assets], violations };
}
