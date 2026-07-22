import { describe, it, expect } from "vitest";
import { extractSceneAssets, extractSceneRefs, svgAspect } from "../src/render/scene.js";

describe("extractSceneRefs", () => {
  it("categorizes screen and layer calls, literal and param forms", () => {
    const src = `
      const p = api.devicePhone({ screen: api.screen(api.param("screenshot")) });
      const l = api.layer("svg/logo.svg", { z: 0.3 });
      const t = api.texture("tex/wood.png");
      return () => {};`;
    const refs = extractSceneRefs(src, { screenshot: "screens/dash.html" });
    expect(refs.screens).toEqual(["screens/dash.html"]);
    expect(refs.layers).toEqual(["svg/logo.svg"]);
    expect(refs.violations).toEqual([]);
  });

  it("screen with a non-html path is not a raster ref (png passthrough)", () => {
    const refs = extractSceneRefs(`api.screen("shots/dash.png"); return () => {};`, {});
    expect(refs.screens).toEqual([]);
    expect(refs.violations).toEqual([]);
  });

  it("layer must be an svg", () => {
    const refs = extractSceneRefs(`api.layer("img/logo.png"); return () => {};`, {});
    expect(refs.violations.some((v) => v.includes(".svg"))).toBe(true);
  });

  it("ignores calls inside comments", () => {
    const refs = extractSceneRefs(`// api.layer("svg/ghost.svg")\nreturn () => {};`, {});
    expect(refs.layers).toEqual([]);
  });

  it("extractSceneAssets now includes screen/layer paths for staging", () => {
    const src = `api.screen("screens/dash.html"); api.layer("svg/logo.svg"); return () => {};`;
    const { assets, violations } = extractSceneAssets(src, {});
    expect(assets).toContain("screens/dash.html");
    expect(assets).toContain("svg/logo.svg");
    expect(violations).toEqual([]);
  });
});

describe("svgAspect", () => {
  it("reads viewBox", () => {
    expect(svgAspect(`<svg viewBox="0 0 200 100"></svg>`)).toBeCloseTo(0.5);
  });
  it("falls back to width/height attrs", () => {
    expect(svgAspect(`<svg width="100" height="300"></svg>`)).toBeCloseTo(3);
  });
  it("throws without dimensions", () => {
    expect(() => svgAspect(`<svg></svg>`)).toThrow(/viewBox/);
  });
});
