import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  fetchAsDataUrl,
  resetDataUrlCacheForTests,
  inlineExternalRefs,
} from "../src/render/native/page/compositor/inline.js";
import {
  fontFaceCacheKey,
  resetFontFaceCacheForTests,
} from "../src/render/native/page/bgTextures.js";

function stubFetchAndFileReader(blobBytes = "png-bytes") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      blob: () => Promise.resolve(new Blob([blobBytes], { type: "image/png" })),
    })),
  );
  vi.stubGlobal(
    "FileReader",
    class {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        this.result = `data:image/png;base64,${btoa(blobBytes)}`;
        this.onload?.();
      }
    },
  );
}

describe("fontFaceCacheKey", () => {
  it("keys on both font paths", () => {
    const a = fontFaceCacheKey({ fontUrl: "fonts/a.ttf", labelFontUrl: "fonts/b.ttf" });
    const b = fontFaceCacheKey({ fontUrl: "fonts/a.ttf", labelFontUrl: "fonts/b.ttf" });
    const c = fontFaceCacheKey({ fontUrl: "fonts/a.ttf", labelFontUrl: "fonts/c.ttf" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("treats missing paths as empty", () => {
    expect(fontFaceCacheKey({ fontUrl: null, labelFontUrl: undefined })).toBe("\0");
  });
});

describe("fetchAsDataUrl cache", () => {
  beforeEach(() => {
    resetDataUrlCacheForTests();
  });

  it("returns byte-identical data URLs on cache hit", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: () => Promise.resolve(new Blob(["png-bytes"], { type: "image/png" })),
    }));
    stubFetchAndFileReader();
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchAsDataUrl("/public/a.png");
    const second = await fetchAsDataUrl("/public/a.png");
    expect(first).toBeTruthy();
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it("evicts oldest entries when over the cap", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        blob: () => Promise.resolve(new Blob([`b${n++}`], { type: "application/octet-stream" })),
      })),
    );
    stubFetchAndFileReader("x");

    for (let i = 0; i < 130; i++) {
      await fetchAsDataUrl(`/public/asset-${i}.bin`);
    }
    const refetch0 = vi.mocked(fetch).mock.calls.length;
    await fetchAsDataUrl("/public/asset-0.bin");
    const refetch1 = vi.mocked(fetch).mock.calls.length;
    expect(refetch1).toBeGreaterThan(refetch0);

    vi.unstubAllGlobals();
  });
});

describe("inlineExternalRefs determinism", () => {
  beforeEach(() => {
    resetDataUrlCacheForTests();
  });

  it("produces byte-identical markup on repeat passes", async () => {
    const html = `<img src="/public/a.png"><style>.x{background:url(/public/b.jpg)}</style>`;
    const fetcher = async (url: string) => `data:image/png;base64,${url}`;
    const cold = await inlineExternalRefs(html, fetcher);
    const warm = await inlineExternalRefs(html, fetcher);
    expect(warm).toBe(cold);
  });

  it("reuses fetchAsDataUrl cache across inline passes", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: () => Promise.resolve(new Blob(["png"], { type: "image/png" })),
    }));
    stubFetchAndFileReader("png");
    vi.stubGlobal("fetch", fetchMock);
    const html = `<img src="/public/a.png"><img src="/public/b.jpg">`;
    await inlineExternalRefs(html, fetchAsDataUrl);
    await inlineExternalRefs(html, fetchAsDataUrl);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});

describe("resetFontFaceCacheForTests", () => {
  it("exports a reset hook", () => {
    expect(() => resetFontFaceCacheForTests()).not.toThrow();
  });
});
