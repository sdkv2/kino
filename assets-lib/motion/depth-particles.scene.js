// Abstract depth field: seeded particles, slow dolly, palette fog. Seam-safe: all visible motion is
// driven by env.edge (sin(progress·π), 0 at both beat ends) so first and last frames match — loops clean.
// params: intensity (0..1, default 0.6) · color (field color, palette name, read at build time, default "mint")
const field = api.particles(420, { spread: 9, size: 0.038, seed: 11, color: String(api.params.color ?? "mint") });
const glow = api.particles(60, { spread: 6, size: 0.09, seed: 23, color: "gold" });
api.ambient({ intensity: 0.9 });
// Low-strength bloom, threshold 0 → the small bright points glow instead of reading as flat dots.
api.post({ bloom: { strength: 0.55, radius: 0.6, threshold: 0 } });
const cam = api.camera({ fov: 55 });

return (env) => {
  const k = Number(env.params.intensity ?? 0.6);
  // env.edge, not env.progress: progress is nonzero at the beat's end and would jump-cut the loop seam.
  field.rotation.y = env.edge * 0.5 * k;
  field.rotation.x = env.edge * 0.12 * k;
  glow.rotation.y = -env.edge * 0.3 * k;
  cam.dolly(7 - env.edge * 1.6 * k);
  glow.scale.setScalar(1 + env.pulse * 0.2);
};
