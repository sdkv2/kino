// An SVG rasterized as an image runs in a restricted mode: it cannot fetch external
// resources. An <img src="/public/shot.png"> inside motion HTML therefore vanishes from a
// foreignObject raster, silently and with no error. Fonts already dodge this by being
// inlined (bgTextures.fontFaceCss); everything else has to be inlined here.
//
// data: URLs already survive, and in-document fragment references (filter:url(#kino-glow))
// resolve inside the SVG itself — neither is rewritten.

const IMG_SRC = /(<img\b[^>]*?\bsrc\s*=\s*["'])([^"']+)(["'])/gi;
const CSS_URL = /(url\(\s*["']?)([^"')]+)(["']?\s*\))/gi;

function isExternal(ref: string): boolean {
  const r = ref.trim();
  return r.length > 0 && !r.startsWith("data:") && !r.startsWith("#");
}

export function findExternalRefs(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(IMG_SRC)) if (isExternal(m[2])) found.add(m[2].trim());
  for (const m of html.matchAll(CSS_URL)) if (isExternal(m[2])) found.add(m[2].trim());
  return [...found];
}

/**
 * Rewrite every external reference to a data URL. A reference that cannot be fetched is left
 * as-is: it will not render inside the raster, but neither will it break the surrounding
 * markup — the same degradation the DOM path shows for a broken <img>.
 */
export async function inlineExternalRefs(
  html: string,
  fetchAsDataUrl: (url: string) => Promise<string | null>,
): Promise<string> {
  const refs = findExternalRefs(html);
  if (!refs.length) return html;

  const resolved = new Map<string, string>();
  await Promise.all(
    refs.map(async (ref) => {
      const dataUrl = await fetchAsDataUrl(ref);
      if (dataUrl) resolved.set(ref, dataUrl);
    }),
  );

  const swap = (_m: string, pre: string, ref: string, post: string) => {
    const hit = resolved.get(ref.trim());
    return hit ? `${pre}${hit}${post}` : `${pre}${ref}${post}`;
  };
  return html.replace(IMG_SRC, swap).replace(CSS_URL, swap);
}

/** Fetch a same-origin asset as a data URL. Returns null on any failure. */
export async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
