// Task 7b: declared layers validate and register a TextureSource (Task 7), but nothing ever
// resolved their `source.src` into content a provider can actually draw — build.ts passed
// spec.layers through verbatim, so every declared layer built successfully and painted nothing.
// This test drives the REAL prepare() pipeline (src/commands/build.ts), exactly like
// tests/build-segment-fx.test.ts, so it exercises the real mapping instead of a hand-built
// KinoProps that would bypass the bug entirely.
//
// Self-contained (review finding 2): this file used to drive prepare() against the
// "compositor-demo" project, whose assets/ dir lives under gitignored projects/ (.gitignore:9) —
// not committed, and present only on a machine that happened to have built it up locally. Unlike
// every other compositor-demo-dependent test (all in vitest.config.ts's GPU_PIXEL_TESTS, excluded
// from the PR jobs), this file wasn't excluded, so `prepare(..., { project: "compositor-demo" })`
// threw `Project 'compositor-demo' not found` on a fresh clone and on every CI runner. It turned
// out to be practical after all — see makeProject() below and its accounting of exactly which
// files each case touches. A "lottie" case is still dropped for the same reason the original
// comment gave: it would be the only assertion depending on a from-scratch Lottie JSON fixture
// authored solely for this task, when build.ts's lottie-kind dispatch is already covered
// elsewhere without any file I/O (tests/layers-declared-registry.test.ts's "registers each source
// kind" case) and resolveMotionGraphic's actual `.json` parsing is covered self-contained,
// end-to-end, by tests/motiongraphic.test.ts's `assertMotionGraphics` Lottie case.
import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepare } from "../src/commands/build.js";

// A minimal Tier-1 motion source that passes resolveMotionGraphic's sanitize + determinism lint —
// same fixture shape tests/motiongraphic.test.ts's own `projWith` helper uses.
const MOTION_HTML = `<style>.b{opacity:1}</style><div class="b"></div>`;

// Builds `<tmp>/projects/demo/{specs,assets}` with exactly the fixture files the cases below read,
// and returns its specs/ dir. Nothing here is decoded: an "image"/still-"video" declared layer only
// existsSync()s + copyFileSync()s its source (see resolveDeclaredLayers in build.ts), so a
// zero-byte placeholder is enough — except assets/motion/stat.html, which IS read and linted, so
// it needs real markup. "shader" cases ("aurora-flow", "brand-wash") are bare ids that resolve
// against the repo's own assets-lib/backgrounds/ (untouched by this fixture, and shipped in the
// repo) — no project asset needed for either.
function makeProject(): string {
  const ws = mkdtempSync(join(tmpdir(), "layers-resolve-"));
  const projectDir = join(ws, "projects", "demo");
  const specsDir = join(projectDir, "specs");
  const assetsDir = join(projectDir, "assets");
  mkdirSync(specsDir, { recursive: true });
  mkdirSync(join(assetsDir, "motion"), { recursive: true });
  writeFileSync(join(projectDir, "project.json"), "{}");
  writeFileSync(join(assetsDir, "calendar.png"), "fake-png");
  writeFileSync(join(assetsDir, "notes.png"), "fake-png");
  writeFileSync(join(assetsDir, "video.mp4"), "fake-mp4");
  writeFileSync(join(assetsDir, "motion", "stat.html"), MOTION_HTML);
  return specsDir;
}

// `layers` omitted entirely (not `[]`) reproduces the original "no declared layers" case exactly:
// `resolveDeclaredLayers(undefined, ...)` returns `undefined` right back, so `r.props.layers` is
// `undefined` rather than `[]`.
function writeSpec(specsDir: string, layers?: unknown[]): string {
  const spec: Record<string, unknown> = {
    title: "declared-layer-resolve",
    format: ["9:16"],
    segments: [{ kind: "scene", text: "hook", caption: "hook" }],
  };
  if (layers !== undefined) spec.layers = layers;
  // Unique filename per call: several cases share one makeProject() specs/ dir.
  const path = join(specsDir, `spec-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify(spec));
  return path;
}

describe("build.ts resolves declared-layer sources node-side", () => {
  it("populates url/shaderCode/graphic for image, video, shader, and motion layers", async () => {
    const specsDir = makeProject();
    const specPath = writeSpec(specsDir, [
      { id: "declaredImage", z: 301, source: { kind: "image", src: "calendar.png" } },
      { id: "declaredVideo", z: 302, source: { kind: "video", src: "notes.png" } },
      { id: "declaredShader", z: 303, source: { kind: "shader", src: "aurora-flow" } },
      { id: "declaredMotion", z: 304, source: { kind: "motion", src: "motion/stat.html" } },
    ]);
    const r = await prepare(specPath, { mock: true, format: "9:16" });
    const byId = Object.fromEntries((r.props.layers ?? []).map((l) => [l.id, l]));

    expect(byId.declaredImage?.source?.url).toBe("calendar.png");
    // "video" kind with a still-image src resolves the same way "image" does (mirrors the seg{i}/
    // frame{i} still-image fallback already in registry.ts).
    expect(byId.declaredVideo?.source?.url).toBe("notes.png");
    expect(byId.declaredShader?.source?.shaderCode).toBeTruthy();
    expect(byId.declaredShader!.source!.shaderCode!.length).toBeGreaterThan(0);
    expect(byId.declaredMotion?.source?.graphic?.html).toBeTruthy();
  }, 60000);

  // Finding 4: resolveBackgroundComponent resolves a bare id against the WHOLE backgrounds
  // library, which holds both .frag/.glsl shaders and .js Canvas2D draw components — "brand-wash"
  // is one of the latter (assets-lib/backgrounds/brand-wash.js, committed). Without isShaderPath,
  // this would read the JS as GLSL, register it, and only fail during the first seek.
  it('fails the build with the layer id when a bare shader id resolves to a Canvas2D (.js) component', async () => {
    const specPath = writeSpec(makeProject(), [{ id: "declaredShader", z: 303, source: { kind: "shader", src: "brand-wash" } }]);
    await expect(prepare(specPath, { mock: true, format: "9:16" })).rejects.toThrow(
      /declaredShader.*not a shader|not a shader.*declaredShader/s,
    );
  }, 60000);

  it("stages the image/video files under _public so the page can actually fetch them", async () => {
    const specsDir = makeProject();
    const specPath = writeSpec(specsDir, [{ id: "declaredImage", z: 301, source: { kind: "image", src: "calendar.png" } }]);
    const r = await prepare(specPath, { mock: true, format: "9:16" });
    expect(existsSync(join(r.publicDir, "calendar.png"))).toBe(true);
  }, 60000);

  it("fails the build with the layer id in the message when an image source is missing", async () => {
    const specPath = writeSpec(makeProject(), [{ id: "leak", z: 301, source: { kind: "image", src: "does-not-exist.png" } }]);
    await expect(prepare(specPath, { mock: true, format: "9:16" })).rejects.toThrow(
      /leak.*does-not-exist\.png|does-not-exist\.png.*leak/s,
    );
  }, 60000);

  it('fails loudly (not silently) for a declared "video" layer pointed at a real video file', async () => {
    // GAP (see report): videoFrames.ts's planMediaJobs walks props.segments/avatarWindows only, so
    // a declared video layer never gets a MediaEntry — frame extraction isn't wired for it yet.
    // Staging the file and calling it "resolved" would reproduce exactly the silent-nothing bug
    // this task exists to close (registry.ts's `if (!source) return` no-ops a missing TextureSource
    // with no error). This must throw instead, naming the layer.
    const specPath = writeSpec(makeProject(), [{ id: "ghost", z: 301, source: { kind: "video", src: "video.mp4" } }]);
    await expect(prepare(specPath, { mock: true, format: "9:16" })).rejects.toThrow(/ghost/);
  }, 60000);

  it("adjustment layer (no source) passes through unaffected", async () => {
    const specPath = writeSpec(makeProject(), [{ id: "grade", z: 650, adjust: [{ kind: "grade", params: { contrast: 1.1 } }] }]);
    const r = await prepare(specPath, { mock: true, format: "9:16" });
    expect(r.props.layers).toEqual([{ id: "grade", z: 650, adjust: [{ kind: "grade", params: { contrast: 1.1 } }] }]);
  }, 60000);

  it("a spec with no declared layers is unaffected", async () => {
    const specPath = writeSpec(makeProject());
    const r = await prepare(specPath, { mock: true, format: "9:16" });
    expect(r.props.layers).toBeUndefined();
  }, 60000);
});
