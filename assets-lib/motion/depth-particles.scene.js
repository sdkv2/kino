// Abstract depth field: seeded particles, slow dolly, palette fog. Seam-safe (edge-curve drift).
// params: intensity (0..1, default 0.6) · color (palette name, default "mint")
const field = api.particles(420, { spread: 9, size: 0.045, seed: 11, color: "mint" });
const glow = api.particles(60, { spread: 6, size: 0.11, seed: 23, color: "gold" });
api.ambient({ intensity: 0.8 });
const cam = api.camera({ fov: 55 });

return (env) => {
  const k = Number(env.params.intensity ?? 0.6);
  field.rotation.y = env.progress * 0.5 * k;
  field.rotation.x = env.progress * 0.12 * k;
  glow.rotation.y = -env.progress * 0.3 * k;
  cam.dolly(7 - env.edge * 1.6 * k);
  glow.scale.setScalar(1 + env.pulse * 0.2);
};
