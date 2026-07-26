import { describe, it, expect } from "vitest";
import { compositorEnabled } from "../src/render/native/engine.js";

describe("compositorEnabled", () => {
  it("is always on — the DOM path was removed in phase 4", () => {
    expect(compositorEnabled({})).toBe(true);
    expect(compositorEnabled({ KINO_COMPOSITOR: "0" })).toBe(true);
    expect(compositorEnabled({ KINO_COMPOSITOR: "1" })).toBe(true);
  });
});
