// Per-element velocity for Tier-1 motion HTML: `data-kino-vel` on an element makes the engine measure
// how far THAT element travels this frame and hand it back as CSS custom properties on the element.
//
//   <span class="letter" data-kino-vel>S</span>
//   .letter { filter: blur(calc(var(--kino-vel-y) * 0.4px)) }
//
// Why it has to be the engine: `--cam-blur` and the automatic layer motion blur both describe a whole
// surface moving, and neither can smear eight letters independently inside one motion page. CSS has no
// way to read an element's own displacement, so a 37-beat review produced stacked `linear-gradient`
// bars standing in for a per-glyph smear — which read as a bar parked beside the glyph rather than the
// glyph's own drag. Its report named the right primitive and said it could not reach it.
//
// SEEK INDEPENDENCE — the constraint that shapes this file. kino renders frame N by seeking to it;
// frames are farmed across Electron workers and served out of a persistent frame cache, so frame N-1
// may never have been rendered in this process. Remembering the previous frame's measurement would
// make the output depend on render order, which is both non-deterministic and cache-poisoning. So the
// reference measurement is not a memory: it is re-derived inside frame N's own render by driving the
// same markup with frame N-1's variables (velocityProbe.ts). Both variable sets come from `paramsAt`,
// a pure function of the frame index, so the answer is identical for any seek order.
//
// This module is the DOM-free half: which elements opted in, and the arithmetic + markup rewrite. The
// measuring lives page-side because only a layout engine can say where a CSS-driven element ended up.

/** Opt-in marker. Valueless as authored; the engine rewrites it to carry the element's index. */
export const VEL_ATTR = "data-kino-vel";

/** Below this much travel (composition px per frame) the element is treated as parked.
 *  Sub-pixel drift is invisible as a smear but would still write non-zero variables into the markup
 *  of an otherwise static beat, so clamping it to exactly zero is what keeps a still page's bytes
 *  stable — and it means "the smear appears only while the element moves" is literally true. */
export const VEL_EPSILON = 0.01;

/** Cheap gate: a page with no opted-in element pays for no measurement pass at all. */
export function hasVelocityTargets(html: string): boolean {
  return html.includes(VEL_ATTR);
}

// `(?![\w-])` keeps this off a longer attribute that merely starts the same way.
const VEL_ATTR_RE = new RegExp(`(?<=^|\\s)${VEL_ATTR}(?![\\w-])(\\s*=\\s*(?:"[^"]*"|'[^']*'))?`, "g");

/**
 * Stamp each opted-in element with its index, in source order, so the page-side measurement can key
 * boxes to elements without relying on `querySelectorAll` order lining up with the string scan.
 * Idempotent in effect (an already-numbered attribute is renumbered to the same value).
 */
export function annotateVelocityTargets(html: string): { html: string; count: number } {
  let count = 0;
  const out = html.replace(VEL_ATTR_RE, () => `${VEL_ATTR}="${count++}"`);
  return { html: out, count };
}

/** Element box in composition px, relative to the motion page's own origin. */
export interface VelBox {
  cx: number;
  cy: number;
}

const r3 = (v: number): string => {
  const n = Math.round(v * 1e3) / 1e3;
  return Object.is(n, -0) ? "0" : String(n);
};

/**
 * The custom properties for one element, given where it sits on this frame and on the reference
 * frame. `forward` flips the sign for frame 0, where the reference is frame 1 rather than frame -1 —
 * the same lookahead `cameraBlurVars` uses so an opening frame is not silently velocity-free.
 *
 * Units are composition px per FRAME, which is what a smear wants: the distance travelled while the
 * shutter is open. `-x`/`-y` are unsigned speeds (safe inside `blur()`, where a negative length
 * invalidates the whole declaration — the exact way effects went invisible in the review this came
 * from), matching the existing unsigned `--cam-vel`. Signed direction is `-dx`/`-dy`.
 */
export function velocityVarDecls(cur: VelBox | undefined, ref: VelBox | undefined, forward: boolean): string {
  const sign = forward ? -1 : 1;
  let dx = cur && ref ? (cur.cx - ref.cx) * sign : 0;
  let dy = cur && ref ? (cur.cy - ref.cy) * sign : 0;
  let mag = Math.hypot(dx, dy);
  if (!Number.isFinite(mag) || mag < VEL_EPSILON) {
    dx = 0;
    dy = 0;
    mag = 0;
  }
  const angle = mag === 0 ? 0 : (Math.atan2(dy, dx) * 180) / Math.PI;
  return (
    `--kino-vel:${r3(mag)};` +
    `--kino-vel-x:${r3(Math.abs(dx))};--kino-vel-y:${r3(Math.abs(dy))};` +
    `--kino-vel-dx:${r3(dx)};--kino-vel-dy:${r3(dy)};` +
    `--kino-vel-angle:${r3(angle)}deg`
  );
}

/** Every velocity property, all zero — the resting values published on the page root so an author's
 *  `var(--kino-vel-y)` is never an undefined variable (which would invalidate its whole declaration
 *  and take the element's paint with it) on an element that never opted in. */
export function velocityRestVars(): Record<string, string> {
  return {
    "--kino-vel": "0",
    "--kino-vel-x": "0",
    "--kino-vel-y": "0",
    "--kino-vel-dx": "0",
    "--kino-vel-dy": "0",
    "--kino-vel-angle": "0deg",
  };
}

const TAG_RE = /<([a-zA-Z][\w:.-]*)((?:'[^']*'|"[^"]*"|[^>'"])*)(\/?)>/g;
const STYLE_ATTR_RE = /(^|\s)style\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

/**
 * Write each element's measured properties into its own `style` attribute, keyed by the index
 * annotateVelocityTargets stamped on it.
 *
 * An inline style rather than a generated stylesheet rule on purpose: the values then travel WITH the
 * markup, so every surface that consumes it — the foreignObject raster, the live lens-layout host,
 * the serialised XHTML — sees the same numbers without threading an extra CSS channel through five
 * signatures. (It also wins the cascade against an author's own `--kino-vel` declaration, which is
 * what you want: theirs would be a stale placeholder.)
 */
export function writeVelocityVars(html: string, decls: (string | undefined)[]): string {
  return html.replace(TAG_RE, (whole, tag: string, attrs: string, slash: string) => {
    const idx = new RegExp(`(?:^|\\s)${VEL_ATTR}\\s*=\\s*"(\\d+)"`).exec(attrs);
    if (!idx) return whole;
    const decl = decls[Number(idx[1])];
    if (!decl) return whole;
    const style = STYLE_ATTR_RE.exec(attrs);
    if (!style) return `<${tag}${attrs} style="${decl}"${slash}>`;
    const existing = (style[2] ?? style[3] ?? "").trim().replace(/;$/, "");
    const merged = existing ? `${existing};${decl}` : decl;
    return `<${tag}${attrs.replace(STYLE_ATTR_RE, `$1style="${merged}"`)}${slash}>`;
  });
}
