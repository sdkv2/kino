import { describe, expect, it } from "vitest";
import { parsePlatform } from "../src/render/platform.js";

describe("parsePlatform", () => {
  it("parses tiktok", () => {
    expect(parsePlatform("tiktok")).toBe("tiktok");
    expect(parsePlatform("TikTok")).toBe("tiktok");
  });

  it("aliases reels/shorts to reels", () => {
    expect(parsePlatform("reels")).toBe("reels");
    expect(parsePlatform("shorts")).toBe("reels");
    expect(parsePlatform("youtube")).toBe("reels");
  });

  it("returns undefined when unset", () => {
    expect(parsePlatform(undefined)).toBeUndefined();
    expect(parsePlatform("")).toBeUndefined();
  });

  it("throws on unknown", () => {
    expect(() => parsePlatform("snapchat")).toThrow(/Unknown --platform/);
  });
});
