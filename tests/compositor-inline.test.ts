import { describe, it, expect } from "vitest";
import { findExternalRefs, inlineExternalRefs } from "../src/render/native/page/compositor/inline.js";

const fakeFetch = async (url: string) =>
  url === "/public/missing.png" ? null : `data:image/png;base64,AAAA#${url}&end=1`;

describe("findExternalRefs", () => {
  it("finds img src and CSS url() references", () => {
    const html = `<img src="/public/a.png"><style>.b{background:url("/public/b.jpg")}</style>`;
    expect(findExternalRefs(html).sort()).toEqual(["/public/a.png", "/public/b.jpg"]);
  });

  it("ignores data: URLs and fragment references", () => {
    expect(findExternalRefs(`<img src="data:image/png;base64,AA"><div style="filter:url(#kino-glow)"></div>`)).toEqual([]);
  });
});

describe("inlineExternalRefs", () => {
  it("rewrites every external reference to a data URL", async () => {
    const out = await inlineExternalRefs(`<img src="/public/a.png">`, fakeFetch);
    expect(out).toContain("data:image/png;base64,AAAA#/public/a.png");
    expect(out).not.toContain("/public/a.png\"");
  });

  it("rewrites references inside CSS url()", async () => {
    const out = await inlineExternalRefs(`<style>.b{background:url(/public/b.jpg)}</style>`, fakeFetch);
    expect(out).toContain("data:image/png;base64,AAAA#/public/b.jpg");
  });

  it("leaves a reference alone when it cannot be fetched", async () => {
    const out = await inlineExternalRefs(`<img src="/public/missing.png">`, fakeFetch);
    expect(out).toContain("/public/missing.png");
  });

  it("fetches each distinct reference once, however many times it appears", async () => {
    const seen: string[] = [];
    const counting = async (url: string) => {
      seen.push(url);
      return `data:image/png;base64,AAAA`;
    };
    await inlineExternalRefs(`<img src="/public/a.png"><img src="/public/a.png">`, counting);
    expect(seen).toEqual(["/public/a.png"]);
  });

  it("returns markup unchanged when there is nothing to inline", async () => {
    const html = `<div style="background:#0b1020">hi</div>`;
    expect(await inlineExternalRefs(html, fakeFetch)).toBe(html);
  });
});
