// Task 7b: declared layers validate and register a TextureSource (Task 7), but nothing ever
// resolved their `source.src` into content a provider can actually draw — build.ts passed
// spec.layers through verbatim, so every declared layer built successfully and painted nothing.
// This test drives the REAL prepare() pipeline (src/commands/build.ts) against the compositor-demo
// fixture project, exactly like tests/build-segment-fx.test.ts, so it exercises the real mapping
// instead of a hand-built KinoProps that would bypass the bug entirely.
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepare } from "../src/commands/build.js";

function writeSpec(layers: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "layers-resolve-"));
  const spec = {
    title: "declared-layer-resolve",
    format: ["9:16"],
    segments: [{ kind: "scene", text: "hook", caption: "hook" }],
    layers,
  };
  const path = join(dir, "spec.json");
  writeFileSync(path, JSON.stringify(spec));
  return path;
}

describe("build.ts resolves declared-layer sources node-side", () => {
  it("populates url/shaderCode/graphic for image, video, shader, motion, and lottie layers", async () => {
    const specPath = writeSpec([
      { id: "declaredImage", z: 301, source: { kind: "image", src: "refs/macos-apps/calendar.png" } },
      { id: "declaredVideo", z: 302, source: { kind: "video", src: "refs/macos-apps/notes.png" } },
      { id: "declaredShader", z: 303, source: { kind: "shader", src: "aurora-flow" } },
      { id: "declaredMotion", z: 304, source: { kind: "motion", src: "motion/stat.html" } },
      { id: "declaredLottie", z: 305, source: { kind: "lottie", src: "motion/tiny.json" } },
    ]);
    const r = await prepare(specPath, { mock: true, format: "9:16", project: "compositor-demo" });
    const byId = Object.fromEntries((r.props.layers ?? []).map((l) => [l.id, l]));

    expect(byId.declaredImage?.source?.url).toBe("refs/macos-apps/calendar.png");
    // "video" kind with a still-image src resolves the same way "image" does (mirrors the seg{i}/
    // frame{i} still-image fallback already in registry.ts).
    expect(byId.declaredVideo?.source?.url).toBe("refs/macos-apps/notes.png");
    expect(byId.declaredShader?.source?.shaderCode).toBeTruthy();
    expect(byId.declaredShader!.source!.shaderCode!.length).toBeGreaterThan(0);
    expect(byId.declaredMotion?.source?.graphic?.html).toBeTruthy();
    expect(byId.declaredLottie?.source?.graphic?.lottie).toBeTruthy();
  }, 60000);

  it("stages the image/video files under _public so the page can actually fetch them", async () => {
    // Deliberately NOT under assets/motion/ — build.ts already blanket-stages every non-.html/.js/
    // .json file in that directory regardless of whether anything references it (see build.ts's
    // motionAssets loop), which would make this assertion pass even without this task's fix.
    // refs/macos-apps/ isn't touched by that loop, so staging it only happens if the new
    // declared-layer resolution pass actually calls stageAsset.
    const specPath = writeSpec([{ id: "declaredImage", z: 301, source: { kind: "image", src: "refs/macos-apps/calendar.png" } }]);
    const r = await prepare(specPath, { mock: true, format: "9:16", project: "compositor-demo" });
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(r.publicDir, "refs/macos-apps/calendar.png"))).toBe(true);
  }, 60000);

  it("fails the build with the layer id in the message when an image source is missing", async () => {
    const specPath = writeSpec([{ id: "leak", z: 301, source: { kind: "image", src: "refs/macos-apps/does-not-exist.png" } }]);
    await expect(prepare(specPath, { mock: true, format: "9:16", project: "compositor-demo" })).rejects.toThrow(
      /leak.*does-not-exist\.png|does-not-exist\.png.*leak/s,
    );
  }, 60000);

  it('fails loudly (not silently) for a declared "video" layer pointed at a real video file', async () => {
    // GAP (see report): videoFrames.ts's planMediaJobs walks props.segments/avatarWindows only, so
    // a declared video layer never gets a MediaEntry — frame extraction isn't wired for it yet.
    // Staging the file and calling it "resolved" would reproduce exactly the silent-nothing bug
    // this task exists to close (registry.ts's `if (!source) return` no-ops a missing TextureSource
    // with no error). This must throw instead, naming the layer.
    const specPath = writeSpec([{ id: "ghost", z: 301, source: { kind: "video", src: "pexels/7846593.mp4" } }]);
    await expect(prepare(specPath, { mock: true, format: "9:16", project: "compositor-demo" })).rejects.toThrow(/ghost/);
  }, 60000);

  it("adjustment layer (no source) passes through unaffected", async () => {
    const specPath = writeSpec([{ id: "grade", z: 650, adjust: [{ kind: "grade", params: { contrast: 1.1 } }] }]);
    const r = await prepare(specPath, { mock: true, format: "9:16", project: "compositor-demo" });
    expect(r.props.layers).toEqual([{ id: "grade", z: 650, adjust: [{ kind: "grade", params: { contrast: 1.1 } }] }]);
  }, 60000);

  it("a spec with no declared layers is unaffected", async () => {
    const dir = mkdtempSync(join(tmpdir(), "layers-resolve-none-"));
    const spec = { title: "no-layers", format: ["9:16"], segments: [{ kind: "scene", text: "hook", caption: "hook" }] };
    const path = join(dir, "spec.json");
    writeFileSync(path, JSON.stringify(spec));
    const r = await prepare(path, { mock: true, format: "9:16", project: "compositor-demo" });
    expect(r.props.layers).toBeUndefined();
  }, 60000);
});
