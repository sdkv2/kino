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

// The captured h264 stream is all-intra with no advancing POC, so ffmpeg must be told to generate
// timestamps rather than derive them from the bitstream. Without the input `-r`, Chromium's
// OpenH264 output (Linux) muxed 295 frames as a 0.5s/240fps track. See encoderInputArgs.
describe("encoderInputArgs", () => {
  it("forces constant-rate input timestamps for h264", async () => {
    const { encoderInputArgs } = await import("../src/render/native/engine.js");
    const args = encoderInputArgs("h264", 30);
    expect(args).toContain("-r");
    expect(args[args.indexOf("-r") + 1]).toBe("30");
    expect(args.slice(-2)).toEqual(["-i", "-"]);
  });

  it("keeps the mjpeg pipe on -framerate", async () => {
    const { encoderInputArgs } = await import("../src/render/native/engine.js");
    const args = encoderInputArgs("jpeg", 24);
    expect(args).toContain("mjpeg");
    expect(args[args.indexOf("-framerate") + 1]).toBe("24");
  });
});
