import { describe, it, expect } from "vitest";
import { findExternalRefs } from "../scripts/spike/scan-external-refs.mjs";

describe("findExternalRefs", () => {
  it("finds img src attributes", () => {
    expect(findExternalRefs(`<img src="/public/shot.png">`)).toEqual(["/public/shot.png"]);
  });

  it("finds CSS url() references in style blocks and attributes", () => {
    const html = `<style>.a{background:url("/public/bg.jpg")}</style><div style="background:url(/public/x.svg)"></div>`;
    expect(findExternalRefs(html).sort()).toEqual(["/public/bg.jpg", "/public/x.svg"]);
  });

  it("ignores data: URLs — they already survive the raster", () => {
    expect(findExternalRefs(`<img src="data:image/png;base64,AAAA">`)).toEqual([]);
  });

  it("ignores in-document SVG fragment references", () => {
    expect(findExternalRefs(`<div style="filter:url(#kino-glow)"></div>`)).toEqual([]);
  });

  it("deduplicates repeats", () => {
    expect(findExternalRefs(`<img src="/public/a.png"><img src="/public/a.png">`)).toEqual(["/public/a.png"]);
  });

  it("returns empty for markup with no external references", () => {
    expect(findExternalRefs(`<div style="background:#0b1020">hi</div>`)).toEqual([]);
  });
});
