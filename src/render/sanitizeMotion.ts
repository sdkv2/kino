import DOMPurify from "isomorphic-dompurify";

const GLASS_SHAPE_SVG =
  /<svg\b[^>]*\bkino-lens-shape\b[^>]*>[\s\S]*?<\/svg>/gi;

// ponytail: stash/restore round-trip — only SMIL inside `.kino-lens-shape` bypasses DOMPurify
// (global `<animate>` stays forbidden elsewhere).
function stashGlassShapeSmil(html: string): { html: string; blocks: string[] } {
  const blocks: string[] = [];
  const stripped = html.replace(GLASS_SHAPE_SVG, (block) => {
    blocks.push(block);
    return `<svg class="kino-lens-shape" data-kino-smil-stash="${blocks.length - 1}"></svg>`;
  });
  return { html: stripped, blocks };
}

function restoreGlassShapeSmil(html: string, blocks: string[]): string {
  return html.replace(
    /<svg class="kino-lens-shape" data-kino-smil-stash="(\d+)"><\/svg>/gi,
    (_, i) => blocks[Number(i)] ?? "",
  );
}

// Robust strip of script/handlers/dangerous tags while keeping the agent's <style> + structural markup.
// Lives in its own (fs-free) module so it can run BOTH node-side (resolveMotionGraphic, on the static
// .html) AND browser-side in the render page (on per-frame procedural output, which is dynamic and
// can't be sanitized ahead of time). Deterministic: same input → same output.
export function sanitizeMotionHtml(html: string): string {
  const { html: stripped, blocks } = stashGlassShapeSmil(html);
  const clean = DOMPurify.sanitize(stripped, {
    // `use` is dropped by DOMPurify's default profile, which silently empties any layer built on it —
    // an author who factors a shape set into <defs> and instances it three times gets three blank
    // groups and no diagnostic. It is inert markup: a same-document reference that paints an existing
    // node. Only #fragment / %23 targets survive the url() rule in the determinism lint, and the
    // ALLOWED_URI_REGEXP below already blocks javascript: and data:text/html on `href`, so an
    // instanced node cannot reach anything the original could not.
    ADD_TAGS: ["style", "use"],
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
  return restoreGlassShapeSmil(clean, blocks);
}
