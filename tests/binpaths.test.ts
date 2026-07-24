import { describe, it, expect } from "vitest";
import { preferSystem } from "../src/media/binPaths.js";

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
