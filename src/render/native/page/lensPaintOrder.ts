// Paint-order split for lens compositing: backdrop (sample) vs foreground above the lens stack.
import { LENS_SELECTOR } from "../../lensContract.js";
import { TEX_ROOT } from "./bgTextures.js";

const XHTML = "http://www.w3.org/1999/xhtml";

/** Marker classes serialized into the FO template; one short scrub rule per plate. */
export const NOLAYOUT_CLASS = {
  sample: "kino-nolayout-s",
  chrome: "kino-nolayout-c",
  foreground: "kino-nolayout-f",
} as const;

export const NOLAYOUT_SCRUB = {
  sample: `.${NOLAYOUT_CLASS.sample}{display:none!important}`,
  chrome: `.${NOLAYOUT_CLASS.chrome}{display:none!important}`,
  foreground: `.${NOLAYOUT_CLASS.foreground}{display:none!important}`,
} as const;

function lensZ(el: Element): number {
  const z = parseInt(getComputedStyle(el).zIndex, 10);
  return Number.isFinite(z) ? z : 0;
}

/** True when `el` paints above `ref` (z-index, then DOM order). */
export function paintsAbove(el: Element, ref: Element): boolean {
  const dz = lensZ(el) - lensZ(ref);
  if (dz !== 0) return dz > 0;
  return !!(ref.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/** Non-lens elements that stack above the topmost `kino-lens` — must not be glass-sampled. */
export function collectForegroundRoots(texRoot: HTMLElement, lensStack: HTMLElement[]): HTMLElement[] {
  if (!lensStack.length) return [];
  const topLens = lensStack[lensStack.length - 1]!;
  const found: HTMLElement[] = [];

  const walk = (el: Element) => {
    if (el.matches(LENS_SELECTOR)) return;
    if (el.closest(LENS_SELECTOR)) return;
    if (el === texRoot) {
      for (const c of el.children) walk(c);
      return;
    }
    const he = el as HTMLElement;
    if (paintsAbove(he, topLens)) found.push(he);
    for (const c of el.children) walk(c);
  };
  walk(texRoot);

  return found.filter((el) => !found.some((other) => other !== el && other.contains(el)));
}

export function cssSelectorFor(el: HTMLElement, texRoot: HTMLElement): string {
  const root = `.${TEX_ROOT}`;
  if (el.id) return `${root} #${CSS.escape(el.id)}`;
  const own = [...el.classList].filter((c) => c !== TEX_ROOT);
  if (own.length) {
    const sel = `${root} .${own.join(".")}`;
    if (texRoot.querySelectorAll(sel).length === 1) return sel;
  }
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== texRoot) {
    // Annotated, not inferred: `cur = parent` below feeds this initializer's own type back
    // through `cur`, and TS reports the cycle as an implicit-any (TS7022).
    const parent: HTMLElement | null = cur.parentElement;
    if (!parent) break;
    const i = Array.from(parent.children).indexOf(cur) + 1;
    const tag = cur.tagName.toLowerCase();
    parts.unshift(`${tag}:nth-child(${i})`);
    cur = parent;
  }
  return `${root} ${parts.join(" > ")}`;
}

/** HTML only — never tag SVG (defs, filters, gradients). */
export function isHtmlElement(el: Element): boolean {
  return el.namespaceURI === XHTML;
}

export function isInsideLens(el: Element): boolean {
  return !!el.closest(LENS_SELECTOR);
}

/** `position:absolute` / `fixed` — safe to `display:none` without shifting in-flow siblings. */
export function isOutOfFlow(el: HTMLElement): boolean {
  const pos = getComputedStyle(el).position;
  return pos === "absolute" || pos === "fixed";
}

/** True when `el` or any descendant must paint for this plate. */
export function subtreeHasVisible(el: Element, isVisible: (el: Element) => boolean): boolean {
  if (isVisible(el)) return true;
  for (const child of el.children) {
    if (subtreeHasVisible(child, isVisible)) return true;
  }
  return false;
}

function parentIsHiddenOofRoot(
  el: HTMLElement,
  texRoot: HTMLElement,
  isVisible: (el: Element) => boolean,
): boolean {
  const parent = el.parentElement;
  if (!parent || parent === texRoot || !isHtmlElement(parent)) return false;
  const hp = parent as HTMLElement;
  return isOutOfFlow(hp) && !subtreeHasVisible(hp, isVisible);
}

/**
 * Out-of-flow HTML subtree root that is entirely hidden for this plate — safe to `display:none`.
 * Keeps the topmost out-of-flow ancestor in each hidden chain so one rule skips the whole subtree.
 */
export function isSafeNoLayoutRoot(
  el: HTMLElement,
  texRoot: HTMLElement,
  isVisible: (el: Element) => boolean,
): boolean {
  if (!isHtmlElement(el)) return false;
  if (!isOutOfFlow(el)) return false;
  if (subtreeHasVisible(el, isVisible)) return false;
  if (parentIsHiddenOofRoot(el, texRoot, isVisible)) return false;
  return true;
}

function walkHtml(texRoot: HTMLElement, fn: (el: HTMLElement) => void): void {
  const walk = (el: Element) => {
    if (isHtmlElement(el)) fn(el as HTMLElement);
    for (const c of el.children) walk(c);
  };
  for (const c of texRoot.children) walk(c);
}

export function collectNoLayoutRoots(
  texRoot: HTMLElement,
  isVisible: (el: Element) => boolean,
): HTMLElement[] {
  const roots: HTMLElement[] = [];
  walkHtml(texRoot, (el) => {
    if (isSafeNoLayoutRoot(el, texRoot, isVisible)) roots.push(el);
  });
  return roots;
}

export function tagNoLayoutRoots(roots: HTMLElement[], className: string): number {
  for (const el of roots) el.classList.add(className);
  return roots.length;
}

export interface LensPlateScrubs {
  sampleExtra: string;
  foregroundScrub: string;
  hasForeground: boolean;
  sampleNoLayout: string;
  chromeNoLayout: string;
  foregroundNoLayout: string;
  noLayoutCounts: { sample: number; chrome: number; foreground: number };
}

export function buildLensPlateScrubs(texRoot: HTMLElement, lensStack: HTMLElement[]): LensPlateScrubs {
  const fgRoots = collectForegroundRoots(texRoot, lensStack);

  const isVisibleSample = (el: Element) =>
    !isInsideLens(el) && !fgRoots.some((r) => r === el || r.contains(el));
  const isVisibleChrome = (el: Element) => isInsideLens(el);
  const isVisibleForeground = (el: Element) => fgRoots.some((r) => r === el || r.contains(el));

  const sampleRoots = collectNoLayoutRoots(texRoot, isVisibleSample);
  const chromeRoots = collectNoLayoutRoots(texRoot, isVisibleChrome);
  const foregroundRoots = fgRoots.length ? collectNoLayoutRoots(texRoot, isVisibleForeground) : [];

  tagNoLayoutRoots(sampleRoots, NOLAYOUT_CLASS.sample);
  tagNoLayoutRoots(chromeRoots, NOLAYOUT_CLASS.chrome);
  tagNoLayoutRoots(foregroundRoots, NOLAYOUT_CLASS.foreground);

  const selectors = fgRoots.map((el) => cssSelectorFor(el, texRoot)).join(",");
  const visibility =
    fgRoots.length > 0
      ? {
          sampleExtra: `${selectors},${selectors} *{visibility:hidden!important}`,
          foregroundScrub:
            `.${TEX_ROOT} *{visibility:hidden!important}` +
            `${selectors},${selectors} *{visibility:visible!important}`,
          hasForeground: true as const,
        }
      : { sampleExtra: "", foregroundScrub: "", hasForeground: false as const };

  return {
    ...visibility,
    sampleNoLayout: sampleRoots.length ? NOLAYOUT_SCRUB.sample : "",
    chromeNoLayout: chromeRoots.length ? NOLAYOUT_SCRUB.chrome : "",
    foregroundNoLayout: foregroundRoots.length ? NOLAYOUT_SCRUB.foreground : "",
    noLayoutCounts: {
      sample: sampleRoots.length,
      chrome: chromeRoots.length,
      foreground: foregroundRoots.length,
    },
  };
}
