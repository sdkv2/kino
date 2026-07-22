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

// Fit the mark to ~86% of the 9:16 frame width whatever the text length — portrait visible
// half-width at radius 7 / fov 30 is ≈1.06 world units, and long wordmarks otherwise clip.
mark.geometry.computeBoundingBox();
const bb = mark.geometry.boundingBox;
const fit = Math.min(1, 1.82 / Math.max(0.001, bb.max.x - bb.min.x));

return (env) => {
  mark.rotation.y = env.inout * Math.PI * 2;
  mark.scale.setScalar(fit * (0.92 + env.out * 0.08 + env.pulse * 0.04));
  cam.orbit({ radius: 7, y: 0.3 + (1 - env.out) * 0.8, angle: 0 });
};
