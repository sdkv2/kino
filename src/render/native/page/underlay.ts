// Static underlay plates — screen-space-fixed imagery hoisted OUT of the per-frame foreignObject.
//
// A full-frame photographic backplate (desktop wallpaper, studio backdrop) that never moves in
// screen space still costs a full resample into the FO raster on EVERY plate of EVERY frame:
// four 3840×2160 resamples per frame, ~1200 frames, of pixels that are byte-identical throughout.
// Measured on the macos-desktop-youtube beat that was ~55ms of a ~160ms/frame capture wall.
//
// The contract mirrors `kino-lens`: a marker element the pipeline recognizes straight from the
// markup, so a proc opts in without touching the spec surface.
//
//   <div class="kino-underlay" data-src="/public/motion/wallpaper.jpg"></div>
//
// The element is stripped before inlining (so its bytes never reach the FO at all), the image is
// decoded and uploaded ONCE per src, and the texture is composited beneath the motion plates.
// It lands under `sample` too, so `kino-lens` refracts it exactly as it did when it was painted
// into the raster — see lensCompositeNode.mergeBackdropWithBase.
//
// The image is stretched src-rect → layer-rect (no `cover` fit), so the asset must already be
// authored at the composition's aspect ratio. A mismatched aspect distorts rather than crops.
import { loadImage, uploadCanvasOrImage } from "./compositor/providers/upload.js";

/** Marker element carrying the underlay source. Matched before inlining, then stripped. */
const UNDERLAY_RE = /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bkino-underlay\b[^"']*["'][^>]*>\s*<\/div>/i;
const UNDERLAY_SRC_RE = /\bdata-src\s*=\s*["']([^"']+)["']/i;

export function motionHasUnderlay(html: string): boolean {
  return UNDERLAY_RE.test(html);
}

/** Pull the underlay src out and remove the marker so the asset never reaches the FO raster. */
export function extractUnderlay(html: string): { html: string; src: string | null } {
  const m = html.match(UNDERLAY_RE);
  if (!m) return { html, src: null };
  const src = m[0].match(UNDERLAY_SRC_RE)?.[1]?.trim() ?? null;
  return { html: html.replace(m[0], ""), src: src && src.length > 0 ? src : null };
}

export interface UnderlayPlate {
  img: HTMLImageElement;
  texture(gl: WebGL2RenderingContext): WebGLTexture | null;
}

// Decoded once per src for the whole render — the point of the exercise. Keyed by src so two
// motion layers sharing a backplate share the decode and the upload.
const plates = new Map<string, UnderlayPlate>();
const pending = new Map<string, Promise<UnderlayPlate | null>>();

export async function loadUnderlay(src: string): Promise<UnderlayPlate | null> {
  const hit = plates.get(src);
  if (hit) return hit;
  const inflight = pending.get(src);
  if (inflight) return await inflight;

  const task = (async () => {
    try {
      const img = await loadImage(src);
      if (!img) return null;
      let tex: WebGLTexture | null = null;
      // The texture is cached per src, NOT per GL context. Every compositor layer in a render
      // shares one context (renderer.ts owns it); a context loss tears the page down anyway.
      const plate: UnderlayPlate = {
        img,
        texture(gl) {
          if (!tex) tex = uploadCanvasOrImage(gl, null, img);
          return tex;
        },
      };
      plates.set(src, plate);
      return plate;
    } catch {
      // Missing backplate degrades to "not drawn", same as a broken <img> in the raster.
      return null;
    } finally {
      pending.delete(src);
    }
  })();
  pending.set(src, task);
  return await task;
}

/** Page reuse across render calls must not hand back textures from a dead GL context. */
export function clearUnderlays(): void {
  plates.clear();
  pending.clear();
}

// ---------------------------------------------------------------------------
// Hoisted quads — the underlay idea for imagery that MOVES.
//
// A sprite sheet or thumbnail inside a window that pans and scales can't be a static full-frame
// plate, but it is still the same never-changing bitmap. So instead of stripping the element, we
// leave it in the tree (it has to lay out, so we can measure it), paint nothing into the raster,
// and blit the bitmap at the measured rect on the GPU.
//
//   <div class="spr kino-quad" data-src="/public/motion/sheet.jpg" data-cell="3,1,12,6"></div>
//
// `data-cell` is "col,row,cols,rows" — a sprite-sheet selection. That is exactly a source rect,
// which blitTexture already takes, so a sheet costs one upload for the whole render instead of a
// full re-decode of every cell on every plate of every frame.
//
// Quads composite BETWEEN the underlay and the plates: the proc leaves a transparent hole where
// the image was, so anything painting over it (video gradients, controls, chrome) still lands on
// top from the plate itself and z-order is preserved.
export const QUAD_SELECTOR = ".kino-quad";

export interface HoistedQuad {
  src: string;
  /** Composition-px rect relative to the tex root — scaled to layer px at composite time. */
  relLeft: number;
  relTop: number;
  w: number;
  h: number;
  cell?: { col: number; row: number; cols: number; rows: number };
}

function parseCell(raw: string | null): HoistedQuad["cell"] {
  if (!raw) return undefined;
  const n = raw.split(",").map((v) => Number(v.trim()));
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v))) return undefined;
  const [col, row, cols, rows] = n as [number, number, number, number];
  if (cols < 1 || rows < 1) return undefined;
  return { col, row, cols, rows };
}

export function measureHoistedQuads(texRoot: HTMLElement, hostRect: DOMRect): HoistedQuad[] {
  const out: HoistedQuad[] = [];
  for (const el of Array.from(texRoot.querySelectorAll<HTMLElement>(QUAD_SELECTOR))) {
    const src = el.getAttribute("data-src")?.trim();
    if (!src) continue;
    const r = el.getBoundingClientRect();
    // A collapsed or display:none quad measures 0 — skip rather than blit a degenerate rect.
    if (r.width < 1 || r.height < 1) continue;
    out.push({
      src,
      relLeft: r.left - hostRect.left,
      relTop: r.top - hostRect.top,
      w: r.width,
      h: r.height,
      cell: parseCell(el.getAttribute("data-cell")),
    });
  }
  return out;
}
