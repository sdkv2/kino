import { describe, it, expect } from "vitest";
import { cleanupServeUrl } from "../src/render/render.js";
import { mkdtempSync, mkdirSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("cleanupServeUrl", () => {
  it("removes a leaked remotion webpack bundle dir", () => {
    const base = mkdtempSync(join(tmpdir(), "kino-cln-"));
    const bundleDir = join(base, "remotion-webpack-bundle-abc123");
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(join(bundleDir, "x.js"), "1");
    cleanupServeUrl(bundleDir);
    expect(existsSync(bundleDir)).toBe(false);
  });
  it("leaves a non-bundle path untouched (safety guard)", () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-keep-"));
    cleanupServeUrl(dir);
    expect(existsSync(dir)).toBe(true);
  });
  it("is a no-op for a missing path", () => {
    expect(() => cleanupServeUrl("/no/such/remotion-webpack-bundle-zzz")).not.toThrow();
  });
});
