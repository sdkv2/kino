// CTA end card: extruded metallic wordmark, studio reflections, orbit-and-settle. Full-turn
// progress rotation → first and last frames match (seamlessLoop-compatible).
// params: text (default "KINO") · depth (default 0.3)
const mark = api.text3d(String(api.params.text ?? "KINO"), {
  size: 1.1,
  depth: Number(api.params.depth ?? 0.3),
  material: api.pbr({ color: "white", metalness: 0.85, roughness: 0.25, envMapIntensity: 1.2 }),
});
api.env("studio");
api.dirLight({ intensity: 1.6, position: [1.5, 2.5, 3] });
const cam = api.camera({ fov: 30 });

return (env) => {
  mark.rotation.y = env.inout * Math.PI * 2;
  mark.scale.setScalar(0.92 + env.out * 0.08 + env.pulse * 0.04);
  cam.orbit({ radius: 6, y: 0.3 + (1 - env.out) * 0.8, angle: 0 });
};
