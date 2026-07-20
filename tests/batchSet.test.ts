import { describe, expect, it } from "vitest";
import { applySet, applySets } from "../src/media/batchSet.js";

describe("applySet", () => {
  it("sets a nested object leaf", () => {
    const t = { segments: [{ text: "a" }, { text: "b" }] };
    applySet(t, "segments.0.text", "Make me a trailer.");
    expect(t.segments[0]!.text).toBe("Make me a trailer.");
  });

  it("sets an array element", () => {
    const t = { format: ["9:16"] as string[] };
    applySet(t, "format.0", "3:4");
    expect(t.format[0]).toBe("3:4");
  });

  it("throws when path missing", () => {
    expect(() => applySet({ a: 1 }, "b", 2)).toThrow(/not found/);
    expect(() => applySet({ segments: [] }, "segments.0.text", "x")).toThrow(/not found/);
  });

  it("applySets applies many paths", () => {
    const t = { title: "ad", segments: [{ text: "old" }] };
    applySets(t, { title: "ad-hook", "segments.0.text": "new" });
    expect(t.title).toBe("ad-hook");
    expect(t.segments[0]!.text).toBe("new");
  });
});
