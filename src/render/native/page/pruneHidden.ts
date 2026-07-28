// Strip image payloads that will never be painted, before the tree becomes a foreignObject.
//
// A motion layer rasterizes through <svg><foreignObject>, and an SVG-as-image is an ISOLATED
// document: Chromium decodes every image it references, whether or not that image is visible.
// `display:none` hides a subtree on screen and changes nothing about its decode cost. Measured on
// compositor-demo, nine thumbnails hidden for ~800 of 1094 frames were costing raster:decode
// 30.9 -> 17.6 ms/frame.
//
// A proc author can gate emission by hand, but procs are authored per-scene (increasingly by
// agents) and this is invisible without a profiler — so the engine does it instead, from the live
// host it already mounts to measure lenses.
//
// Safety rests on one property: an element with NO client rects is not rendered, so it paints
// nothing and (being out of flow, or having no box) contributes nothing to layout. Blanking its
// source is therefore invisible in the raster. Deliberately narrow:
//   • only HTML <img> and inline-style background-image — never a CSS-rule background, which would
//     need getComputedStyle on every node,
//   • never SVG: <defs> and friends compute to display:none by design, and stripping an feImage
//     href would silently break filter:url(#kino-…) glass,
//   • attributes only, never node removal, so nothing can shift.
//
// Runs after the manifest and scrubs are read (those need the intact tree) and before serialisation.

const XHTML = "http://www.w3.org/1999/xhtml";
const BG_URL = /background-image\s*:\s*url\([^)]*\)\s*;?/gi;

/** True when the element produces no boxes — display:none itself, or inside such a subtree. */
function unrendered(el: Element): boolean {
  return el.getClientRects().length === 0;
}

/**
 * Blank sources on unrendered imagery. Returns how many were stripped, for the profile counter —
 * a proc that reports a high count every frame is carrying payload it never shows.
 */
export function stripUnrenderedImagery(texRoot: HTMLElement): number {
  let stripped = 0;

  for (const img of Array.from(texRoot.querySelectorAll("img"))) {
    if (img.namespaceURI !== XHTML) continue;
    if (!img.getAttribute("src")) continue;
    if (!unrendered(img)) continue;
    // Keep the element and its box-defining attributes; drop only the bytes.
    img.removeAttribute("src");
    img.removeAttribute("srcset");
    stripped++;
  }

  // Inline background-image is the other common payload carrier (thumbnail tiles, poster frames).
  for (const el of Array.from(texRoot.querySelectorAll("[style*='background-image']"))) {
    if (el.namespaceURI !== XHTML) continue;
    const style = el.getAttribute("style");
    if (!style || !BG_URL.test(style)) {
      BG_URL.lastIndex = 0;
      continue;
    }
    BG_URL.lastIndex = 0;
    if (!unrendered(el)) continue;
    const next = style.replace(BG_URL, "");
    if (next !== style) {
      el.setAttribute("style", next);
      stripped++;
    }
  }

  return stripped;
}
