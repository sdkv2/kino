// Regression test for a bug in src/commands/build.ts's per-segment mapping: the shared `base`
// object (returned for every segment kind) dropped `mask`, `effects`, and `blend` on the floor.
// A spec authoring a mask/effect/blend passed schema validation and `kino build` succeeded, but
// the fields never reached KinoProps — the compositor never saw them, so they silently did
// nothing. Every existing mask/effect/blend test constructs KinoProps directly and bypasses
// build.ts entirely, so nothing caught this. This test goes through the REAL prepare() pipeline
// (src/commands/build.ts) instead of hand-building KinoProps, so it actually exercises the
// mapping that broke.
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepare } from "../src/commands/build.js";

const MASK = { source: { kind: "shape", shape: { kind: "rect", x: 0, y: 0, w: 100, h: 100 } }, feather: 4 };
const EFFECTS = [{ kind: "blur", params: { radius: 8 } }];
const BLEND = "screen";

// One segment of each kind (video/scene/motion) — build.ts returns a differently-shaped object
// per kind, and the bug dropped mask/effects/blend from all three.
function writeSpec(): string {
  const dir = mkdtempSync(join(tmpdir(), "build-fx-"));
  const spec = {
    title: "build-fx-threading",
    format: ["9:16"],
    segments: [
      {
        kind: "video",
        source: "pexels/7846593.mp4",
        text: "video beat",
        caption: "video beat",
        mask: MASK,
        effects: EFFECTS,
        blend: BLEND,
      },
      {
        kind: "scene",
        text: "scene beat",
        caption: "scene beat",
        mask: MASK,
        effects: EFFECTS,
        blend: BLEND,
      },
      {
        kind: "motion",
        source: "motion/stat.html",
        text: "motion beat",
        caption: "motion beat",
        mask: MASK,
        effects: EFFECTS,
        blend: BLEND,
      },
    ],
  };
  const path = join(dir, "spec.json");
  writeFileSync(path, JSON.stringify(spec));
  return path;
}

describe("build.ts threads mask/effects/blend onto every segment kind", () => {
  it("carries an authored mask, effects, and blend from the spec into KinoProps.segments", async () => {
    const specPath = writeSpec();
    const r = await prepare(specPath, { mock: true, format: "9:16", project: "compositor-demo" });
    expect(r.props.segments).toHaveLength(3);
    for (const seg of r.props.segments) {
      expect(seg.mask).toEqual(MASK);
      expect(seg.effects).toEqual(EFFECTS);
      expect(seg.blend).toBe(BLEND);
    }
  }, 60000);
});
