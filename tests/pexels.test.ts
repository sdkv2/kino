import { describe, it, expect } from "vitest";
import { searchUrl, parseVideos, pickFile, type PexelsVideo } from "../src/media/pexels.js";

const file = (width: number, height: number, file_type = "video/mp4") => ({
  link: `https://cdn.example/${width}.mp4`,
  width,
  height,
  file_type,
  quality: null,
});

const video = (files: ReturnType<typeof file>[]): PexelsVideo => ({
  id: 1,
  duration: 12,
  user: { name: "Test" },
  video_files: files,
});

describe("searchUrl", () => {
  it("encodes query, orientation and per_page", () => {
    const u = new URL(searchUrl("city rain", "portrait", 5));
    expect(u.origin + u.pathname).toBe("https://api.pexels.com/videos/search");
    expect(u.searchParams.get("query")).toBe("city rain");
    expect(u.searchParams.get("orientation")).toBe("portrait");
    expect(u.searchParams.get("per_page")).toBe("5");
  });
});

describe("parseVideos", () => {
  it("returns the videos array", () => {
    expect(parseVideos({ videos: [video([file(1080, 1920)])] })).toHaveLength(1);
  });
  it("throws on an unexpected body", () => {
    expect(() => parseVideos({ error: "nope" })).toThrow(/no videos array/);
  });
});

describe("pickFile", () => {
  it("picks the smallest mp4 that covers the render width", () => {
    const v = video([file(720, 1280), file(2160, 3840), file(1080, 1920)]);
    expect(pickFile(v)?.width).toBe(1080);
  });
  it("falls back to the largest mp4 when none covers the target", () => {
    const v = video([file(540, 960), file(720, 1280)]);
    expect(pickFile(v)?.width).toBe(720);
  });
  it("ignores non-mp4 files (HLS playlists)", () => {
    const v = video([file(1080, 1920, "application/x-mpegURL"), file(720, 1280)]);
    expect(pickFile(v)?.width).toBe(720);
  });
  it("returns null when there is no mp4 at all", () => {
    expect(pickFile(video([file(1080, 1920, "application/x-mpegURL")]))).toBeNull();
  });
});
