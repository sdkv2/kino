import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { resolveBlender, renderTimeline } from "../src/media/blender.js";
import { runScene } from "../src/render/scene/runScene.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9 };
const blender = resolveBlender();
if (!blender) console.warn("blenderRender tests SKIPPED — no Blender >= 4.2 found");
const maybe = blender ? describe : describe.skip;

/** Hash decoded RGBA — Blender PNG bytes can drift while pixels stay identical. */
function rgbaSha(p: string): string {
  return createHash("sha1").update(execFileSync("magick", [p, "rgba:-"])).digest("hex");
}

maybe("blender render", () => {
  const scene = `const b = api.box({ size: [2,2,2], material: api.pbr({ color: "mint" }) });
api.env("studio");
const cam = api.camera({ fov: 40 });
return (env) => { b.rotation.y = env.progress; cam.dolly(6); };`;
  const tl = () => runScene({ source: scene, params: {}, words: [], theme, width: 270, height: 480, fps: 30, durationFrames: 3, quality: "draft" }).timeline;

  it("renders eevee draft frames with transparency, pixel-stable across runs", async () => {
    const a = mkdtempSync(join(tmpdir(), "kino-bla-"));
    const b2 = mkdtempSync(join(tmpdir(), "kino-blb-"));
    await renderTimeline({ timeline: tl(), outDir: a, publicDir: a, blenderBin: blender!.bin });
    await renderTimeline({ timeline: tl(), outDir: b2, publicDir: b2, blenderBin: blender!.bin });
    for (const f of ["f00001.png", "f00002.png", "f00003.png"]) {
      expect(existsSync(join(a, f))).toBe(true);
      expect(rgbaSha(join(a, f))).toBe(rgbaSha(join(b2, f)));
    }
    // Mint cube must actually paint something (transparent film alone is a silent empty render).
    const amax = Number(execFileSync("magick", [join(a, "f00001.png"), "-format", "%[fx:maxima.a]", "info:"], { encoding: "utf8" }));
    expect(amax).toBeGreaterThan(0);
  }, 300000);

  it("renders a 1-frame cycles smoke", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-blc-"));
    const t = runScene({ source: scene, params: {}, words: [], theme, width: 270, height: 480, fps: 30, durationFrames: 1, quality: "final" }).timeline;
    (t.meta as { quality: string }).quality = "final";
    await renderTimeline({ timeline: t, outDir: dir, publicDir: dir, blenderBin: blender!.bin });
    expect(existsSync(join(dir, "f00001.png"))).toBe(true);
  }, 300000);
});

describe("resolveBlender", () => {
  it("returns null or a versioned binary", () => {
    const r = resolveBlender();
    if (r) expect(r.version).toMatch(/^\d+\.\d+/);
  });
});
