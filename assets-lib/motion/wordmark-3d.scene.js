// CTA end card: extruded metallic wordmark, studio reflections, bloom on the speculars, grounded by
// a fake contact shadow. Full-turn progress rotation → first and last frames match (seamlessLoop).
// params: text (default "KINO") · depth (default 0.3)
const mark = api.text3d(String(api.params.text ?? "KINO"), {
  size: 1.1,
  depth: Number(api.params.depth ?? 0.3),
  // Polished metal: the studio env is strip softboxes, so the face catches thin highlight streaks
  // (not a full-face wash), and polished metal reads premium without blooming to a blob.
  // Brushed metal: roughness 0.4 spreads+dims the specular so the broad oblique face mid-spin reads
  // as grey metal (below bloom threshold), not a clipped white blob; the facing frames keep a clean
  // sheen. envMapIntensity 0.8 keeps reflections off pure white.
  material: api.pbr({ color: "white", metalness: 0.85, roughness: 0.4, envMapIntensity: 0.8 }),
});
mark.position.y = 0.35; // raise to optical centre (~42% from top), not dead-centre
api.contactShadow({ radius: 1.4, opacity: 0.35, y: -1.2 });
api.env("studio");
api.dirLight({ intensity: 1.4, position: [1.5, 2.5, 3] });
// Bloom only the true specular hotspots into glints: threshold 0.9 excludes the mid-grey face (so an
// oblique frame stays metal, not a haze); tight radius keeps the glow local.
api.post({ bloom: { strength: 0.4, radius: 0.3, threshold: 0.9 } });
const cam = api.camera({ fov: 30 });

// Fit the mark to ~80% of the 9:16 frame width whatever the text length — portrait visible
// half-width at radius 7 / fov 30 is ≈1.06 world units, and long wordmarks otherwise clip.
mark.geometry.computeBoundingBox();
const bb = mark.geometry.boundingBox;
const fit = Math.min(1, 1.7 / Math.max(0.001, bb.max.x - bb.min.x));

// Double-smoothstep the spin: smoothstep(inout) again → the sweep lingers longer at the readable
// front-facing ends and moves through the edge-on middle faster. Still 0→1 over the beat, so the
// full 2π turn stays seamlessLoop-safe (first frame == last frame).
const smooth = (x) => x * x * (3 - 2 * x);

return (env) => {
  mark.rotation.y = smooth(env.inout) * Math.PI * 2;
  mark.scale.setScalar(fit * (0.92 + env.out * 0.08 + env.pulse * 0.04));
  cam.orbit({ radius: 7, y: 0.3 + (1 - env.out) * 0.8, angle: 0 });
};
