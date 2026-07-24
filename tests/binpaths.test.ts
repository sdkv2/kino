import { describe, it, expect } from "vitest";
import { preferSystem, hasZscale } from "../src/media/binPaths.js";

describe("preferSystem", () => {
  it("rejects the ffmpeg 4.4 Ubuntu 22.04 ships — it predates -fps_mode", () => {
    expect(preferSystem("ffmpeg version 4.4.2-0ubuntu0.22.04.1 Copyright (c) 2000-2021")).toBe(false);
  });

  it("accepts modern releases", () => {
    expect(preferSystem("ffmpeg version 5.1.4 Copyright (c) 2000-2023")).toBe(true);
    expect(preferSystem("ffmpeg version 6.1.1 Copyright (c) 2000-2023")).toBe(true);
    expect(preferSystem("ffmpeg version n7.0 Copyright (c) 2000-2024")).toBe(true);
  });

  it("keeps nightly/git builds, whose banner carries no semver", () => {
    expect(preferSystem("ffmpeg version N-113831-g8f0d1e8 Copyright (c) 2000-2024")).toBe(true);
  });

  it("handles ffprobe banners the same way", () => {
    expect(preferSystem("ffprobe version 4.4.2-0ubuntu0.22.04.1")).toBe(false);
    expect(preferSystem("ffprobe version 6.1.1")).toBe(true);
  });
});

describe("hasZscale", () => {
  // Homebrew's ffmpeg 8 builds without libzimg. Preferring it silently blacks out HDR beats.
  it("rejects a listing with no zscale (Homebrew ffmpeg 8)", () => {
    expect(hasZscale(" T.. yadif  V->V  Deinterlace\n ... zoompan  V->V  Apply Zoom & Pan\n")).toBe(false);
  });

  it("accepts a listing that carries zscale", () => {
    expect(hasZscale(" ... zscale  V->V  Apply resizing, colorspace and bit depth conversion.\n")).toBe(true);
  });

  it("is not fooled by a substring match", () => {
    expect(hasZscale(" ... zscalefoo  V->V  something else\n")).toBe(false);
  });
});
