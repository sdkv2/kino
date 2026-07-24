import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockBackend } from "../src/segment/mock.js";
import { readManifest } from "../src/segment/manifest.js";

describe("mock backend", () => {
  it("produces a mask.png + manifest for an image input", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-mock-"));
    const res = await mockBackend.run({ input: "photo.png", prompt: "the cat", objects: 1, track: false, outDir });
    expect(existsSync(join(outDir, "mask.png"))).toBe(true);
    const m = readManifest(outDir);
    expect(m.kind).toBe("image");
    expect(m.backend).toBe("mock");
    expect(m.objects[0].label).toBe("the cat");
  });
});
