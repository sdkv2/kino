// Device product shot: rounded-slab phone, spec screenshot on screen, orbit + progress push-in.
// params: screenshot (required asset path) · spin (turns, default 0.35) · zoom (default 1)
const phone = api.devicePhone({ screen: api.texture(api.param("screenshot")) });
api.env("studio");
api.dirLight({ intensity: 2.4, position: [2.5, 3, 2] });
api.hemi({ intensity: 0.5 });
const cam = api.camera({ fov: 32 });

return (env) => {
  const spin = Number(env.params.spin ?? 0.35);
  phone.rotation.y = -0.5 + env.inout * spin * Math.PI * 2;
  phone.rotation.x = 0.05 + Math.sin(env.progress * Math.PI) * 0.06;
  phone.position.y = (1 - env.out) * -0.6;
  phone.scale.setScalar(1 + env.pulse * 0.05);
  cam.orbit({ radius: 5.2 / Math.max(0.05, Number(env.params.zoom ?? 1)), y: 0.35, angle: 0.25 - env.progress * 0.4 });
  cam.zoom(1 + env.out * 0.12);
};
