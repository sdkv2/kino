import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { runSegment } from "../src/segment/segment.js";
import { readManifest } from "../src/segment/manifest.js";

describe("runSegment", () => {
  it("dispatches to the mock backend and lands the manifest under assets/masks/", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "kino-segment-"));
    const res = await runSegment({
      input: "photo.png",
      prompt: "the cat",
      backend: "mock",
      projectRoot,
    });

    expect(res.outDir.startsWith(join(projectRoot, "assets", "masks") + sep)).toBe(true);
    expect(existsSync(join(res.outDir, "manifest.json"))).toBe(true);

    const m = readManifest(res.outDir);
    expect(m).toEqual(res.manifest);
    expect(m.backend).toBe("mock");
    expect(m.kind).toBe("image");
    expect(m.objects[0].label).toBe("the cat");
  });

  it("names the outDir from --out when given, else the input's basename", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "kino-segment-"));
    const res = await runSegment({
      input: "dog.png",
      prompt: "the dog",
      backend: "mock",
      out: "custom-name",
      projectRoot,
    });
    expect(res.outDir).toBe(join(projectRoot, "assets", "masks", "custom-name"));
  });
});
