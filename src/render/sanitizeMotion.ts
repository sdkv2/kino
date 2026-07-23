import DOMPurify from "isomorphic-dompurify";

// Robust strip of script/handlers/dangerous tags while keeping the agent's <style> + structural markup.
// Lives in its own (fs-free) module so it can run BOTH node-side (resolveMotionGraphic, on the static
// .html) AND browser-side in the render page (on per-frame procedural output, which is dynamic and
// can't be sanitized ahead of time). Deterministic: same input → same output.
export function sanitizeMotionHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ["style"],
    // Keep href on SVG filter primitives (feImage) — DOMPurify would otherwise drop it.
    ADD_ATTR: ["href"],
    FORBID_TAGS: ["script", "iframe", "object", "embed", "link", "meta", "base"],
    ALLOW_DATA_ATTR: true,
    // Default safe-scheme allowlist PLUS self-contained data:image/ URIs — needed for an feImage
    // displacement map (real liquid-glass refraction) baked as data:image/svg+xml. An image/feImage
    // context rasterizes, never executes script, so this stays safe; still blocks javascript: and
    // data:text/html. (Motion sources are trusted local config that already passed the determinism lint.)
    ALLOWED_URI_REGEXP:
      /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp):|data:image\/|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    FORCE_BODY: true,
  });
}
