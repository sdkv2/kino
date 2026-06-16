import { existsSync, readFileSync } from "node:fs";
import DOMPurify from "isomorphic-dompurify";
import type { MotionGraphicProps, BgKeyframe, BgTrigger, BgParamValue } from "./props.js";

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

// Robust strip of script/handlers/dangerous tags while keeping the agent's <style> + structural markup.
export function sanitizeMotionHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ["style"],
    FORBID_TAGS: ["script", "iframe", "object", "embed", "link", "meta", "base"],
    ALLOW_DATA_ATTR: true,
    FORCE_BODY: true,
  });
}

export interface MotionGraphicRefInput {
  source: string;
  params?: Record<string, BgParamValue>;
  keyframes?: BgKeyframe[];
  triggers?: BgTrigger[];
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
  const violations = lintMotionHtml(raw);
  if (violations.length) throw new Error(`Motion graphic assets/${ref.source}: ${violations.join("; ")}`);
  return {
    html: sanitizeMotionHtml(raw),
    params: ref.params ?? {},
    keyframes: ref.keyframes ?? [],
    triggers: ref.triggers ?? [],
  };
}
