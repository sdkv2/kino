import { describe, it, expect } from "vitest";
import {
  searchUrl,
  photoSearchUrl,
  parseVideos,
  parsePhotos,
  pickFile,
  pickPhotoUrl,
  pickPhotoThumb,
  type PexelsVideo,
  type PexelsPhoto,
} from "../src/media/pexels.js";

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
  image: "https://cdn.example/thumb.jpg",
  user: { name: "Test" },
  video_files: files,
});

const photo = (src: Partial<PexelsPhoto["src"]> = {}): PexelsPhoto => ({
  id: 42,
  width: 1080,
  height: 1920,
  alt: "desk",
  photographer: "Ada",
  src: {
    original: "https://cdn.example/original.jpg",
    large2x: "https://cdn.example/large2x.jpg",
    large: "https://cdn.example/large.jpg",
    medium: "https://cdn.example/medium.jpg",
    small: "https://cdn.example/small.jpg",
    portrait: "https://cdn.example/portrait.jpg",
    landscape: "https://cdn.example/landscape.jpg",
    tiny: "https://cdn.example/tiny.jpg",
    ...src,
  },
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

describe("photoSearchUrl", () => {
  it("hits the photos search endpoint", () => {
    const u = new URL(photoSearchUrl("coffee desk", "portrait", 6));
    expect(u.origin + u.pathname).toBe("https://api.pexels.com/v1/search");
    expect(u.searchParams.get("query")).toBe("coffee desk");
    expect(u.searchParams.get("orientation")).toBe("portrait");
    expect(u.searchParams.get("per_page")).toBe("6");
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

describe("parsePhotos", () => {
  it("returns the photos array", () => {
    expect(parsePhotos({ photos: [photo()] })).toHaveLength(1);
  });
  it("throws on an unexpected body", () => {
    expect(() => parsePhotos({ videos: [] })).toThrow(/no photos array/);
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

describe("pickPhotoUrl", () => {
  it("prefers the full-res original (search already filtered orientation — the crop only downscales)", () => {
    expect(pickPhotoUrl(photo(), "portrait")).toContain("original.jpg");
    expect(pickPhotoUrl(photo(), "landscape")).toContain("original.jpg");
  });
  it("falls back original → large2x → large → oriented crop as sizes go missing", () => {
    expect(pickPhotoUrl(photo({ original: "" }), "landscape")).toContain("large2x.jpg");
    expect(pickPhotoUrl(photo({ original: "", large2x: "" }), "landscape")).toContain("large.jpg");
    expect(
      pickPhotoUrl(photo({ original: "", large2x: "", large: "" }), "landscape"),
    ).toContain("landscape.jpg");
  });
});

describe("pickPhotoThumb", () => {
  it("prefers tiny for screening", () => {
    expect(pickPhotoThumb(photo())).toContain("tiny.jpg");
  });
});
