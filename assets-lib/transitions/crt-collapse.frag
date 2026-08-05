// crt-collapse — a phosphor tube power cycle: the outgoing beat collapses to a scanline, the
// scanline to a dot, and the incoming beat blooms back out of the dot.
//
// THE IDEA
//   The classic TV-off in two stages, then its mirror. First half: the raster loses vertical
//   deflection — the whole picture squashes into a thinning band that BRIGHTENS as the same energy
//   lands on fewer lines, whitening toward overload — then loses horizontal deflection and snaps
//   to a searing dot. Second half: the incoming beat runs the same physics backward, dot → line →
//   full frame. What sells it as a tube rather than a scale animation:
//     · energy conservation — gain rises as the band thins, clipping toward white through a
//       mint-phosphor tint, and a soft glow halos the band exactly as bright as it is;
//     · the beam misbehaves under stress — scanlines emerge, the R and B rays misconverge
//       vertically, and the band picks up a slight hum wobble as deflection dies;
//     · the dot LINGERS — a decaying phosphor afterglow bridges the midpoint, so the handoff
//       passes through a live black frame with a cooling star in it, never through dead black.
//
// PARAMS  (transitionParams — all optional, all NUMERIC)
//   glow   0..2   halo + afterglow gain                              (default 0.9)
//   lines  20..200 scanline count across the frame height            (default 96)
//   wobble 0..1.5 hum jitter + misconvergence under stress           (default 0.8)
//   snap   0.5..0.95 share of each half spent on the vertical squash (default 0.68;
//          the rest is the horizontal snap to the dot)
//
// ENDPOINTS
//   Collapse amount c is 0 at uP=0 (outgoing side) and 0 at uP=1 (incoming side). Every effect —
//   squash, gain, whitening, scanlines, wobble, misconvergence, glow — is scaled by a power of c
//   or of (1 - Sy), both identically 0 at c=0, so the frame at each boundary is the untouched
//   beat. Early-outs at uP<=0 / uP>=1 make the boundary frames bit-exact rather than merely
//   identical-to-float-precision.
//   Verified: the first- and last-overlap-frame stills are RMSE 0 against a straight fade.
//
// spec: { "transition": "custom", "transitionSource": "crt-collapse",
//         "transitionParams": { "glow": 0.9, "lines": 96, "wobble": 0.8 } }

const float KINO_EPS_Y = 0.0045;   // band height at full vertical collapse (fraction of frame)
const float KINO_EPS_X = 0.0060;   // dot width at full horizontal collapse
const vec3  KINO_PHOSPHOR = vec3(0.72, 1.0, 0.84);   // the tube's tint, kino mint through glass

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = kinoUv(fragCoord);
  if (uP <= 0.0) { fragColor = kinoFrom(uv); return; }
  if (uP >= 1.0) { fragColor = kinoTo(uv); return; }

  float glowK = u_glow   > 0.0 ? u_glow : 0.9;
  float lines = u_lines  > 0.5 ? u_lines : 96.0;
  float wob   = u_wobble > 0.0 ? u_wobble : 0.8;
  float snap  = u_snap   > 0.0 ? clamp(u_snap, 0.5, 0.95) : 0.68;

  vec3 phosphor = kinoPick(u_phosphor, uBrandAccent);

  // Which side of the midpoint we are on, and how collapsed that side is (0 = full frame, 1 = dot).
  bool fromSide = uP < 0.5;
  float c = clamp(fromSide ? uP * 2.0 : (1.0 - uP) * 2.0, 0.0, 1.0);

  // Stage split: vertical deflection dies over [0, snap], horizontal over [snap, 1]. The vertical
  // ramp is eased so it accelerates the way a discharging coil does.
  float cy = smoothstep(0.0, snap, c);
  float cx = smoothstep(snap, 1.0, c);
  float Sy = mix(1.0, KINO_EPS_Y, cy * cy * (3.0 - 2.0 * cy));
  float Sx = mix(1.0, KINO_EPS_X, cx * cx);

  // Hum: the band drifts off centre as deflection dies. Deterministic, scaled by c so it is 0 at
  // both boundaries.
  float drift = sin(uP * 61.0) * 0.006 * wob * c;

  float px = 1.5 / uRes.y;
  float dy = abs(uv.y - 0.5 - drift);
  float dx = abs(uv.x - 0.5);

  // Band coverage, snapped fully open while a deflection is still whole so an untouched axis
  // cannot shave its outermost pixels.
  float maskY = 1.0 - smoothstep(0.5 * Sy - px, 0.5 * Sy + px, dy);
  maskY = mix(maskY, 1.0, step(0.9999, Sy));
  float maskX = 1.0 - smoothstep(0.5 * Sx - px, 0.5 * Sx + px, dx);
  maskX = mix(maskX, 1.0, step(0.9999, Sx));
  float band = maskY * maskX;

  // Sample the beat through the collapsing raster. R and B misconverge vertically under stress.
  vec2 src = vec2((uv.x - 0.5) / Sx + 0.5, (uv.y - 0.5 - drift) / Sy + 0.5);
  float mc = 0.0045 * wob * c;
  vec2 srcR = clamp(src + vec2(0.0,  mc), 0.0, 1.0);
  vec2 srcG = clamp(src, 0.0, 1.0);
  vec2 srcB = clamp(src - vec2(0.0,  mc), 0.0, 1.0);
  vec4 sR = fromSide ? kinoFrom(srcR) : kinoTo(srcR);
  vec4 sG = fromSide ? kinoFrom(srcG) : kinoTo(srcG);
  vec4 sB = fromSide ? kinoFrom(srcB) : kinoTo(srcB);
  vec3 pic = vec3(sR.r, sG.g, sB.b);

  // Energy conservation: gain climbs as the raster thins — squared, so a half-squashed picture
  // still looks like the picture and the overload arrives only when the band is genuinely thin,
  // whitening through the phosphor tint instead of just clipping.
  float squeeze = (1.0 - Sy) + (1.0 - Sx);
  float sq3 = squeeze * squeeze * squeeze;
  float gain = min(1.0 + 2.2 * sq3, 6.0);
  pic *= gain;
  float overload = clamp(1.9 * sq3 - 0.35, 0.0, 0.92);
  pic = mix(pic, phosphor * max(max(pic.r, pic.g), max(pic.b, 1.2)), overload);

  // Scanlines surface as the tube destabilises, and fade with the band.
  float sl = 1.0 - 0.34 * min(wob, 1.0) * c * (0.5 + 0.5 * sin(uv.y * lines * 6.2831853));
  pic *= sl;

  vec3 col = pic * band;

  // Glow: the halo around the band/dot, and the afterglow that bridges the midpoint. Both scale
  // with (1 - Sy), so neither exists while the raster is whole.
  float fall = dy / (0.5 * Sy + 0.02) + dx / (0.5 * Sx + 0.35);
  float halo = exp(-fall * fall * 2.0) * (1.0 - band);
  col += phosphor * halo * (1.0 - Sy) * (1.0 - Sy) * (0.6 + 1.2 * (1.0 - Sx)) * glowK;

  // Phosphor persistence right at the handoff: a cooling star centred where the dot died.
  float mid = 1.0 - smoothstep(0.0, 0.16, abs(uP - 0.5));
  float star = exp(-(dy * dy * 90.0 + dx * dx * 30.0) * 60.0);
  col += phosphor * star * mid * mid * 1.6 * glowK;

  // Inside the whole raster at c=0 this is exactly the beat's own alpha; everywhere the tube has
  // gone dark it is opaque black.
  fragColor = vec4(col, mix(1.0, sG.a, band * (1.0 - c)));
}
