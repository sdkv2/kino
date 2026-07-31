// louver-reveal — the frame divides into wide architectural slats that slide away in a quiet
// top-down stagger, alternating direction row by row, revealing the incoming beat already seated
// behind them. A crisp inked joint runs along a slat boundary while either side is in motion, a
// soft crease shadow sits in the joint, and travelling faces take a gentle wash of shading — the
// joint treatment is what makes a sheared headline read as panels, not as a screen tear. The
// content stays rigid and sharp on its slat. Architecture, not a cartoon.
//
//   params (transitionParams — all optional, all NUMERIC)
//     slats    number of horizontal slats                          (default 5, clamped 2..12)
//     stagger  0..0.9 — share of the window spent on the cascade   (default 0.45)
//     shade    shading + joint + cast-shadow gain                  (default 0.6)
//     settle   the incoming settles back from this extra scale     (default 0.012)
//
//   endpoint contract
//     Per-slat progress is clamp((uP - delay) / (1 - stagger), 0, 1) with delay in [0, stagger],
//     so every slat is exactly 0 at uP=0 and exactly 1 at uP=1. Both states are short-circuited:
//     uP<=0 and a still-seated slat return kinoFrom(uv) untouched, uP>=1 returns kinoTo(uv)
//     untouched. Every cosmetic — joint lines, crease, face shading, cast shadow — is gated by a
//     motion term that is 0 whenever the slats beside it are at rest, and the incoming's settle
//     scale is settle·(1-uP), exactly identity at uP=1. Slat travel is overshot to 1.03 frame
//     widths, so a landed row is bare incoming well before its progress saturates.

// Eased progress of one slat row. Pure arithmetic, so a fragment can also evaluate its
// neighbour's row and the joint between them can belong to both sides.
float kinoSlatE(float row, float n, float stag, float p) {
  float ord = (n - 1.0 - row) / (n - 1.0);   // uv is y-up: top row first
  float e = clamp((p - ord * stag) / (1.0 - stag), 0.0, 1.0);
  return e * e * e * (e * (e * 6.0 - 15.0) + 10.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = kinoUv(fragCoord);
  float p = clamp(uP, 0.0, 1.0);

  if (p <= 0.0) { fragColor = kinoFrom(uv); return; }
  if (p >= 1.0) { fragColor = kinoTo(uv); return; }

  float n       = clamp(floor((u_slats > 0.5 ? u_slats : 5.0) + 0.5), 2.0, 12.0);
  float stag    = u_stagger > 0.0 ? clamp(u_stagger, 0.05, 0.9) : 0.45;
  float shadeK  = u_shade   > 0.0 ? clamp(u_shade, 0.0, 2.0)    : 0.6;
  float settleK = u_settle  > 0.0 ? u_settle                    : 0.012;

  float row = min(floor(uv.y * n), n - 1.0);
  float e2 = kinoSlatE(row, n, stag, p);
  float s = clamp(4.0 * e2 * (1.0 - e2), 0.0, 1.0);   // own motion gate — 0 at rest

  // The joint belongs to both rows: take the neighbour across the nearest boundary, so the ink
  // line and the crease persist while EITHER side is still travelling.
  float fy = fract(uv.y * n);
  float rowN = clamp(row + (fy > 0.5 ? 1.0 : -1.0), 0.0, n - 1.0);
  float e2N = kinoSlatE(rowN, n, stag, p);
  float sN = clamp(4.0 * e2N * (1.0 - e2N), 0.0, 1.0);
  float sJoint = max(s, sN);

  float dby = min(fy, 1.0 - fy) * uRes.y / n;         // px to the nearest slat boundary
  vec3 ink = vec3(0.059, 0.090, 0.165);               // the brand's night ink

  // The incoming sits behind the slats a whisper magnified and settles to exact registration as
  // the last slat lands — sampled toward centre, so it never reads past the frame edge.
  float sc = 1.0 + settleK * (1.0 - p);
  vec3 back = kinoTo((uv - 0.5) / sc + 0.5).rgb;

  float dir = mod(row, 2.0) < 0.5 ? 1.0 : -1.0;
  float dx = dir * e2 * 1.03;

  // Slat still seated: untouched outgoing apart from the shared joint, whose gate is 0 at uP=0.
  float eRaw = clamp((p - (n - 1.0 - row) / (n - 1.0) * stag) / (1.0 - stag), 0.0, 1.0);
  if (eRaw <= 0.0 || e2 <= 0.0) {
    vec3 c = kinoFrom(uv).rgb;
    float lineQ = 1.0 - smoothstep(0.6, 2.2, dby);
    float creaseQ = exp(-dby * dby / 36.0);
    c = mix(c, ink, lineQ * 0.6 * sJoint);
    c *= 1.0 - 0.10 * shadeK * sJoint * creaseQ;
    fragColor = vec4(c, 1.0);
    return;
  }

  if (e2 >= 1.0) {
    // Slat gone: bare incoming, plus the joint while the neighbour is still on the move.
    vec3 c = back;
    float lineQ = 1.0 - smoothstep(0.6, 2.2, dby);
    float creaseQ = exp(-dby * dby / 36.0);
    c = mix(c, ink, lineQ * 0.6 * sJoint);
    c *= 1.0 - 0.10 * shadeK * sJoint * creaseQ;
    fragColor = vec4(c, 1.0);
    return;
  }

  // Crisp single sample: the slat carries its content rigidly. Editorial slats read as panels
  // precisely because the type on them stays sharp while it travels.
  float xs = uv.x - dx;
  float px = 1.5 / uRes.x;
  float cov = clamp(xs / px + 0.5, 0.0, 1.0) * clamp((1.0 - xs) / px + 0.5, 0.0, 1.0);
  vec3 slat = kinoFrom(vec2(clamp(xs, 0.0, 1.0), uv.y)).rgb;

  // Gentle wash from the leading edge back toward the trailing one — the face catching ambient
  // light as it travels. Full-width and shallow, never a cartoon gradient.
  float trail = clamp(dir > 0.0 ? 1.0 - xs : xs, 0.0, 1.0);
  slat *= 1.0 - 0.14 * shadeK * s * trail;

  // Crisp hairline down the departing vertical edge, beside the opening gap.
  float lex = (dir > 0.0 ? clamp(xs, 0.0, 1.0) : 1.0 - clamp(xs, 0.0, 1.0)) * uRes.x;
  float vline = 1.0 - smoothstep(0.4, 1.8, lex);
  slat = mix(slat, ink, vline * 0.35 * s);

  // A soft shadow falls into the gap beside the departing edge — the one depth cue that makes
  // the slat sit in front of the incoming instead of beside it.
  float gd = dir > 0.0 ? (dx - uv.x) : (uv.x - (1.0 + dx));
  float shw = 0.05;
  float shadow = gd > 0.0 ? exp(-(gd * gd) / (shw * shw)) : 0.0;
  vec3 bg = back * (1.0 - 0.22 * shadeK * s * shadow);

  vec3 col = mix(bg, slat, cov);

  // The shared joint: inked hairline plus a soft crease shadow, alive while either neighbour
  // moves, gone the moment both are at rest.
  float line = 1.0 - smoothstep(0.6, 2.2, dby);
  float crease = exp(-dby * dby / 36.0);
  col = mix(col, ink, line * 0.6 * sJoint);
  col *= 1.0 - 0.10 * shadeK * sJoint * crease;

  fragColor = vec4(col, 1.0);
}
