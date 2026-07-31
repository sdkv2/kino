// glide-parallax — a soft directional push: a wide feathered seam travels across the frame while
// the two beats glide beneath it at different rates. The incoming settles in from the right over
// an outgoing that drifts away slower (depth parallax), with a soft vertical light seam — and a
// breath of shadow — riding the travel edge. No hard wipe line anywhere.
//
//   params (transitionParams — all optional, all NUMERIC)
//     push      incoming glide distance, fraction of frame width   (default 0.24)
//     parallax  outgoing drift, as a share of push                 (default 0.45)
//     softness  seam feather, fraction of frame width              (default 0.09)
//     glow      light-seam gain                                    (default 0.55)
//     tilt      seam tilt in degrees — a slight editorial lean so
//               the edge is never square to the text baselines
//               (default 6; pass ~0.001 for a true vertical)
//
//   endpoint contract
//     The seam sweeps from beyond the right edge to beyond the left, overshot by its own feather
//     PLUS the extra horizontal extent the tilt adds, so the mask saturates to pure outgoing at
//     uP=0 and pure incoming at uP=1 whatever the tilt. The incoming's offset is (1-q)·push —
//     exactly 0 at q=1 — and the outgoing's is q·push·parallax — exactly 0 at q=0. Light and
//     shadow both ride 4q(1-q), identically 0 at both ends. Hard early-outs make both endpoints
//     bit-exact.

// Reflect out-of-range samples. The travelling plates only ever expose a few percent past their
// own edge, and the beats keep white margins there, so the reflection is invisible — but it can
// never smear a clamped bezel. Identity inside [0,1], so endpoints are untouched.
vec2 kinoMirror(vec2 p) {
  vec2 m = mod(p, 2.0);
  return min(m, 2.0 - m);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = kinoUv(fragCoord);
  float p = clamp(uP, 0.0, 1.0);

  if (p <= 0.0) { fragColor = kinoFrom(uv); return; }
  if (p >= 1.0) { fragColor = kinoTo(uv); return; }

  float pushK = u_push     > 0.0 ? u_push               : 0.24;
  float parK  = u_parallax > 0.0 ? u_parallax           : 0.45;
  float soft  = u_softness > 0.0 ? clamp(u_softness, 0.01, 0.45) : 0.09;
  float glowK = u_glow     > 0.0 ? u_glow               : 0.55;
  float tiltK = u_tilt    != 0.0 ? u_tilt               : 6.0;

  // Quintic ease: zero velocity at both ends, one confident glide in between.
  float q = p * p * p * (p * (p * 6.0 - 15.0) + 10.0);
  float pulse = clamp(4.0 * q * (1.0 - q), 0.0, 1.0);

  // Seam coordinate: x with an editorial lean. The tilt widens the sweep's reach, so the
  // overshoot below accounts for it and the endpoints stay saturated.
  float tanT = tan(radians(clamp(tiltK, -25.0, 25.0)));
  float sx = uv.x + (uv.y - 0.5) * tanT;
  float ext = soft + 0.5 * abs(tanT) + 0.01;

  // Seam position, overshot past both frame edges with feather and tilt included.
  float e = mix(1.0 + ext, -ext, q);

  // The two plates: the incoming arrives displaced right and settles to exact registration; the
  // outgoing drifts left at a fraction of that rate. One direction of travel, two speeds — depth.
  float dxT = (1.0 - q) * pushK;
  float dxF = q * pushK * parK;

  vec4 from = kinoFrom(kinoMirror(vec2(uv.x + dxF, uv.y)));
  vec4 to   = kinoTo  (kinoMirror(vec2(uv.x - dxT, uv.y)));

  // A soft shadow falls on the outgoing just ahead of the arriving plate — the depth cue that
  // sells "over", not "beside". Peak sits slightly inside the outgoing region.
  float sd = e - sx;
  float shN = (sd - soft * 0.6) / (soft * 0.9);
  float shadow = exp(-shN * shN) * step(0.0, sd);
  from.rgb *= 1.0 - 0.12 * pulse * shadow;

  // Feathered handover across the seam — the mask saturates well past both edges.
  float m = smoothstep(e - soft, e + soft, sx);
  vec4 col = mix(from, to, m);

  // The light seam: a soft, faintly cool band riding the travel edge.
  float gN = (sx - e) / (soft * 1.1);
  float glow = exp(-gN * gN) * glowK * pulse;
  col.rgb += glow * vec3(0.90, 0.97, 1.0) * 0.40;

  fragColor = col;
}
