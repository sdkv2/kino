import { describe, it, expect } from "vitest";
import { lintSceneJs, extractSceneAssets } from "../src/render/scene.js";

const ok = `const p = api.devicePhone({ screen: api.texture("shots/dash.png") });
api.env("studio");
return (env) => { p.rotation.y = env.progress; };`;

describe("lintSceneJs", () => {
  it("passes a clean scene", () => expect(lintSceneJs(ok)).toEqual([]));
  it("bans Math.random with api.random pointer", () => {
    expect(lintSceneJs("const r = Math.random(); return () => {};").join()).toMatch(/api\.random/);
  });
  it("bans wall clock", () => expect(lintSceneJs("return () => { const t = Date.now(); };")).not.toEqual([]));
  it("bans DOM access", () => expect(lintSceneJs("document.title; return () => {};")).not.toEqual([]));
  it("bans timers", () => expect(lintSceneJs("setTimeout(() => {}, 1); return () => {};")).not.toEqual([]));
  it("bans dynamic code", () => expect(lintSceneJs("eval('1'); return () => {};")).not.toEqual([]));
  it("ignores banned words inside strings and comments", () => {
    expect(lintSceneJs(`// Math.random note\nconst s = "window.x"; return () => {};`)).toEqual([]);
  });
});

describe("extractSceneAssets", () => {
  it("extracts literal texture/gltf paths", () => {
    const src = `api.texture("a.png"); api.gltf('m/phone.glb'); return () => {};`;
    expect(extractSceneAssets(src, {}).assets.sort()).toEqual(["a.png", "m/phone.glb"]);
  });
  it("resolves api.param refs through spec params", () => {
    const src = `api.texture(api.param("screenshot")); return () => {};`;
    const r = extractSceneAssets(src, { screenshot: "shots/dash.png" });
    expect(r.assets).toEqual(["shots/dash.png"]);
    expect(r.violations).toEqual([]);
  });
  it("flags api.param with a missing or non-string param", () => {
    const r = extractSceneAssets(`api.texture(api.param("shot")); return () => {};`, {});
    expect(r.violations.join()).toMatch(/shot/);
  });
  it("flags non-literal asset args", () => {
    const r = extractSceneAssets(`const p = "a.png"; api.texture(p); return () => {};`, {});
    expect(r.violations.join()).toMatch(/string literal|api\.param/);
  });
  it("dedupes repeated paths", () => {
    const src = `api.texture("a.png"); api.texture("a.png"); return () => {};`;
    expect(extractSceneAssets(src, {}).assets).toEqual(["a.png"]);
  });
  it("rejects traversal and absolute paths", () => {
    expect(extractSceneAssets(`api.texture("../x.png"); return () => {};`, {}).violations).not.toEqual([]);
    expect(extractSceneAssets(`api.texture("/etc/x.png"); return () => {};`, {}).violations).not.toEqual([]);
  });
});
