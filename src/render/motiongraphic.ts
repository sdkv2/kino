import { existsSync, readFileSync } from "node:fs";
import type { MotionGraphicProps, BgKeyframe, BgTrigger, BgParamValue } from "./props.js";
import { sanitizeMotionHtml } from "./sanitizeMotion.js";
import { parseLottie, lintLottie, warnLottie } from "./lottie.js";

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
];

// Strip JS comments before scanning so a banned token that appears only in a comment (e.g. the
// filename "prompt-window.png" contains "window.") isn't flagged — comments don't execute. The `[^:]`
// guard keeps `http://` and other `://` from being eaten as a line comment. Blanking (not deleting)
// preserves offsets and can't fuse two lines into a spurious match.
function stripJsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

// Returns a list of human-readable violations for a Tier-2 procedural (JS) source (empty = clean).
export function lintMotionJs(src: string): string[] {
  const code = stripJsComments(src);
  return BANNED_JS.filter((b) => b.re.test(code)).map((b) => b.msg);
}

// Determinism/safety lint for a motion source, dispatched on the (lowercased) extension — the single
// source of truth shared by resolveMotionGraphic (which also needs the parsed result) and
// assertMotionGraphics (validation-only). Returns violations (empty = clean); a Lottie parse failure
// is surfaced as a violation rather than thrown, so callers format their own error. Keep the branch
// set in sync with resolveMotionGraphic if a new extension is added.
export function lintMotionSource(source: string, raw: string): string[] {
  const ext = source.toLowerCase();
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
  return ["motion source must be .html, .js, or .json"];
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
  const abs = project.assetPath(ref.source);
  if (!existsSync(abs)) throw new Error(`Missing motion graphic file: assets/${ref.source}`);
  const raw = readFileSync(abs, "utf8");
  const base = {
    params: ref.params ?? {},
    keyframes: ref.keyframes ?? [],
    triggers: ref.triggers ?? [],
    loop: ref.loop,
  };
  const ext = ref.source.toLowerCase();
  if (ext.endsWith(".js")) {
    // Tier 2: procedural source. Lint for determinism/safety; bake the JS verbatim (not sanitized —
    // it's code, not markup; its per-frame output is trusted like the custom-background draw fn).
    const violations = lintMotionJs(raw);
    if (violations.length) throw new Error(`Motion graphic assets/${ref.source}: ${violations.join("; ")}`);
    return { html: "", proc: raw, ...base };
  }
  if (ext.endsWith(".json")) {
    // Tier 3: Lottie. Parse + validate + lint (throw), then warn (non-fatal).
    const { data } = parseLottie(raw); // throws friendly parse/shape/duration errors
    const violations = lintLottie(data);
    if (violations.length) throw new Error(`Motion graphic assets/${ref.source}: ${violations.join("; ")}`);
    for (const w of warnLottie(data)) console.warn(`Motion graphic assets/${ref.source}: ${w}`);
    return { html: "", lottie: data, ...base };
  }
  if (ext.endsWith(".html")) {
    const violations = lintMotionHtml(raw);
    if (violations.length) throw new Error(`Motion graphic assets/${ref.source}: ${violations.join("; ")}`);
    return { html: sanitizeMotionHtml(raw), ...base };
  }
  throw new Error(`Motion graphic assets/${ref.source}: motion source must be .html, .js, or .json`);
}
