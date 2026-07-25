import { describe, it, expect } from "vitest";
import { classifyRaster } from "../src/render/native/page/compositor/rasterPolicy.js";

const noTier2 = { hasTier2: false };

describe("classifyRaster", () => {
  it("classifies inert markup as static", () => {
    expect(classifyRaster(`<div style="color:#fff">hi</div>`, noTier2)).toBe("static");
  });

  it("classifies markup reading --frame as dynamic", () => {
    expect(classifyRaster(`<style>.a{opacity:var(--frame)}</style><div class="a"></div>`, noTier2)).toBe("dynamic");
  });

  it("classifies markup reading --t, --progress or --pulse as dynamic", () => {
    expect(classifyRaster(`<style>.a{top:calc(var(--t) * 1px)}</style>`, noTier2)).toBe("dynamic");
    expect(classifyRaster(`<style>.a{transform:scale(var(--progress))}</style>`, noTier2)).toBe("dynamic");
    expect(classifyRaster(`<style>.a{filter:blur(var(--pulse))}</style>`, noTier2)).toBe("dynamic");
  });

  it("classifies Tier-2 markup as dynamic regardless of CSS", () => {
    expect(classifyRaster(`<div>static looking</div>`, { hasTier2: true })).toBe("dynamic");
  });

  it("classifies CSS animations as dynamic — they are scrubbed per frame", () => {
    expect(classifyRaster(`<style>@keyframes k{to{opacity:1}} .a{animation:k 1s}</style>`, noTier2)).toBe("dynamic");
  });

  it("classifies word-bound markup as keyed", () => {
    expect(classifyRaster(`<style>.w{color:var(--word-active)}</style>`, noTier2)).toBe("keyed");
  });

  it("errs toward dynamic on unrecognised custom properties", () => {
    // An unknown var could be frame-driven; freezing it would be a silent wrong render.
    expect(classifyRaster(`<style>.a{left:var(--mystery)}</style>`, noTier2)).toBe("dynamic");
  });

  it("is not fooled by the substring 'frame' in an unrelated identifier", () => {
    expect(classifyRaster(`<div class="phone-frame">hi</div>`, noTier2)).toBe("static");
  });
});
