import { describe, it, expect } from "vitest";
import { resolveRenderer } from "../src/render/native/renderer.js";

describe("resolveRenderer", () => {
  it("defaults to puppeteer", () => {
    expect(resolveRenderer({})).toBe("puppeteer");
  });

  it("selects electron when KINO_RENDERER=electron", () => {
    expect(resolveRenderer({ KINO_RENDERER: "electron" })).toBe("electron");
  });
});
