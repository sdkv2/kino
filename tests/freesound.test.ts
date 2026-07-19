import { describe, it, expect } from "vitest";
import { parseHits, previewUrl, searchUrl, type FreesoundHit } from "../src/media/freesound.js";

const hit = (over: Partial<FreesoundHit> = {}): FreesoundHit => ({
  id: 1,
  name: "Soft Pad",
  duration: 32,
  license: "http://creativecommons.org/publicdomain/zero/1.0/",
  username: "tester",
  tags: ["ambient", "loop"],
  previews: { "preview-hq-mp3": "https://example.com/hq.mp3" },
  ...over,
});

describe("searchUrl", () => {
  it("encodes CC0 + short-form duration filter", () => {
    const u = new URL(searchUrl("soft ambient", { pageSize: 5 }));
    expect(u.origin + u.pathname).toBe("https://freesound.org/apiv2/search/text/");
    expect(u.searchParams.get("query")).toBe("soft ambient");
    expect(u.searchParams.get("page_size")).toBe("5");
    expect(u.searchParams.get("filter")).toContain('license:"Creative Commons 0"');
    expect(u.searchParams.get("filter")).toContain("duration:[15 TO 90]");
    expect(u.searchParams.get("sort")).toBe("rating_desc");
  });
});

describe("parseHits / previewUrl", () => {
  it("returns results array", () => {
    expect(parseHits({ results: [hit()] })).toHaveLength(1);
  });
  it("throws on unexpected body", () => {
    expect(() => parseHits({ error: "nope" })).toThrow(/no results/);
  });
  it("prefers hq mp3 preview", () => {
    expect(previewUrl(hit())).toBe("https://example.com/hq.mp3");
    expect(
      previewUrl(hit({ previews: { "preview-lq-mp3": "https://example.com/lq.mp3" } })),
    ).toBe("https://example.com/lq.mp3");
    expect(previewUrl(hit({ previews: {} }))).toBeNull();
  });
});
