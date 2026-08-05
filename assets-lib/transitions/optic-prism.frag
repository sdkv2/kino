// optic-prism — a slab of liquid glass swells through the frame and the two beats hand over
// wavelength by wavelength.
//
// THE IDEA
//   The boundary between the outgoing and incoming beat is not a shape, it is a *caustic wavefront*:
//   a deterministic interference web (the bright filaments you get on a pool floor) blended with a
//   radial sweep. A threshold rides that field from below its minimum to above its maximum, so the
//   incoming beat burns through along the bright filaments first and floods outward from there.
//
//   Three things make it read as glass rather than as a mask:
//     · the threshold is offset PER CHANNEL, so red crosses over before green before blue — for a
//       few frames the frame is literally two beats living in different wavelengths;
//     · every fragment is a radial zoom-smear (9 taps) whose radius spikes on the wavefront, so the
//       hand-off drags light with it instead of cutting;
//     · the two beats are sampled through opposite lens curvatures, so the outgoing frame swells
//       toward the viewer while the incoming one settles in from slightly wide, and coordinates that
//       leave the frame are reflected rather than clamped — a rim of glass, not a smeared bezel.
//   A spectral rim bloom rides the wavefront and clips the light field of beat A to white — the
//   "bloom that swallows the frame and clears into the next".
//
// PARAMS  (transitionParams; every key is numeric and becomes u_<name>)
//   blur       radial zoom-smear radius at peak, in frame heights   (default 0.024)
//   caustic    0 = plain radial wavefront, 1 = pure caustic web     (default 0.65)
//   disperse   chromatic split: radial RGB offset AND the per-channel
//              wavefront lead/lag, in frame heights                 (default 0.014)
//   flare      spectral rim bloom gain                              (default 0.40)
//   softness   wavefront feather, in field units                    (default 0.030)
//   warp       opposed lens curvature between the beats at peak     (default 0.170)
//   Omitting a key (or passing <= 0) selects the default above; pass 1e-4 to switch one off.
//
// ENDPOINTS  (the part that pops if you get it wrong)
//   Every distortion — blur radius, dispersion offset, channel lead, lens bulge, bloom — is scaled
//   by `pulse = 4*p*(1-p)`, a parabola that is EXACTLY 0.0 at p=0 and p=1 (no trig, so no
//   sin(PI)≈-8.7e-8 residue to leak a sub-pixel offset into the last frame). With pulse at zero all
//   9 taps and all 3 channels collapse onto the same unwarped uv, so the tap average is the plain
//   sample. The threshold itself sweeps `-soft-0.002 → 1+soft+0.002` over a field clamped to [0,1],
//   which saturates the mask to 0 and 1 with the feather already cleared at each end. A final
//   `pulse <= 0` early-out makes both endpoints bit-exact rather than merely within 1e-7.
//
// SPEC
//   { "transition": "custom", "transitionSource": "optic-prism",
//     "transitionParams": { "blur": 0.024, "caustic": 0.65, "disperse": 0.014,
//                           "flare": 0.4, "softness": 0.03, "warp": 0.17 } }
//   Defaults are tuned to stay legible over a real beat. The original showcase values (blur .035,
//   disperse .022, flare .6, warp .22) obliterate both compositions at the midpoint — striking as a
//   stinger, too much as a transition. Push back toward them for a deliberate glitch moment.

const int   KINO_TAPS = 9;
const float KINO_TAU  = 6.28318530718;

// Deterministic caustic web in [0,1]. Domain-warped interference of three waves, folded about its
// own zero crossings so the ridges become filaments. Pure function of uv — no clock, no noise.
float kinoCaustic(vec2 uv, float ar) {
  vec2 q = (uv - 0.5) * vec2(ar, 1.0) * 15.0;
  float a = sin(q.x * 0.90 + cos(q.y * 0.70 + 1.30) * 2.10);
  float b = sin(q.y * 1.10 - cos(q.x * 0.80 - 0.70) * 1.90);
  float c = sin((q.x + q.y) * 0.60 + a * b * 1.40);
  float v = (a + b + c) * 0.33333;
  float d = sin(q.x * 1.90 - q.y * 1.60 + v * 3.40) * 0.34;   // fine second octave
  return clamp(abs(v + d) / 1.34, 0.0, 1.0);
}

// Sampling coordinates leave [0,1] once the lens warp and the dispersion push them out. Reflect
// rather than clamp: a smeared clamp reads as a flat pale band along the bezel, a reflection reads
// as the rim of the glass element. Identity for uv already inside [0,1], so endpoints are untouched.
vec2 kinoMirror(vec2 p) {
  vec2 m = mod(p, 2.0);
  return min(m, 2.0 - m);
}

// The scalar the wavefront threshold rides: 0 hands over first, 1 hands over last. Always in [0,1],
// which is what lets the threshold sweep clear it completely at both ends.
float kinoField(vec2 uv, float ar, float maxR, float causK) {
  vec2 e = (uv - 0.5) * vec2(ar, 1.0);
  float rn = clamp(length(e) / maxR, 0.0, 1.0);
  return clamp(mix(rn, kinoCaustic(uv, ar), causK), 0.0, 1.0);
}

// Barrel (k > 0) / pincushion (k < 0) sampling warp. Identity at k = 0. The -0.35 recentres the
// bulge so the middle of the frame is not simply pushed off the edge.
vec2 kinoLens(vec2 uv, float ar, float maxR, float k) {
  vec2 e = (uv - 0.5) * vec2(ar, 1.0);
  float r2 = dot(e, e) / (maxR * maxR);
  e *= 1.0 + k * (r2 - 0.35);
  return kinoMirror(0.5 + e / vec2(ar, 1.0));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = kinoUv(fragCoord);
  float ar = uRes.x / uRes.y;
  float maxR = length(vec2(0.5 * ar, 0.5));

  float p = clamp(uP, 0.0, 1.0);

  // Exactly zero at both ends, ~1 across the middle third. Everything optical hangs off this.
  float pulse = clamp(4.0 * p * (1.0 - p), 0.0, 1.0);
  // Sweep position. Linear: the field's own bell-shaped distribution already gives the wavefront a
  // slow-fast-slow feel, and easing on top of it left the first third of the handoff looking dead.
  float ep = p;

  // Endpoint guard: with no distortion left there is nothing to average, so hand back the untouched
  // beat bit-for-bit. The maths below already lands here; this removes even the 1e-7 of tap-average
  // rounding, because a beat boundary is the one place that has to be perfect.
  if (pulse <= 0.0) {
    fragColor = ep < 0.5 ? kinoFrom(uv) : kinoTo(uv);
    return;
  }

  float soft   = max(u_softness, 0.006);
  float blurK  = u_blur     > 0.0 ? u_blur                     : 0.024;
  float dispK  = u_disperse > 0.0 ? u_disperse                 : 0.014;
  float flareK = u_flare    > 0.0 ? u_flare                    : 0.400;
  float warpK  = u_warp     > 0.0 ? u_warp                     : 0.170;
  float causK  = u_caustic  > 0.0 ? clamp(u_caustic, 0.0, 1.0) : 0.650;

  vec2 e = (uv - 0.5) * vec2(ar, 1.0);
  float rr = length(e);
  float rn = clamp(rr / maxR, 0.0, 1.0);
  // Radial unit vector expressed back in uv, so an offset of k moves k frame-heights of pixels.
  vec2 dirUv = rr > 1e-5 ? (e / rr) / vec2(ar, 1.0) : vec2(0.0);

  float caus  = kinoCaustic(uv, ar);
  float ridge = 1.0 - caus;                       // 1 on a caustic filament
  float field = clamp(mix(rn, caus, causK), 0.0, 1.0);

  // Sweep the threshold past both extremes of `field`, feather included, so uP=0 is all-from and
  // uP=1 is all-to with no sliver left over.
  float R = mix(-soft - 0.002, 1.0 + soft + 0.002, ep);

  float edgeW = max(soft * 1.6, 0.018);
  float dEdge = (field - R) / edgeW;
  float nearEdge = exp(-dEdge * dEdge);           // 1 on the wavefront, 0 away from it

  float blurR = blurK * pulse * mix(0.35, 1.00, rn) * mix(0.28, 1.30, nearEdge);
  float dispR = dispK * pulse * mix(0.45, 1.00, rn) * mix(0.80, 2.00, nearEdge);
  float lead  = dispK * pulse * 1.6;              // per-channel wavefront lead, in field units
  float warpA = warpK * pulse;

  // Gradient of the field, so a smeared tap sees a smeared wavefront without paying for another
  // caustic evaluation per tap. Extrapolation is clamped back into [0,1], so it can never push the
  // mask outside the range the threshold sweep already clears.
  float h = 2.0 / uRes.y;
  vec2 grad = vec2(kinoField(uv + vec2(h, 0.0), ar, maxR, causK) - field,
                   kinoField(uv + vec2(0.0, h), ar, maxR, causK) - field) / h;

  vec3 col = vec3(0.0);
  float alpha = 0.0;
  float wsum = 0.0;

  for (int i = 0; i < KINO_TAPS; i++) {
    float t = float(i) / float(KINO_TAPS - 1) * 2.0 - 1.0;   // -1 .. 1 along the radial line
    float w = 1.0 - 0.55 * t * t;                            // centre-weighted smear
    float base = t * blurR;

    // Three sample lines, one per wavelength: red pulled in, blue pushed out.
    vec2 offR = dirUv * (base - dispR);
    vec2 offG = dirUv * (base);
    vec2 offB = dirUv * (base + dispR);

    // Same three offsets, but the mask is read at the tap so the boundary smears with the light,
    // and each channel crosses over at its own threshold.
    float fR = clamp(field + dot(grad, offR), 0.0, 1.0);
    float fG = clamp(field + dot(grad, offG), 0.0, 1.0);
    float fB = clamp(field + dot(grad, offB), 0.0, 1.0);
    float mR = 1.0 - smoothstep(R - lead - soft, R - lead + soft, fR);
    float mG = 1.0 - smoothstep(R        - soft, R        + soft, fG);
    float mB = 1.0 - smoothstep(R + lead - soft, R + lead + soft, fB);

    // Outgoing beat swells toward the viewer, incoming beat settles in from slightly wide.
    vec4 fr = kinoFrom(kinoLens(uv + offR, ar, maxR, -warpA));
    vec4 tr = kinoTo  (kinoLens(uv + offR, ar, maxR,  warpA * 0.55));
    vec4 fg = kinoFrom(kinoLens(uv + offG, ar, maxR, -warpA));
    vec4 tg = kinoTo  (kinoLens(uv + offG, ar, maxR,  warpA * 0.55));
    vec4 fb = kinoFrom(kinoLens(uv + offB, ar, maxR, -warpA));
    vec4 tb = kinoTo  (kinoLens(uv + offB, ar, maxR,  warpA * 0.55));

    col += w * vec3(mix(fr.r, tr.r, mR), mix(fg.g, tg.g, mG), mix(fb.b, tb.b, mB));
    alpha += w * mix(fg.a, tg.a, mG);
    wsum += w;
  }

  col /= wsum;
  alpha /= wsum;

  // Spectral rim bloom riding the wavefront, brightest where the caustic filaments concentrate it.
  // Additive, so it clips beat A's light field to white before the dark beat B arrives underneath.
  float phase = field * 2.2 + rn * 0.9 + ridge * 0.8;
  vec3 spec = 0.5 + 0.5 * cos(KINO_TAU * (vec3(0.00, 0.33, 0.67) + phase));
  float glow = nearEdge * (0.55 + 0.45 * nearEdge) * (0.15 + 0.85 * ridge * ridge);
  col += (spec * 0.75 + 0.22) * glow * flareK * pulse;

  // A brief veiling glare off the caustic filament cores across the whole frame — the flash of a
  // lens element passing through the beam. Mostly white, only tinted, or it turns into an oil slick
  // and buries both beats; pulse^3 confines it to the few frames either side of the midpoint.
  float veil = pulse * pulse * pulse;
  vec3 flashCol = kinoPick(u_flash, uBrandAccent);
  col += mix(flashCol, spec, 0.55) * (ridge * ridge * ridge) * 0.10 * flareK * veil;

  fragColor = vec4(col, alpha);
}
