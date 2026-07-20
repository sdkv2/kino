import { describe, it, expect } from "vitest";
import { catalogBeds, resolveMusicBed, MUSIC_BEDS } from "../src/media/music.js";

describe("music library (ships empty)", () => {
  it("has no curated catalog and no beds on disk", () => {
    expect(MUSIC_BEDS).toEqual([]);
    expect(catalogBeds()).toEqual([]);
  });

  it("resolveMusicBed throws for unknown ids, naming the empty library", () => {
    expect(() => resolveMusicBed("no-such-bed-xyz")).toThrow(/Unknown music id/);
    expect(() => resolveMusicBed("no-such-bed-xyz")).toThrow(/music library empty/);
  });
});
