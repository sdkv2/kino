import { existsSync, readFileSync } from "node:fs";
import type { MotionGraphicProps, BgKeyframe, BgTrigger, BgParamValue } from "./props.js";
import { resolveMotionSource } from "../media/motionLib.js";
import { sanitizeMotionHtml } from "./sanitizeMotion.js";
import { parseLottie, lintLottie, warnLottie } from "./lottie.js";
import { lintSceneJs, extractSceneAssets } from "./scene.js";

// Re-exported for back-compat (callers/tests import it from here).
export { sanitizeMotionHtml };

// Determinism + safety denylist. Each pattern → a message that tells the agent what to do instead.
// Motion comes from CSS variables or from @keyframes that kino force-pauses + scrubs (see the
// .kino-anim scrub injected by MotionGraphic). The render pauses ALL animations, so the only
// animation declaration that could break determinism — animation-play-state — is rejected here;
// CSS transition (no pause/scrub equivalent) is also rejected.
const BANNED: { re: RegExp; msg: string }[] = [
  { re: /<script[\s>]/i, msg: "<script> is not allowed — motion comes from CSS variables, not JS" },
  { re: /\son\w+\s*=/i, msg: "inline event handlers (on*=) are not allowed" },
  { re: /transition(-\w+)?\s*:/i, msg: "CSS transition is non-deterministic — drive motion from var(--progress)" },
  { re: /animation-play-state\s*:/i, msg: "animation-play-state is managed by kino — mark the element class=\"kino-anim\"; don't override the pause" },
  { re: /<(animate|animateTransform|animateMotion|set)[\s>]/i, msg: "SVG SMIL animation (<animate> etc.) is not allowed — drive motion from var(--progress)" },
  { re: /\b(requestAnimationFrame|setInterval|setTimeout)\b/i, msg: "timers/RAF are not allowed — motion is frame-driven by kino" },
  { re: /\b(Date\.now|Math\.random)\b/, msg: "Date.now/Math.random break determinism" },
  { re: /\bfetch\s*\(|\bXMLHttpRequest\b/i, msg: "network access is not allowed during render" },
  { re: /url\(\s*['"]?(?!data:|#)[^)\s'"]/i, msg: "url(...) must be a data: URI or #fragment — external/relative refs don't resolve" },
  { re: /@import\b/i, msg: "@import is not allowed — bundle all styles inline (no external CSS)" },
];

// Returns a list of human-readable violations (empty = clean). Pure; no DOMPurify needed.
export function lintMotionHtml(html: string): string[] {
  return BANNED.filter((b) => b.re.test(html)).map((b) => b.msg);
}

// Determinism + safety denylist for Tier-2 procedural sources (JS). The function must be a pure
// (env) → HTML string; anything time-based, networked, module-loading, or environment-touching is
// rejected. Globals are matched by access (process. / window.[) so the bare words can still appear
// in emitted string content.
const BANNED_JS: { re: RegExp; msg: string }[] = [
  { re: /\bMath\.random\b/, msg: "Math.random breaks determinism — derive variation from env.frame or an index" },
  { re: /\b(Date\.now|performance\.now)\b/, msg: "Date.now/performance.now break determinism — use env.t / env.frame" },
  { re: /\bnew\s+Date\b/, msg: "new Date breaks determinism — use env.t / env.frame" },
  { re: /\b(requestAnimationFrame|setTimeout|setInterval)\b/, msg: "timers/RAF aren't allowed — kino calls render(env) once per frame" },
  { re: /\b(fetch|XMLHttpRequest)\b/, msg: "network access isn't allowed during render" },
  { re: /\brequire\s*\(/, msg: "require() isn't allowed — render(env) must be self-contained" },
  { re: /\bimport\b\s*[('"\w{*]/, msg: "import isn't allowed — render(env) must be self-contained" },
  { re: /\bprocess\s*[.\[]/, msg: "process isn't available — render(env) runs in the browser, not Node" },
  { re: /\b(globalThis|window|document)\s*[.\[]/, msg: "globalThis/window/document aren't allowed — return an HTML string, don't touch the DOM" },
  { re: /\son\w+\s*=/i, msg: "inline event handlers (on*=) aren't allowed in generated markup" },
  // Dynamic code execution + obfuscation. Best-effort hardening against bracket-notation / runtime
  // string-building used to dodge the dotted Date.now/Math.random rules above (a denylist can't be
  // exhaustive — the per-frame output is also DOMPurify-sanitized, and a true sandbox is the real fix).
  { re: /\beval\s*\(/, msg: "eval() isn't allowed — render(env) must be a pure function of env" },
  { re: /\bFunction\s*\(/, msg: "the Function constructor isn't allowed — render(env) must be a pure function of env" },
  { re: /\b(atob|btoa)\s*\(/, msg: "atob/btoa aren't allowed — don't decode and execute strings at render time" },
  { re: /\b(Date|Math)\s*\[/, msg: "computed access to Date/Math isn't allowed — use dotted Math.* geometry and env.t / env.frame" },
  // ASI unary-plus trap: `return\n+ '<b'` or `…;\n+ '<b'` → NaN. Indent-continued
  // `return ''\n  + '<b'` is fine (expression still open). See speech-synced-ui.
  { re: /;\s*\n\s*\+\s*['"`]/, msg: "`;` then newline `+ '…'` is unary plus → NaN; keep one binary + chain or use out +=" },
  { re: /\breturn\s*\n\s*\+\s*['"`]/, msg: "`return` then newline `+ '…'` is ASI unary plus → NaN; put the first string on the return line" },
];

// Blank comments + string/template literal *contents* before scanning so banned access patterns that
// appear only in non-executable text aren't flagged (e.g. the filename "prompt-window.js" contains
// "window."). Real code in `${…}` template expressions is kept. Blanking (not deleting) preserves
// offsets and can't fuse two tokens into a spurious match. The `[^:]` guard keeps `http://` from
// being eaten as a line comment.
export function stripJsNoise(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  const pushBlank = (from: number, to: number) => {
    out += src.slice(from, to).replace(/[^\n]/g, " ");
  };
  while (i < n) {
    // Block comment
    if (src[i] === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const to = end < 0 ? n : end + 2;
      pushBlank(i, to);
      i = to;
      continue;
    }
    // Line comment (not part of `://`)
    if (src[i] === "/" && src[i + 1] === "/" && (i === 0 || src[i - 1] !== ":")) {
      const end = src.indexOf("\n", i);
      const to = end < 0 ? n : end;
      pushBlank(i, to);
      i = to;
      continue;
    }
    // Single- or double-quoted string
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i];
      out += q;
      i++;
      while (i < n) {
        if (src[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (src[i] === q) {
          out += q;
          i++;
          break;
        }
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }
    // Template literal — blank static parts, keep ${expr} for scanning
    if (src[i] === "`") {
      out += "`";
      i++;
      while (i < n) {
        if (src[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (src[i] === "`") {
          out += "`";
          i++;
          break;
        }
        if (src[i] === "$" && src[i + 1] === "{") {
          out += "${";
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            // Nested strings / templates inside ${} — recurse via nested strip is heavy;
            // motion procs rarely nest. Scan braces, still blank quoted spans inside.
            if (src[i] === '"' || src[i] === "'") {
              const q = src[i];
              out += q;
              i++;
              while (i < n) {
                if (src[i] === "\\") {
                  out += "  ";
                  i += 2;
                  continue;
                }
                if (src[i] === q) {
                  out += q;
                  i++;
                  break;
                }
                out += src[i] === "\n" ? "\n" : " ";
                i++;
              }
              continue;
            }
            if (src[i] === "`") {
              // Nested template inside ${} — blank its static parts too (one level is enough for procs).
              out += "`";
              i++;
              while (i < n && src[i] !== "`") {
                if (src[i] === "\\") {
                  out += "  ";
                  i += 2;
                  continue;
                }
                out += src[i] === "\n" ? "\n" : " ";
                i++;
              }
              if (i < n && src[i] === "`") {
                out += "`";
                i++;
              }
              continue;
            }
            if (src[i] === "{") depth++;
            else if (src[i] === "}") {
              depth--;
              if (depth === 0) {
                out += "}";
                i++;
                break;
              }
            }
            out += src[i];
            i++;
          }
          continue;
        }
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }
    out += src[i];
    i++;
  }
  return out;
}

// Returns a list of human-readable violations for a Tier-2 procedural (JS) source (empty = clean).
export function lintMotionJs(src: string): string[] {
  const code = stripJsNoise(src);
  return BANNED_JS.filter((b) => b.re.test(code)).map((b) => b.msg);
}

// Determinism/safety lint for a motion source, dispatched on the (lowercased) extension — the single
// source of truth shared by resolveMotionGraphic (which also needs the parsed result) and
// assertMotionGraphics (validation-only). Returns violations (empty = clean); a Lottie parse failure
// is surfaced as a violation rather than thrown, so callers format their own error. Keep the branch
// set in sync with resolveMotionGraphic if a new extension is added.
export function lintMotionSource(source: string, raw: string): string[] {
  const ext = source.toLowerCase();
  if (ext.endsWith(".scene.js")) return lintSceneJs(raw);
  if (ext.endsWith(".js")) return lintMotionJs(raw);
  if (ext.endsWith(".json")) {
    try {
      const { data } = parseLottie(raw);
      return lintLottie(data);
    } catch (err) {
      return [(err as Error).message];
    }
  }
  if (ext.endsWith(".html")) return lintMotionHtml(raw);
  return ["motion source must be .html, .js, .scene.js, or .json"];
}

export interface MotionGraphicRefInput {
  source: string;
  params?: Record<string, BgParamValue>;
  keyframes?: BgKeyframe[];
  triggers?: BgTrigger[];
  loop?: boolean;
}

// Read the agent's HTML file, reject on lint violations, sanitize, and attach the JSON-owned
// params/keyframes/triggers. `project` is narrowed to just the asset resolver for easy testing.
export function resolveMotionGraphic(
  ref: MotionGraphicRefInput,
  project: { assetPath(rel: string): string },
): MotionGraphicProps {
  const { abs, display, fileName } = resolveMotionSource(ref.source, project);
  const raw = readFileSync(abs, "utf8");
  const base = {
    params: ref.params ?? {},
    keyframes: ref.keyframes ?? [],
    triggers: ref.triggers ?? [],
    loop: ref.loop,
  };
  const ext = fileName.toLowerCase();
  if (ext.endsWith(".scene.js")) {
    // 3D scene: lint for determinism/safety, statically resolve asset refs, verify they exist
    // node-side (fail at build, not mid-render). Source is baked verbatim like Tier-2 proc.
    const violations = lintSceneJs(raw);
    const extracted = extractSceneAssets(raw, ref.params ?? {});
    violations.push(...extracted.violations);
    if (violations.length) throw new Error(`Motion graphic ${display}: ${violations.join("; ")}`);
    for (const rel of extracted.assets) {
      if (!existsSync(project.assetPath(rel))) throw new Error(`Motion graphic ${display}: missing scene asset assets/${rel}`);
    }
    return { html: "", scene: raw, sceneAssets: extracted.assets, ...base };
  }
  if (ext.endsWith(".js")) {
    // Tier 2: procedural source. Lint for determinism/safety; bake the JS verbatim (not sanitized —
    // it's code, not markup; its per-frame output is trusted like the custom-background draw fn).
    const violations = lintMotionJs(raw);
    if (violations.length) throw new Error(`Motion graphic ${display}: ${violations.join("; ")}`);
    return { html: "", proc: raw, ...base };
  }
  if (ext.endsWith(".json")) {
    // Tier 3: Lottie. Parse + validate + lint (throw), then warn (non-fatal).
    const { data } = parseLottie(raw); // throws friendly parse/shape/duration errors
    const violations = lintLottie(data);
    if (violations.length) throw new Error(`Motion graphic ${display}: ${violations.join("; ")}`);
    for (const w of warnLottie(data)) console.warn(`Motion graphic ${display}: ${w}`);
    return { html: "", lottie: data, ...base };
  }
  if (ext.endsWith(".html")) {
    const violations = lintMotionHtml(raw);
    if (violations.length) throw new Error(`Motion graphic ${display}: ${violations.join("; ")}`);
    return { html: sanitizeMotionHtml(raw), ...base };
  }
  throw new Error(`Motion graphic ${display}: motion source must be .html, .js, .scene.js, or .json`);
}
