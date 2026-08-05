// rack-focus — a defocus dissolve: the outgoing beat breathes toward the viewer and melts into
// bokeh while the incoming beat resolves out of the same defocus, with a subtle exposure lift
// riding the middle of the cut. The optics of pulling focus through a scene, not a crossfade.
//
//   params (transitionParams — all optional, all NUMERIC)
//     blur     peak defocus radius, in frame heights              (default 0.026)
//     breathe  focus-breathing scale drift, fraction of frame     (default 0.040)
//     lift     exposure lift at the midpoint, 0..1                (default 0.10)
//     bokeh    highlight weighting of the disc kernel — 0 tends
//              gaussian, higher lets the bright field eat the ink (default 1.2)
//
//   endpoint contract
//     Hard early-outs return the untouched beat at uP<=0 and uP>=1. In between, every distortion
//     dies at the end where its beat must be exact: the outgoing's blur envelope and breathe scale
//     are 0 at p=0, the incoming's are 0 at p=1, the crossfade saturates at 0.20/0.80, and the
//     lift rides 4p(1-p), which is identically 0 at both ends. When a beat's blur radius is 0 all
//     32 taps collapse onto one coordinate, so the highlight weighting cancels exactly and the
//     average is the plain sample.

const int KINO_TAPS = 32;
const float KINO_GOLD = 2.39996322973;   // golden angle — vogel disc

// Deterministic per-pixel kernel rotation: decorrelates the 32-tap disc into fine grain instead
// of visible sample rings. Pure function of fragCoord — no clock, no state.
float kinoHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

// Reflect out-of-range samples so a breathing frame edge reads as a lens rim, not a smeared bezel.
// Identity for coordinates already inside [0,1], so endpoints are untouched.
vec2 kinoMirror(vec2 p) {
  vec2 m = mod(p, 2.0);
  return min(m, 2.0 - m);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = kinoUv(fragCoord);
  float p = clamp(uP, 0.0, 1.0);

  if (p <= 0.0) { fragColor = kinoFrom(uv); return; }
  if (p >= 1.0) { fragColor = kinoTo(uv); return; }

  float blurK    = u_blur    > 0.0 ? u_blur    : 0.026;
  float breatheK = u_breathe > 0.0 ? u_breathe : 0.040;
  float liftK    = u_lift    > 0.0 ? u_lift    : 0.10;
  float bokehK   = u_bokeh   > 0.0 ? u_bokeh   : 1.2;

  float ar = uRes.x / uRes.y;
  float pulse = clamp(4.0 * p * (1.0 - p), 0.0, 1.0);

  // Crossfade lives in the middle 60%, where both fields are past peak defocus — the swap hides
  // inside the blur instead of showing two sharp layouts through each other.
  float m = smoothstep(0.20, 0.80, p);

  float pe = p * p * (3.0 - 2.0 * p);

  // Outgoing melts as it leaves; incoming enters already defocused and resolves. Each envelope is
  // exactly 0 at the end where its beat must be untouched.
  float blurF = blurK * smoothstep(0.0, 0.80, p);
  float blurT = blurK * (1.0 - smoothstep(0.20, 1.0, p));

  // Focus breathing: the outgoing grows toward the viewer, the incoming settles up from slightly
  // small — one continuous forward move across the cut instead of two clips.
  float scF = 1.0 + breatheK * pe;
  float scT = 1.0 - breatheK * 0.6 * (1.0 - pe);

  vec2 cF = (uv - 0.5) / scF;
  vec2 cT = (uv - 0.5) / scT;

  float rot = kinoHash(fragCoord) * 6.28318530718;

  vec4 accF = vec4(0.0); float wsF = 0.0;
  vec4 accT = vec4(0.0); float wsT = 0.0;

  for (int i = 0; i < KINO_TAPS; i++) {
    float fi = float(i);
    float r = sqrt((fi + 0.5) / float(KINO_TAPS));
    float th = fi * KINO_GOLD + rot;
    vec2 d = vec2(cos(th) / ar, sin(th)) * r;   // circular in pixels, not in uv

    vec4 f = kinoFrom(kinoMirror(0.5 + cF + d * blurF));
    vec4 t = kinoTo  (kinoMirror(0.5 + cT + d * blurT));

    // Bokeh weighting: bright taps count more, so the white field blooms over the ink the way
    // real defocus does, instead of averaging everything into grey.
    float lf = dot(f.rgb, vec3(0.299, 0.587, 0.114));
    float lt = dot(t.rgb, vec3(0.299, 0.587, 0.114));
    float wf = 1.0 + bokehK * lf * lf * lf;
    float wt = 1.0 + bokehK * lt * lt * lt;

    accF += f * wf; wsF += wf;
    accT += t * wt; wsT += wt;
  }

  vec4 from = accF / wsF;
  vec4 to   = accT / wsT;

  vec4 col = mix(from, to, m);

  // Subtle exposure lift through the middle of the rack — the veil of an open aperture.
  vec3 liftCol = kinoPick(u_liftColor, uBrandAccent);
  col.rgb = mix(col.rgb, liftCol, liftK * pulse);

  fragColor = col;
}
