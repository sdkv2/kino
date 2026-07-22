import { describe, it, expect } from "vitest";
import { createRecordApi } from "../src/render/scene/recordApi.js";
import { runScene } from "../src/render/scene/runScene.js";

const palette = { mint: "#80e2b4", green: "#0c8d64", night: "#0b1020", white: "#ffffff", gold: "#d99a20" };
const mk = (extra: object = {}) =>
  createRecordApi({ baseParams: {}, palette, ...extra });

describe("api.screen", () => {
  it("resolves an html path through the screens map", () => {
    const r = mk({ screens: { "screens/dash.html": { dir: "_screens/abc123", frames: 90 } } });
    const api = r.api as Record<string, any>;
    const h = api.screen("screens/dash.html");
    expect(h).toEqual({ path: "_screens/abc123", frames: 90 });
  });

  it("passes non-html paths through as a plain texture", () => {
    const api = mk().api as Record<string, any>;
    expect(api.screen("shots/dash.png")).toEqual({ path: "shots/dash.png" });
  });

  it("throws for an html path missing from the map", () => {
    const api = mk().api as Record<string, any>;
    expect(() => api.screen("screens/dash.html")).toThrow(/raster/);
  });

  it("devicePhone records screenFrames for an animated screen", () => {
    const r = mk({ screens: { "screens/dash.html": { dir: "_screens/abc123", frames: 90 } } });
    const api = r.api as Record<string, any>;
    api.devicePhone({ screen: api.screen("screens/dash.html") });
    const phone = r.objects.find((o) => o.type === "devicePhone")!;
    expect(phone.opts.screen).toBe("_screens/abc123");
    expect(phone.opts.screenFrames).toBe(90);
  });
});

describe("api.layer", () => {
  const layers = { "svg/logo.svg": { path: "_layers/def456.png", aspect: 0.5 } };

  it("records a layer object with raster path, aspect and defaults", () => {
    const r = mk({ layers });
    const api = r.api as Record<string, any>;
    const h = api.layer("svg/logo.svg", { z: 0.3, material: "emissive", emission: 2 });
    const obj = r.objects.find((o) => o.type === "layer")!;
    expect(obj.opts).toEqual({ path: "_layers/def456.png", aspect: 0.5, width: 1, material: "emissive", emission: 2 });
    expect(h.position.z).toBe(0.3);
    // opacity animates via the handle material
    h.material!.opacity = 0.5;
    expect(r.snapshot().transforms[obj.id].opacity).toBe(0.5);
  });

  it("throws for an svg missing from the map", () => {
    const api = mk().api as Record<string, any>;
    expect(() => api.layer("svg/logo.svg")).toThrow(/raster/);
  });

  it("throws when two layers share an initial z (z-fighting)", () => {
    const api = mk({ layers }).api as Record<string, any>;
    api.layer("svg/logo.svg", { z: 0.3 });
    expect(() => api.layer("svg/logo.svg", { z: 0.31 })).toThrow(/z/);
  });
});

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9 };

describe("runScene raster threading", () => {
  const source = `const p = api.devicePhone({ screen: api.screen("screens/dash.html") });
return (env) => { p.rotation.y = env.progress; };`;
  const run = (dir: string) =>
    runScene({
      source, params: {}, words: [], theme, width: 270, height: 480, fps: 30, durationFrames: 2,
      quality: "draft", screens: { "screens/dash.html": { dir, frames: 2 } },
    });

  it("hash busts when the screen raster digest changes", () => {
    expect(run("_screens/aaa").hash).not.toBe(run("_screens/bbb").hash);
    expect(run("_screens/aaa").hash).toBe(run("_screens/aaa").hash);
  });
});
