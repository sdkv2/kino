import DOMPurify from "isomorphic-dompurify";

// Robust strip of script/handlers/dangerous tags while keeping the agent's <style> + structural markup.
// Lives in its own (fs-free) module so it can run BOTH node-side (resolveMotionGraphic, on the static
// .html) AND browser-side in the Remotion render (on per-frame procedural output, which is dynamic and
// can't be sanitized ahead of time). Deterministic: same input → same output.
export function sanitizeMotionHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ["style"],
    FORBID_TAGS: ["script", "iframe", "object", "embed", "link", "meta", "base"],
    ALLOW_DATA_ATTR: true,
    FORCE_BODY: true,
  });
}
