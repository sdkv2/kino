import { describe, it, expect } from "vitest";
import { frameUrlFor } from "../src/render/native/page/compositor/providers/frames.js";
import type { MediaEntry } from "../src/render/native/page/media.js";

const entry: MediaEntry = {
  dir: "seg0",
  byFrame: { 0: "f000.png", 1: "f001.png", 2: "f002.png" },
  maxFrame: 2,
};

describe("frameUrlFor", () => {
  it("maps a local frame to its extracted still", () => {
    expect(frameUrlFor(entry, 1)).toBe("/vframes/seg0/f001.png");
  });

  it("clamps past the end — an overrun holds the last frame", () => {
    expect(frameUrlFor(entry, 99)).toBe("/vframes/seg0/f002.png");
  });

  it("clamps before the start", () => {
    expect(frameUrlFor(entry, -5)).toBe("/vframes/seg0/f000.png");
  });

  it("returns null for a sparse gap", () => {
    expect(frameUrlFor({ ...entry, byFrame: { 0: "f000.png", 2: "f002.png" } }, 1)).toBeNull();
  });
});
