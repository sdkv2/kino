import { describe, it, expect } from "vitest";
import { createSceneApi, settleScene } from "../src/render/native/page/scene/api.js";

const palette = { mint: "#80e2b4", green: "#0c8d64", night: "#0b1020", white: "#fff", gold: "#d99a20", font: "Arial" };
const stubLoaders = {
  texture: async () => ({ isTexture: true, colorSpace: "", dispose() {} }) as never,
  gltf: async () => (new (await import("three")).Group()) as never,
};
const ctx = () => createSceneApi({ baseParams: { shot: "a.png" }, palette, width: 1080, height: 1920, loaders: stubLoaders });

describe("scene api", () => {
  it("api.box adds a mesh to the root", () => {
    const c = ctx();
    const m = c.api.box({ size: [1, 2, 3], material: c.api.pbr({ color: "mint" }) });
    expect(c.root.children).toContain(m);
  });
  it("api.pbr resolves palette color names", () => {
    const c = ctx();
    const mat = c.api.pbr({ color: "gold" });
    expect(mat.color.getHexString()).toBe("d99a20");
  });
  it("camera orbit positions on the ring and looks at origin", () => {
    const c = ctx();
    const cam = c.api.camera({ fov: 35 });
    cam.orbit({ radius: 5, y: 1, angle: Math.PI / 2 });
    expect(cam.three.position.x).toBeCloseTo(5);
    expect(cam.three.position.y).toBeCloseTo(1);
    expect(cam.three.position.z).toBeCloseTo(0, 5);
  });
  it("camera dolly is absolute (idempotent across frames, not accumulating)", () => {
    const c = ctx();
    const cam = c.api.camera({ fov: 35 });
    cam.dolly(5);
    cam.dolly(5); // update(env) reruns every frame — a relative op would accumulate
    expect(cam.three.position.z).toBe(5);
  });
  it("api.random(seed) is deterministic", () => {
    const c = ctx();
    const a = c.api.random(7), b = c.api.random(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it("api.particles builds an InstancedMesh with count instances", () => {
    const c = ctx();
    const p = c.api.particles(64, { spread: 8, seed: 3, color: "mint", size: 0.05 });
    expect(p.count).toBe(64);
  });
  it("api.text3d builds centered extruded geometry", () => {
    const c = ctx();
    const t = c.api.text3d("KINO", { size: 1, depth: 0.25 });
    expect(c.root.children).toContain(t);
    t.geometry.computeBoundingBox();
    const bb = t.geometry.boundingBox!;
    expect(bb.max.x + bb.min.x).toBeCloseTo(0, 1); // centered
  });
  it("api.texture registers a pending load settled by settleScene", async () => {
    const c = ctx();
    c.api.texture("a.png");
    expect(await settleScene()).toBe(true);
    expect(await settleScene()).toBe(false);
  });
  it("api.param resolves through baseParams in api.texture", () => {
    const c = ctx();
    expect(() => c.api.texture(c.api.param("shot"))).not.toThrow();
  });
  it("api.devicePhone returns a group with a screen mesh", () => {
    const c = ctx();
    const d = c.api.devicePhone({ screen: c.api.texture("a.png") });
    expect(d.children.length).toBeGreaterThanOrEqual(2); // body + screen
  });
  it("api.pbr with clearcoat upgrades to MeshPhysicalMaterial", () => {
    const c = ctx();
    const mat = c.api.pbr({ color: "white", metalness: 0.8, clearcoat: 0.6, clearcoatRoughness: 0.25 });
    expect((mat as { isMeshPhysicalMaterial?: boolean }).isMeshPhysicalMaterial).toBe(true);
    expect((mat as { clearcoat: number }).clearcoat).toBeCloseTo(0.6);
    expect(mat.metalness).toBeCloseTo(0.8); // existing options still apply
  });
  it("api.pbr without clearcoat stays MeshStandardMaterial", () => {
    const c = ctx();
    const mat = c.api.pbr({ color: "gold" });
    expect((mat as { isMeshPhysicalMaterial?: boolean }).isMeshPhysicalMaterial).toBeUndefined();
    expect(mat.isMeshStandardMaterial).toBe(true);
  });
  it("api.contactShadow returns a mesh added to root (fake, no light)", () => {
    const c = ctx();
    const s = c.api.contactShadow({ radius: 1.2, opacity: 0.4, y: -0.9 });
    expect(c.root.children).toContain(s);
    expect((s as { isMesh?: boolean }).isMesh).toBe(true);
    expect(s.material.transparent).toBe(true);
  });
  it("api.post stores bloom config retrievable by the Scene3D contract", () => {
    const c = ctx();
    expect(c.post()).toBeNull(); // nothing declared → direct render path
    c.api.post({ bloom: { strength: 0.7, radius: 0.4, threshold: 0.85 } });
    expect(c.post()?.bloom?.strength).toBeCloseTo(0.7);
    expect(c.post()?.bloom?.threshold).toBeCloseTo(0.85);
  });
});
