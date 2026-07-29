// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { TEX_ROOT } from "../src/render/native/page/bgTextures.js";
import {
  buildLensPlateScrubs,
  collectForegroundRoots,
  collectNoLayoutRoots,
  isHtmlElement,
  isOutOfFlow,
  isSafeNoLayoutRoot,
  NOLAYOUT_CLASS,
  paintsAbove,
} from "../src/render/native/page/lensPaintOrder.js";
import { mountMotionRasterProbe } from "../src/render/native/page/motionRaster.js";
import { lensStackOrder } from "../src/render/native/page/lensMirror.js";
import { LENS_SELECTOR } from "../src/render/lensContract.js";

const theme = { night: "#000", mint: "#0f0", gold: "#fc0", green: "#080", white: "#fff" };

describe("lens paint order", () => {
  it("paintsAbove respects z-index then DOM order", () => {
    const probe = document.createElement("div");
    probe.innerHTML = `<div id="low" style="position:absolute;z-index:1"></div><div id="high" style="position:absolute;z-index:9"></div>`;
    const low = probe.querySelector("#low")!;
    const high = probe.querySelector("#high")!;
    expect(paintsAbove(high, low)).toBe(true);
    expect(paintsAbove(low, high)).toBe(false);
  });

  it("collects siblings above the topmost kino-lens", () => {
    const html = `<div class="desk" style="position:absolute;inset:0">
      <div class="menubar kino-lens" style="position:absolute;z-index:20"></div>
      <div class="chrome-win" style="position:absolute;z-index:10"></div>
      <div class="dock-wrap kino-lens" style="position:absolute;z-index:30"></div>
      <div class="cursor-layer" style="position:absolute;z-index:9999"><div class="cursor"></div></div>
    </div>`;
    const { texRoot, unmount } = mountMotionRasterProbe(html, {}, theme, 1920, 1080);
    const stack = lensStackOrder(Array.from(texRoot.querySelectorAll<HTMLElement>(LENS_SELECTOR)));
    const fg = collectForegroundRoots(texRoot, stack);
    expect(fg.map((el) => el.className)).toEqual(["cursor-layer"]);
    const scrubs = buildLensPlateScrubs(texRoot, stack);
    expect(scrubs.hasForeground).toBe(true);
    expect(scrubs.sampleExtra).toContain(`.${TEX_ROOT} .cursor-layer`);
    unmount();
  });
});

describe("lens no-layout predicate", () => {
  const deskScene = `<div class="desk" style="position:absolute;inset:0">
    <div class="desk-fx" style="position:absolute;inset:0">
      <div class="menubar kino-lens" style="position:absolute;z-index:20"></div>
      <div class="dock-wrap kino-lens" style="position:absolute;z-index:30"></div>
    </div>
    <div class="chrome-win" style="position:absolute;z-index:10"><div class="tab">tab</div></div>
    <div class="cursor-layer" style="position:absolute;z-index:9999"><div class="cursor"></div></div>
  </div>`;

  it("out-of-flow fully-hidden subtree passes for sample plate", () => {
    const { texRoot, unmount } = mountMotionRasterProbe(deskScene, {}, theme, 1920, 1080);
    const stack = lensStackOrder(Array.from(texRoot.querySelectorAll<HTMLElement>(LENS_SELECTOR)));
    const fg = collectForegroundRoots(texRoot, stack);
    const isVisible = (el: Element) =>
      !el.closest(LENS_SELECTOR) && !fg.some((r) => r === el || r.contains(el));
    const menubar = texRoot.querySelector(".menubar") as HTMLElement;
    const dock = texRoot.querySelector(".dock-wrap") as HTMLElement;
    expect(isOutOfFlow(menubar)).toBe(true);
    expect(isSafeNoLayoutRoot(menubar, texRoot, isVisible)).toBe(true);
    expect(isSafeNoLayoutRoot(dock, texRoot, isVisible)).toBe(true);
    unmount();
  });

  it("in-flow element fails", () => {
    const html = `<div class="desk" style="position:absolute;inset:0">
      <div class="in-flow"><span>text</span></div>
      <div class="menubar kino-lens" style="position:absolute"></div>
    </div>`;
    const { texRoot, unmount } = mountMotionRasterProbe(html, {}, theme, 1920, 1080);
    const inFlow = texRoot.querySelector(".in-flow") as HTMLElement;
    expect(isOutOfFlow(inFlow)).toBe(false);
    expect(isSafeNoLayoutRoot(inFlow, texRoot, () => false)).toBe(false);
    unmount();
  });

  it("subtree with must-stay-visible descendant fails", () => {
    const { texRoot, unmount } = mountMotionRasterProbe(deskScene, {}, theme, 1920, 1080);
    const stack = lensStackOrder(Array.from(texRoot.querySelectorAll<HTMLElement>(LENS_SELECTOR)));
    const fg = collectForegroundRoots(texRoot, stack);
    const isVisibleChrome = (el: Element) => !!el.closest(LENS_SELECTOR);
    const desk = texRoot.querySelector(".desk") as HTMLElement;
    expect(fg.some((r) => desk.contains(r))).toBe(true);
    expect(isSafeNoLayoutRoot(desk, texRoot, isVisibleChrome)).toBe(false);
    unmount();
  });

  it("never selects SVG elements", () => {
    const html = `<div class="desk" style="position:absolute;inset:0">
      <svg style="position:absolute"><circle cx="5" cy="5" r="4"/></svg>
      <div class="menubar kino-lens" style="position:absolute"></div>
    </div>`;
    const { texRoot, unmount } = mountMotionRasterProbe(html, {}, theme, 1920, 1080);
    const svg = texRoot.querySelector("svg")!;
    expect(isHtmlElement(svg)).toBe(false);
    const roots = collectNoLayoutRoots(texRoot, () => false);
    expect(roots.every((el) => isHtmlElement(el))).toBe(true);
    expect(roots.some((el) => el.tagName.toLowerCase() === "svg")).toBe(false);
    unmount();
  });

  it("chrome plate tags chrome-win but not lens-containing desk-fx", () => {
    const { texRoot, unmount } = mountMotionRasterProbe(deskScene, {}, theme, 1920, 1080);
    const stack = lensStackOrder(Array.from(texRoot.querySelectorAll<HTMLElement>(LENS_SELECTOR)));
    const scrubs = buildLensPlateScrubs(texRoot, stack);
    const chromeWin = texRoot.querySelector(".chrome-win") as HTMLElement;
    const deskFx = texRoot.querySelector(".desk-fx") as HTMLElement;
    expect(chromeWin.classList.contains(NOLAYOUT_CLASS.chrome)).toBe(true);
    expect(deskFx.classList.contains(NOLAYOUT_CLASS.chrome)).toBe(false);
    expect(scrubs.noLayoutCounts.chrome).toBeGreaterThanOrEqual(1);
    unmount();
  });

  it("sample plate tags lens roots", () => {
    const { texRoot, unmount } = mountMotionRasterProbe(deskScene, {}, theme, 1920, 1080);
    const stack = lensStackOrder(Array.from(texRoot.querySelectorAll<HTMLElement>(LENS_SELECTOR)));
    buildLensPlateScrubs(texRoot, stack);
    expect(texRoot.querySelector(".menubar")!.classList.contains(NOLAYOUT_CLASS.sample)).toBe(true);
    expect(texRoot.querySelector(".dock-wrap")!.classList.contains(NOLAYOUT_CLASS.sample)).toBe(true);
    unmount();
  });
});
