import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runScene } from "../src/render/scene/runScene.js";
import { MOTION_LIB_DIR } from "../src/media/motionLib.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9 };
const base = { params: {}, words: [], theme, width: 1080, height: 1920, fps: 30, durationFrames: 10, quality: "draft" as const };
const run = (source: string, extra = {}) => runScene({ source, ...base, ...extra });

describe("runScene", () => {
  it("records objects and per-frame transforms", () => {
    const { timeline } = run(`const b = api.box({ size: [1,1,1], material: api.pbr({ color: "mint" }) });
return (env) => { b.rotation.y = env.progress; };`);
    expect(timeline.objects).toHaveLength(1);
    expect(timeline.objects[0].type).toBe("box");
    expect(timeline.objects[0].material!.color).toBe("#80e2b4"); // palette resolved node-side
    expect(timeline.frames).toHaveLength(10);
    expect(timeline.frames[9].transforms[timeline.objects[0].id].r[1]).toBeCloseTo(9 / 10, 5);
  });
  it("hash is stable across runs and changes with source/params/quality", () => {
    const src = `api.sphere({ radius: 1 }); return () => {};`;
    expect(run(src).hash).toBe(run(src).hash);
    expect(run(src).hash).not.toBe(run(src + " ").hash);
    expect(run(src).hash).not.toBe(run(src, { quality: "final" }).hash);
    expect(run(src).hash).not.toBe(run(src, { params: { x: 1 } }).hash);
  });
  it("camera rig setters are absolute and recorded", () => {
    const { timeline } = run(`const cam = api.camera({ fov: 35 });
return (env) => { cam.dolly(5); cam.dolly(5); };`);
    expect(timeline.frames[0].camera.p[2]).toBe(5);
    expect(timeline.frames[0].camera.fov).toBe(35);
  });
  it("api.random is deterministic; api.params reads base params", () => {
    const { timeline } = run(`const r = api.random(7); const a = r();
const t = api.text3d(String(api.params.text ?? "X"), { size: 1 });
return (env) => { t.position.x = a; };`, { params: { text: "KINO" } });
    const again = run(`const r = api.random(7); const a = r();
const t = api.text3d(String(api.params.text ?? "X"), { size: 1 });
return (env) => { t.position.x = a; };`, { params: { text: "KINO" } });
    expect(timeline.frames[0].transforms[timeline.objects[0].id].p[0]).toBe(again.timeline.frames[0].transforms[again.timeline.objects[0].id].p[0]);
    expect(timeline.objects[0].opts.text).toBe("KINO");
  });
  it("env preset, post, particles seed positions are recorded", () => {
    const { timeline } = run(`api.env("studio");
api.post({ bloom: { strength: 0.4 } });
api.particles(8, { spread: 4, seed: 3, color: "gold", size: 0.05 });
return () => {};`);
    expect(timeline.world).toBe("studio");
    expect(timeline.post!.bloom!.strength).toBe(0.4);
    const parts = timeline.objects.find((o) => o.type === "particles")!;
    expect((parts.opts.positions as number[][]).length).toBe(8); // seeded node-side, python does no random
  });
  it("scene body cannot reach process/require lexically", () => {
    expect(() => run(`return () => { process.exit(1); };`).timeline.frames).toThrow(/process/);
  });
  it("throws when the body does not return a function", () => {
    expect(() => run(`api.box({ size: [1,1,1] });`)).toThrow(/update/);
  });

  // Compatibility bar: the three bundled presets MUST run through runScene unedited and produce a
  // non-empty timeline — they exercise the full api surface (devicePhone/texture/param, camera rig,
  // particles, text3d + geometry.boundingBox, pbr/contactShadow with .material/.scale mutation, post).
  it("runs all three bundled presets and records a non-empty timeline", () => {
    const cases: Array<[string, Record<string, number | string>]> = [
      ["phone-orbit", { screenshot: "shots/dash.png", spin: 0.4, zoom: 1 }],
      ["depth-particles", { intensity: 0.6, color: "mint" }],
      ["wordmark-3d", { text: "KINO", depth: 0.3 }],
    ];
    for (const [id, params] of cases) {
      const src = readFileSync(join(MOTION_LIB_DIR, `${id}.scene.js`), "utf8");
      const { timeline } = run(src, { params });
      expect(timeline.objects.length, id).toBeGreaterThan(0);
      expect(timeline.frames).toHaveLength(10);
    }
  });
});
