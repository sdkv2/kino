import { describe, it, expect } from "vitest";
import { collectCharset, charsetKey } from "../src/fonts/charset.js";

describe("collectCharset", () => {
  it("always includes the full printable-ASCII floor", () => {
    // Tier-2 procs build digits and separators from arithmetic — `('0000' + n).slice(-4)` puts
    // characters on screen that appear in no source as a literal. The floor is the margin for that.
    const cs = collectCharset([]);
    for (const ch of ["0", "9", "A", "z", " ", "%", "/", "+", ".", ":", "-", "?"]) {
      expect(cs).toContain(ch);
    }
    expect(cs.length).toBe(95);
  });

  it("picks up non-ASCII literals from sources", () => {
    const cs = collectCharset([`<text>λ</text>`, `return "a · b — c";`, `{"caption":"café"}`]);
    for (const ch of ["λ", "·", "—", "é"]) expect(cs).toContain(ch);
  });

  // A motion graphic writes `&#183;` rather than a raw middot, so the character it renders appears
  // nowhere in the source. Missing this drops the glyph to a fallback face, silently.
  it("decodes HTML entities, which are how sources spell non-ASCII", () => {
    const cs = collectCharset([`<text>200 &#183; 12 frames &mdash; one render &#x3BB;</text>`]);
    expect(cs).toContain("·");
    expect(cs).toContain("—");
    expect(cs).toContain("λ");
  });

  it("ignores malformed or unknown entities without dropping the rest", () => {
    const cs = collectCharset([`&notarealentity; &#; &#99999999999; &middot;`]);
    expect(cs).toContain("·");
    expect(cs.length).toBeGreaterThan(95);
  });

  it("keeps astral characters whole rather than splitting surrogates", () => {
    const cs = collectCharset(["<p>🎬</p>"]);
    expect(cs).toContain("🎬");
    // The emoji must be present as ONE entry (code point 0x1F3AC), never as the two code units
    // 0xD83C/0xDFAC — a lone surrogate would corrupt the `text=` query.
    for (const ch of cs) {
      const cp = ch.codePointAt(0)!;
      expect(cp >= 0xd800 && cp <= 0xdfff).toBe(false);
    }
    expect([...cs].filter((c) => c.length === 2)).toEqual(["🎬"]);
  });

  // Escapes rather than literal bytes on purpose: a raw NUL/BEL in the file makes git treat the
  // whole test as binary, so it stops diffing in review.
  it("drops control characters, zero-width joiners and the BOM", () => {
    const cs = collectCharset(["a\u0000b\u0007c\u200D\uFEFF"]);
    expect(cs).not.toContain("\u0000");
    expect(cs).not.toContain("\u0007");
    expect(cs).not.toContain("\u200D");
    expect(cs).not.toContain("\uFEFF");
    expect(cs).toContain("a");
  });

  it("is order-independent and deduplicated, so the cache key is stable", () => {
    const a = collectCharset(["λ·", "abc"]);
    const b = collectCharset(["abc", "·λ", "aaabbb"]);
    expect(a).toBe(b);
    expect(charsetKey(a)).toBe(charsetKey(b));
  });
});

describe("charsetKey", () => {
  it("separates different charsets", () => {
    expect(charsetKey(collectCharset(["λ"]))).not.toBe(charsetKey(collectCharset(["·"])));
  });

  it("is filename-safe and short", () => {
    expect(charsetKey(collectCharset(["λ🎬é"]))).toMatch(/^[a-z0-9]{1,7}$/);
  });
});
