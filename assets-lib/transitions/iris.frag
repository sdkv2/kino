// iris — a circular reveal opening from the centre.
//
// Reference for the author-supplied transition contract. Copy this file, change the shape.
//
//   available:  kinoFrom(uv) / kinoTo(uv)  — the two beats, already composited
//               kinoUv(fragCoord)          — fragCoord → uv
//               uP                         — 0 at the first overlapping frame, 1 at the last
//               uRes / iResolution         — framebuffer size
//               u_<name>                   — any NUMERIC key you put in transitionParams
//
//   contract:   exactly kinoFrom at uP=0, exactly kinoTo at uP=1. A transition that is a hair off
//               at either endpoint pops on every beat boundary. Reach both ends deliberately —
//               here the radius starts below zero and finishes past the far corner.
//
//   spec:       { "transition": "custom", "transitionSource": "iris",
//                 "transitionParams": { "softness": 0.04, "aspect": 1.0 } }

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = kinoUv(fragCoord);

  // u_softness: edge feather. u_aspect: 1.0 = a true circle in pixels, 0.0 = an ellipse that
  // matches the frame's own aspect. Both default to 0 when the spec omits them, so read them with
  // a sensible floor rather than assuming they are set.
  // `> 0.0 ? : <default>`: an omitted key is zero-filled by the engine, and 0 is a legal but
  // near-hard edge. This makes the documented default apply when the key is simply left out.
  float soft = u_softness > 0.0 ? u_softness : 0.03;
  float aspect = max(u_aspect, 0.0);

  vec2 d = uv - 0.5;
  d.x *= mix(1.0, uRes.x / uRes.y, aspect);

  // Half-diagonal of the (possibly stretched) frame: the radius that covers every corner.
  vec2 corner = vec2(0.5 * mix(1.0, uRes.x / uRes.y, aspect), 0.5);
  float maxR = length(corner);

  // Start fully closed (below 0, so even the centre pixel is outgoing at uP=0) and finish fully
  // open (past maxR, so even the corners are incoming at uP=1) — feather included on both ends.
  float r = mix(-soft, maxR + soft, uP);
  float m = 1.0 - smoothstep(r - soft, r + soft, length(d));

  fragColor = mix(kinoFrom(uv), kinoTo(uv), m);
}
