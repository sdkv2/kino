// print-halftone — the incoming beat comes off a press. Three rotated ink screens print it dot by
// dot over the outgoing beat: dark cells print first and grow biggest, so mid-handoff the frame is
// literally a halftone reproduction of the incoming beat — rosette moiré, misregistration and all —
// until the dots swell past tangency and flood to full coverage.
//
// THE IDEA
//   A halftone screen is a rotated grid of dots whose radius encodes ink. Here each channel gets its
//   own screen at a classic press angle (15° / 75° / 0°), and every dot's growth is scheduled by
//   three things: a press-roller sweep across the frame (angle), the cell's own ink demand (dark
//   cells of the incoming beat lead, light cells trail — which is what makes the mid-state READ as
//   the picture), and the channel's registration lead (cyan bites before magenta before yellow, so
//   the first dots arrive as pale ghosts and the flood lands in full colour). Inside a dot you see
//   the incoming beat's actual pixels for that channel; outside you still see the outgoing beat.
//   A soft roller sheen tracks the sweep line while the press is rolling.
//
// PARAMS  (transitionParams — all optional, all NUMERIC)
//   cells     dot rows along the frame height (default 24). 12 = poster dots, 40 = newsprint.
//   angle     degrees; direction the press sweep travels (default 200 — top-left to bottom-right).
//   spread    0..1 channel misregistration: 0 = perfectly registered (no fringes),
//             1 = each channel a full beat apart (default 0.55).
//   stagger   0..0.9 share of the handoff spent scheduling (default 0.55). 0 = all dots at once.
//   softness  dot edge feather in cell units (default: one screen pixel).
//
// ENDPOINTS
//   Per-dot progress is clamp((uP - delay) / (1 - stag), 0, 1) with every delay in [0, stag], so
//   every dot of every screen is at exactly 0 when uP=0 (radius below zero — no coverage anywhere)
//   and exactly 1 when uP=1 (radius past the cell's far corner plus feather — coverage everywhere,
//   all three channels). The wet-ink rim rides q(1-q) and the roller sheen rides 4·uP(1-uP), both
//   identically 0 at the ends. Explicit early-outs make both endpoints bit-exact anyway.
//   Verified: the first- and last-overlap-frame stills are RMSE 0 against a straight fade.
//
// spec: { "transition": "custom", "transitionSource": "print-halftone",
//         "transitionParams": { "cells": 24, "angle": 200, "spread": 0.55, "stagger": 0.55 } }

// Classic press screen angles. Three screens is enough for a rosette; a fourth (black at 45°)
// buys nothing once the dots carry real pixels instead of ink.
const float KINO_SCREEN_A0 = 0.2617993878;   // 15°
const float KINO_SCREEN_A1 = 1.3089969390;   // 75°
const float KINO_SCREEN_A2 = 0.0;            //  0°
// Radius that guarantees coverage: the farthest any pixel can sit from its nearest dot centre is
// half the cell diagonal (0.7071); overshoot it so the feather is cleared too.
const float KINO_R_FULL = 0.78;
// Wet-ink rim: width (cell units) and how hard it darkens a freshly printed dot's edge.
const float KINO_RIM_W = 0.16;
const float KINO_RIM_DARK = 0.38;

float kinoHalfHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

// Screen-space coverage of one channel: how much of this pixel is under printed ink right now.
// `sel` picks the channel from the incoming beat (its darkness schedules the dot), `lead` is this
// screen's registration delay, already budgeted inside `stag`.
float kinoScreen(vec2 uv, float ang, vec3 sel, float lead, float dens, float stag,
                 vec2 dir, float extent, float soft, float ar, out float rim) {
  mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  vec2 g = rot * (vec2(uv.x * ar, uv.y) * dens);

  float cov = 0.0;
  rim = 0.0;
  vec2 gi = floor(g);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cell = gi + vec2(float(x), float(y));
      vec2 centre = cell + 0.5;
      // Cell centre back in uv space: where this dot samples the incoming beat, and where it sits
      // along the press sweep.
      vec2 cp = (centre / dens) * rot;              // rot is orthonormal: transpose = inverse
      vec2 cuv = vec2(cp.x / ar, cp.y);

      float ink = 1.0 - dot(kinoTo(clamp(cuv, 0.0, 1.0)).rgb, sel);   // dark = more ink = earlier
      float ord = clamp(0.5 + dot(cuv - 0.5, dir) / (2.0 * extent), 0.0, 1.0);
      float jit = kinoHalfHash(cell + ang * 7.0);

      // Schedule inside [lead, stag]: sweep position leads, ink demand shapes, jitter breaks rows.
      float avail = stag - lead;
      float delay = lead + avail * clamp(ord * 0.52 + (1.0 - ink) * 0.38 + jit * 0.10, 0.0, 1.0);
      float q = clamp((uP - delay) / (1.0 - stag), 0.0, 1.0);
      float e = q * q * (3.0 - 2.0 * q);

      float r = mix(-soft, KINO_R_FULL + soft, e);
      float d = length(g - centre);
      float m = 1.0 - smoothstep(r - soft, r + soft, d);
      cov = max(cov, m);

      // Wet rim: a darker ring just inside the growing dot's edge, gone once the dot has landed.
      float ring = smoothstep(r - KINO_RIM_W - soft, r - soft * 0.5, d) * m;
      rim = max(rim, ring * q * (1.0 - q) * 4.0);
    }
  }
  return cov;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = kinoUv(fragCoord);
  vec4 from = kinoFrom(uv);
  vec4 to = kinoTo(uv);
  if (uP <= 0.0) { fragColor = from; return; }
  if (uP >= 1.0) { fragColor = to; return; }

  float ar = uRes.x / uRes.y;
  float dens   = u_cells > 0.5 ? u_cells : 24.0;
  float stag   = u_stagger > 0.0 ? clamp(u_stagger, 0.0, 0.9) : 0.55;
  float spread = u_spread > 0.0 ? clamp(u_spread, 0.0, 1.0) : 0.55;
  float sweep  = radians(u_angle > 0.0 ? u_angle : 200.0);
  float aa = dens / uRes.y;                          // one screen pixel, in cell units
  float soft = max(u_softness, aa);

  vec2 dir = vec2(sin(sweep), cos(sweep));
  float extent = 0.5 * (abs(dir.x) + abs(dir.y));

  // Registration: the three screens split a slice of the stagger budget between them.
  float leadSpan = stag * 0.38 * spread;
  float rimR, rimG, rimB;
  float mR = kinoScreen(uv, KINO_SCREEN_A0, vec3(1.0, 0.0, 0.0), 0.0,            dens, stag, dir, extent, soft, ar, rimR);
  float mG = kinoScreen(uv, KINO_SCREEN_A1, vec3(0.0, 1.0, 0.0), leadSpan * 0.5, dens, stag, dir, extent, soft, ar, rimG);
  float mB = kinoScreen(uv, KINO_SCREEN_A2, vec3(0.0, 0.0, 1.0), leadSpan,       dens, stag, dir, extent, soft, ar, rimB);

  // Each channel hands over through its own screen — the misregistration fringes ARE the rosette.
  // The wet rim darkens only the freshly printed side, and only while its dot is still growing.
  vec3 col = vec3(mix(from.r, to.r * (1.0 - rimR * KINO_RIM_DARK), mR),
                  mix(from.g, to.g * (1.0 - rimG * KINO_RIM_DARK), mG),
                  mix(from.b, to.b * (1.0 - rimB * KINO_RIM_DARK), mB));

  // The roller: a soft sheen tracking the sweep line while the press is rolling. Rides the
  // 4p(1-p) pulse, so it cannot touch an endpoint.
  float pulse = 4.0 * uP * (1.0 - uP);
  float here = clamp(0.5 + dot(uv - 0.5, dir) / (2.0 * extent), 0.0, 1.0);
  float dRoll = (here - uP) / 0.09;
  float roller = exp(-dRoll * dRoll) * pulse;
  col *= 1.0 - 0.08 * roller;
  col += vec3(0.9, 1.0, 0.95) * 0.035 * roller;

  fragColor = vec4(col, mix(from.a, to.a, mG));
}
