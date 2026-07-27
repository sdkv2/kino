// Spike: per-frame lens × DOM-content intersection for Route C geometry probe.
import { LENS_SELECTOR } from "../../lensContract.js";
import * as prof from "./compositor/profile.js";
import { paintsAbove, collectForegroundRoots, cssSelectorFor } from "./lensPaintOrder.js";
import { lensPageRect, type LensPageRect } from "./lensMirror.js";
import { QUAD_SELECTOR } from "./underlay.js";

type Rect = { left: number; top: number; right: number; bottom: number; w: number; h: number };
type Host = { texRoot: HTMLElement; stack: HTMLElement[] };

function toRect(pr: LensPageRect): Rect {
  return {
    left: pr.relLeft,
    top: pr.relTop,
    right: pr.relLeft + pr.w,
    bottom: pr.relTop + pr.h,
    w: pr.w,
    h: pr.h,
  };
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return w * h;
}

function lensLabel(el: HTMLElement): string {
  if (el.classList.contains("menubar")) return "menubar";
  if (el.classList.contains("dock-wrap")) return "dock";
  const cls = [...el.classList].filter((c) => c !== "kino-lens").join(".") || el.tagName.toLowerCase();
  return cls.slice(0, 24);
}

function contentLabel(el: HTMLElement): string {
  if (el.classList.contains("chrome-win")) return "chrome";
  if (el.classList.contains("cursor-layer") || el.classList.contains("cursor")) return "cursor";
  if (el.classList.contains("rgb-split")) return "rgb-split";
  if (el.classList.contains("panic")) return "panic";
  const own = [...el.classList].slice(0, 2).join(".") || el.tagName.toLowerCase();
  return own.slice(0, 24);
}

function isHoisted(el: HTMLElement): boolean {
  return el.classList.contains("kino-underlay") || el.classList.contains("kino-quad") || !!el.closest(QUAD_SELECTOR);
}

function visiblePaint(el: HTMLElement): boolean {
  const cs = getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden") return false;
  const op = parseFloat(cs.opacity);
  if (Number.isFinite(op) && op < 0.01) return false;
  return true;
}

let loggedFg = false;
const firstHit = new Map<string, number>();
const lastHit = new Map<string, number>();

/** Measure lens × below-lens DOM content overlaps; piggybacks KINO_PROFILE counters. */
export function probeLensGeometry(host: Host, vars: Record<string, string>): void {
  if (!prof.profileOn()) return;

  const t = parseFloat(vars["--t"] ?? "0");
  const tSec = Number.isFinite(t) ? t : 0;
  const bucket = Math.floor(tSec);
  const hostRect = host.texRoot.getBoundingClientRect();

  prof.addSample("geom:frames", 1);
  if (!host.stack.length) {
    prof.addSample("geom:no-lens-stack", 1);
    return;
  }

  // Confirm foreground plate membership once (rgb-split / panic / cursor should land here).
  if (!loggedFg) {
    loggedFg = true;
    const fg = collectForegroundRoots(host.texRoot, host.stack);
    for (const el of fg) {
      const sel = cssSelectorFor(el, host.texRoot);
      console.log(JSON.stringify({ geom: "foreground-root", sel, classes: [...el.classList] }));
      prof.addSample(`geom:fg:${contentLabel(el)}`, 1);
    }
  }

  // Named content we care about + any other below-lens paint roots.
  const named = Array.from(host.texRoot.querySelectorAll<HTMLElement>(".chrome-win, .rgb-split, .panic, .cursor-layer"));
  const candidates = new Map<string, { el: HTMLElement; rect: Rect }>();

  for (const el of named) {
    if (el.matches(LENS_SELECTOR) || el.closest(LENS_SELECTOR)) continue;
    if (isHoisted(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 0.5 || r.height < 0.5) {
      // panic / hidden chrome — still record zero-rect presence
      if (el.classList.contains("chrome-win") || el.classList.contains("panic")) {
        candidates.set(contentLabel(el), {
          el,
          rect: { left: 0, top: 0, right: 0, bottom: 0, w: 0, h: 0 },
        });
      }
      continue;
    }
    candidates.set(contentLabel(el), {
      el,
      rect: {
        left: r.left - hostRect.left,
        top: r.top - hostRect.top,
        right: r.right - hostRect.left,
        bottom: r.bottom - hostRect.top,
        w: r.width,
        h: r.height,
      },
    });
  }

  for (const lens of host.stack) {
    const label = lensLabel(lens);
    const page = lensPageRect(lens, hostRect);
    const lensR = toRect(page);
    const lensArea = lensR.w * lensR.h;
    const lensGone = lensArea < 0.5 || getComputedStyle(lens).display === "none";

    prof.addSample(`geom:${label}:area`, lensArea);
    prof.addSample(`geom:${label}:alive`, lensGone ? 0 : 1);
    if (lensGone) {
      prof.addSample(`geom:${label}:hidden`, 1);
      continue;
    }

    for (const [cLabel, cand] of candidates) {
      const pair = `${label}-x-${cLabel}`;
      const above = paintsAbove(cand.el, lens);
      const visible = visiblePaint(cand.el);
      // Content that paints ABOVE the lens is foreground plate — not refracted.
      const refractable = !above && visible && cand.rect.w >= 0.5 && cand.rect.h >= 0.5;
      const area = refractable ? overlapArea(lensR, cand.rect) : 0;
      const hit = area > 0.5;

      prof.addSample(`geom:${pair}`, area);
      prof.addSample(`geom:${pair}-frames`, hit ? 1 : 0);
      if (area > 0) prof.noteMax(`geom:${pair}-max`, area);

      // Also record ABOVE-lens intersections so we can prove rgb-split/panic exclusion.
      if (above && visible) {
        const aboveArea = overlapArea(lensR, cand.rect);
        if (aboveArea > 0.5) {
          prof.addSample(`geom:${pair}-ABOVE`, aboveArea);
          prof.addSample(`geom:${pair}-ABOVE-frames`, 1);
        }
      }

      if (hit) {
        if (!firstHit.has(pair)) {
          firstHit.set(pair, tSec);
          prof.noteHold(`geom:${pair}-firstMs`, Math.round(tSec * 1000));
        }
        lastHit.set(pair, tSec);
        prof.noteHold(`geom:${pair}-lastMs`, Math.round(tSec * 1000));
        prof.addSample(`geom:${pair}:t${bucket}`, area);
        console.log(
          JSON.stringify({
            geom: "overlap",
            pair,
            t: +tSec.toFixed(3),
            area: Math.round(area),
            lens: { x: +lensR.left.toFixed(1), y: +lensR.top.toFixed(1), w: +lensR.w.toFixed(1), h: +lensR.h.toFixed(1) },
            content: {
              x: +cand.rect.left.toFixed(1),
              y: +cand.rect.top.toFixed(1),
              w: +cand.rect.w.toFixed(1),
              h: +cand.rect.h.toFixed(1),
            },
          }),
        );
      }
    }
  }
}
