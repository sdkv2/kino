// Regression test for a bug in src/commands/build.ts's per-segment mapping: the shared `base`
// object (returned for every segment kind) dropped `mask`, `effects`, and `blend` on the floor.
// A spec authoring a mask/effect/blend passed schema validation and `kino build` succeeded, but
// the fields never reached KinoProps — the compositor never saw them, so they silently did
// nothing. Every existing mask/effect/blend test constructs KinoProps directly and bypasses
// build.ts entirely, so nothing caught this. This test goes through the REAL prepare() pipeline
// (src/commands/build.ts) instead of hand-building KinoProps, so it actually exercises the
// mapping that broke.
//
// Self-contained (review finding 2): builds a scratch `projects/<name>/` tree under mkdtempSync
// instead of depending on the gitignored "compositor-demo" fixture project (projects/ is
// gitignored — .gitignore:9 — so `prepare(..., { project: "compositor-demo" })` throws `Project
// 'compositor-demo' not found` on a fresh clone and on every CI runner; this file isn't in
// vitest.config.ts's GPU_PIXEL_TESTS list, so unlike every other compositor-demo-dependent test it
// wasn't excluded from the PR jobs — it ran, and failed, everywhere). Mirrors tests/project.test.ts's
// pattern: a real `projects/<name>/assets/…` tree, driven by resolveProject's own `specPath` walk
// (findUp for the nearest ancestor project.json) rather than by project name, so no `--project`
// lookup ever needs to leave the temp dir. prepare() only ever reads these fixture files (video:
// existsSync + a byte copy, no decode; motion: read + sanitized/linted, needs real markup) or
// resolves bare ids against the repo's own assets-lib/backgrounds (untouched by this fixture).
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepare } from "../src/commands/build.js";

const MASK = { source: { kind: "shape", shape: { kind: "rect", x: 0, y: 0, w: 100, h: 100 } }, feather: 4 };
const EFFECTS = [{ kind: "blur", params: { radius: 8 } }];
const BLEND = "screen";

// A minimal Tier-1 motion source that passes resolveMotionGraphic's sanitize + determinism lint —
// same fixture shape tests/motiongraphic.test.ts's own `projWith` helper uses.
const MOTION_HTML = `<style>.b{opacity:1}</style><div class="b"></div>`;

// Builds `<tmp>/projects/demo/{specs,assets}` and returns the spec path. `assets/video.mp4` is a
// placeholder: prepare() only existsSync()s + copyFileSync()s a video segment's source (no ffprobe
// or decode happens before the final render, which this test never reaches), so its bytes don't
// matter. `assets/motion/stat.html` DOES get read and linted, so it needs real markup.
function writeSpec(): string {
  const ws = mkdtempSync(join(tmpdir(), "build-fx-"));
  const projectDir = join(ws, "projects", "demo");
  const specsDir = join(projectDir, "specs");
  const assetsDir = join(projectDir, "assets");
  mkdirSync(specsDir, { recursive: true });
  mkdirSync(join(assetsDir, "motion"), { recursive: true });
  writeFileSync(join(projectDir, "project.json"), "{}");
  writeFileSync(join(assetsDir, "video.mp4"), "fake-mp4");
  writeFileSync(join(assetsDir, "motion", "stat.html"), MOTION_HTML);

  const spec = {
    title: "build-fx-threading",
    format: ["9:16"],
    colors: "midnight", // this project assigns no brand, and a build must declare a palette
    segments: [
      {
        kind: "video",
        source: "video.mp4",
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
  const path = join(specsDir, "spec.json");
  writeFileSync(path, JSON.stringify(spec));
  return path;
}

describe("build.ts threads mask/effects/blend onto every segment kind", () => {
  it("carries an authored mask, effects, and blend from the spec into KinoProps.segments", async () => {
    const specPath = writeSpec();
    // No `project` option: resolveProject walks up from specPath to find project.json, so this
    // never touches projects/compositor-demo or any other named project outside the temp dir.
    const r = await prepare(specPath, { mock: true, format: "9:16" });
    expect(r.props.segments).toHaveLength(3);
    for (const seg of r.props.segments) {
      expect(seg.mask).toEqual(MASK);
      expect(seg.effects).toEqual(EFFECTS);
      expect(seg.blend).toBe(BLEND);
    }
  }, 60000);
});
