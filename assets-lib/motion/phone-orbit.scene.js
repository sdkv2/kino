// Device product shot: rounded-slab phone, spec screenshot on screen, swept 3/4 reveal + push-in.
// params: screenshot (required asset path) · spin (yaw sweep in half-turns, default 0.35 ≈ 63°) · zoom (default 1)
const phone = api.devicePhone({ screen: api.texture(api.param("screenshot")) });
api.env("studio");
api.dirLight({ intensity: 2.4, position: [2.5, 3, 2] });
api.hemi({ intensity: 0.5 });
const cam = api.camera({ fov: 32 });

return (env) => {
  // Symmetric yaw sweep: starts angled left, settles angled right — the screen stays readable
  // all beat (a full turn ends edge-on and loses the money shot).
  const sweep = Math.PI * Math.max(0.05, Number(env.params.spin ?? 0.35));
  phone.rotation.y = -sweep / 2 + env.inout * sweep;
  phone.rotation.x = 0.05 + Math.sin(env.progress * Math.PI) * 0.06;
  // Settle at +0.25 (not 0): keeps the device above kino's lower-third caption band, so the
  // caption never parks on the screen.
  phone.position.y = 0.25 + (1 - env.out) * -0.85;
  phone.scale.setScalar(1 + env.pulse * 0.05);
  // 9:16 portrait: device ~2/3 frame height at radius 6.4; spec zoom keyframes push in (min-clamped
  // so a keyframed zoom can't shove the camera inside the device).
  cam.orbit({ radius: 6.4 / Math.max(0.5, Number(env.params.zoom ?? 1)), y: 0.35, angle: 0.18 - env.progress * 0.3 });
  cam.zoom(1 + env.out * 0.08);
};
