// Paint-order split for lens compositing: backdrop (sample) vs foreground above the lens stack.
import { LENS_SELECTOR } from "../../lensContract.js";
import { TEX_ROOT } from "./bgTextures.js";

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

export interface LensPlateScrubs {
  sampleExtra: string;
  foregroundScrub: string;
  hasForeground: boolean;
}

export function buildLensPlateScrubs(texRoot: HTMLElement, lensStack: HTMLElement[]): LensPlateScrubs {
  const roots = collectForegroundRoots(texRoot, lensStack);
  if (!roots.length) return { sampleExtra: "", foregroundScrub: "", hasForeground: false };
  const selectors = roots.map((el) => cssSelectorFor(el, texRoot)).join(",");
  return {
    sampleExtra: `${selectors},${selectors} *{visibility:hidden!important}`,
    foregroundScrub:
      `.${TEX_ROOT} *{visibility:hidden!important}` +
      `${selectors},${selectors} *{visibility:visible!important}`,
    hasForeground: true,
  };
}
