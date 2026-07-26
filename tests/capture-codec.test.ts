import { describe, it, expect } from "vitest";
import { resolveCaptureCodec } from "../src/render/native/engine.js";

describe("resolveCaptureCodec", () => {
  it("defaults video builds to h264", () => {
    expect(resolveCaptureCodec({})).toBe("h264");
  });

  it("forces jpeg for stills", () => {
    expect(resolveCaptureCodec({ KINO_CAPTURE_CODEC: "h264" }, true)).toBe("jpeg");
  });

  it("honours KINO_CAPTURE_CODEC=jpeg", () => {
    expect(resolveCaptureCodec({ KINO_CAPTURE_CODEC: "jpeg" })).toBe("jpeg");
  });
});

describe("frameSignatures captureCodec", () => {
  it("splits jpeg vs h264 caches", async () => {
    const { frameSignatures } = await import("../src/render/native/frameCache.js");
    const base = {
      publicDir: "/x",
      pageJsHash: "pj",
      width: 1080,
      height: 1920,
      total: 10,
      fps: 30,
      props: { fps: 30, segments: [] } as never,
    };
    const j = frameSignatures({ ...base, captureCodec: "jpeg" });
    const h = frameSignatures({ ...base, captureCodec: "h264" });
    expect(j[0]).not.toBe(h[0]);
  });
});
