// Raster image paths + inline SVG helpers shared by spec validation and build staging.

/** File extensions the compositor loads as a static image plate. */
export const RASTER_IMAGE_RE = /\.(png|jpe?g|webp|svg)$/i;

export function isRasterImagePath(src: string): boolean {
  return RASTER_IMAGE_RE.test(src);
}

const SCRIPT_TAG = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
const ON_ATTR = /\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URL = /\b(href|xlink:href)\s*=\s*("|')\s*javascript:/gi;

/** Strip obvious XSS vectors from author inline SVG. */
export function sanitizeInlineSvg(raw: string): string {
  let s = raw.trim();
  if (!s) throw new Error("inline svg is empty");
  s = s.replace(SCRIPT_TAG, "").replace(ON_ATTR, "").replace(JS_URL, "");
  return s;
}

/** Ensure a root <svg> with xmlns so Chromium can decode it as an image. */
export function prepareInlineSvg(raw: string): string {
  const s = sanitizeInlineSvg(raw);
  if (/^<svg[\s>]/i.test(s)) {
    if (!/xmlns\s*=/.test(s)) {
      return s.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    return s;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${s}</svg>`;
}

export function defaultInlineSvgRel(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "inline";
  return `generated/inline/${safe}.svg`;
}

export function validateInlineSvg(raw: string): string | null {
  try {
    prepareInlineSvg(raw);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
