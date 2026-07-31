import { describe, it, expect } from "vitest";
import { normalizeFamily, parseVariants, matchFamily, suggestFamily, searchCatalog, type CatalogFont } from "../src/fonts/googleApi.js";
import { isCssFontStack, pickCaptionWeight, resolveFont, fontPath, DEFAULT_FONT_WEIGHT } from "../src/fonts/manager.js";

const CATALOG: CatalogFont[] = [
  { family: "Space Mono", category: "monospace", weights: [400, 700] },
  { family: "Space Grotesk", category: "sans-serif", weights: [300, 400, 500, 600, 700] },
  { family: "Playfair Display", category: "serif", weights: [400, 500, 600, 700, 800, 900] },
  { family: "Big Shoulders Display", category: "display", weights: [100, 900] },
];

describe("google fonts variants", () => {
  it("maps variants to upright numeric weights, dropping italics", () => {
    expect(parseVariants(["100", "regular", "italic", "700", "700italic"])).toEqual([100, 400, 700]);
  });
  it("ignores junk variants", () => {
    expect(parseVariants(["regular", "bogus", "1000", "50"])).toEqual([400]);
  });
});

describe("family matching", () => {
  it("normalizes case and punctuation", () => {
    expect(normalizeFamily("Plus Jakarta Sans")).toBe("plusjakartasans");
    expect(matchFamily(CATALOG, "space mono")?.family).toBe("Space Mono");
    expect(matchFamily(CATALOG, "SPACE-MONO")?.family).toBe("Space Mono");
  });
  it("returns undefined for a family that is not in the catalog", () => {
    expect(matchFamily(CATALOG, "Comic Sans")).toBeUndefined();
  });
  it("suggests the shortest prefix match for a miss", () => {
    // Both Space families are prefixed by "space" — the shorter name wins.
    expect(suggestFamily(CATALOG, "Space")).toBe("Space Mono");
    expect(suggestFamily(CATALOG, "playfair")).toBe("Playfair Display");
  });
  it("declines to guess on a stub too short to be meaningful", () => {
    expect(suggestFamily(CATALOG, "sp")).toBeUndefined();
  });
});

describe("catalog search", () => {
  it("requires every term to match, over family and category", () => {
    expect(searchCatalog(CATALOG, "space").map((f) => f.family)).toEqual(["Space Mono", "Space Grotesk"]);
    expect(searchCatalog(CATALOG, "space mono").map((f) => f.family)).toEqual(["Space Mono"]);
    // Category is searchable too, so "serif" finds a family whose name never says it.
    expect(searchCatalog(CATALOG, "display serif").map((f) => f.family)).toEqual(["Playfair Display"]);
  });
  it("honours the limit", () => {
    expect(searchCatalog(CATALOG, "", 2)).toHaveLength(2);
  });
});

describe("css font stacks", () => {
  it("treats a comma-separated stack and bare generics as system fonts, not downloads", () => {
    expect(isCssFontStack('Helvetica, "Helvetica Neue", Arial, sans-serif')).toBe(true);
    expect(isCssFontStack("sans-serif")).toBe(true);
    expect(isCssFontStack("Space Mono")).toBe(false);
  });
  it("resolveFont returns null for a stack, so the caller passes it straight to CSS", async () => {
    expect(await resolveFont('Helvetica, "Helvetica Neue", Arial, sans-serif')).toBeNull();
    expect(await resolveFont("  ")).toBeNull();
  });
});

describe("caption weight selection", () => {
  it("takes the heaviest cut at or below the 800 ceiling", () => {
    expect(pickCaptionWeight([400, 500, 600, 700, 800, 900])).toBe(800);
    expect(pickCaptionWeight([400, 700])).toBe(700);
  });
  it("falls back to the lightest cut when a family only ships heavier than the ceiling", () => {
    expect(pickCaptionWeight([900])).toBe(900);
  });
  it("uses the default when the family's cuts are unknown", () => {
    expect(pickCaptionWeight([])).toBe(DEFAULT_FONT_WEIGHT);
  });
});

describe("resolveFont", () => {
  it("keeps the curated hand-tuned weight for a shortlist name", async () => {
    const f = await resolveFont("anton");
    expect(f).toMatchObject({ family: "Anton", weight: 400, curated: true });
  });
  it("accepts any family name, at the default weight", async () => {
    // The curated list is a recommendation surface, not a whitelist — this is the whole point.
    // A name no catalog can contain keeps the assertion the same whether or not a key is set.
    const f = await resolveFont("Nonexistent Family Zzq");
    expect(f).toMatchObject({ family: "Nonexistent Family Zzq", weight: DEFAULT_FONT_WEIGHT, curated: false });
  });
});

describe("cache paths", () => {
  it("names one file per family + cut", () => {
    expect(fontPath("Space Mono", 700).endsWith("space-mono-700.ttf")).toBe(true);
    expect(fontPath("Space Mono", 400).endsWith("space-mono-400.ttf")).toBe(true);
  });
});
