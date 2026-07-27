import { describe, expect, it } from "vitest";
import { TEX_ROOT } from "../src/render/native/page/bgTextures.js";
import {
  buildLensPlateScrubs,
  collectForegroundRoots,
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
