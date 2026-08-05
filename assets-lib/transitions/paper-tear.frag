// paper-tear — the outgoing beat is a sheet of paper ripped in two over the incoming beat.
//
// THE IDEA
//   A ragged tear line PROPAGATES across the frame — it does not appear everywhere at once. Ahead
//   of the rip the sheet is still whole; behind it the two halves peel apart, each one lifting more
//   the further the rip has passed it (a differential pull that reads as rotation without any
//   rotation matrix), sliding slightly along the tear as real halves do, and finally flinging clear
//   of the frame. Three cues sell the paper as MATTER:
//     · the torn edges are complementary — both halves share one wiggly-plus-fine-noise curve, so
//       the jigsaw would still fit back together;
//     · a fibre fringe rides each torn edge — the sheet's white core shows in a ragged band of
//       strands that appears exactly where the rip has passed, never on the still-closed seam;
//     · the tear has depth — each half darkens toward its lifted edge (curl), and the upper half
//       casts a soft shadow down onto the incoming beat through the widening gap.
//
// PARAMS  (transitionParams — all optional, all NUMERIC)
//   angle   degrees off horizontal for the tear axis (default 8)
//   jag     0..2 raggedness of the tear line (default 1). 0.3 = clean rip, 1.8 = savaged.
//   fibre   0..2 white fibre fringe intensity on the torn edges (default 1)
//   shadow  0..2 depth of the cast shadow in the gap (default 1)
//
// ENDPOINTS
//   At uP=0 the rip front is still off-frame, so openness is 0 everywhere: both halves sit at
//   identity, the fringe and curl are gated by that same openness, and the two coverages are
//   renormalised into one sheet, so the closed seam cannot leak the underlayer. At uP=1 the
//   displacement exceeds the frame diagonal plus every cue width, so no source point lands inside
//   the sheet and the shadow's support has left the frame with it — the result is the untouched
//   incoming beat. Early-outs at uP<=0 / uP>=1 make both boundary frames bit-exact regardless.
//   Verified: the first- and last-overlap-frame stills are RMSE 0 against a straight fade.
//
// spec: { "transition": "custom", "transitionSource": "paper-tear",
//         "transitionParams": { "angle": 8, "jag": 1.0, "fibre": 1.0, "shadow": 1.0 } }

const float KINO_RAMP = 0.30;      // rip ramp: how much of the tear is mid-peel at once
const float KINO_D_MAX = 1.6;      // final fling, in frame heights — past any corner + cue width
const vec3  KINO_PAPER_CORE = vec3(0.96, 0.94, 0.88);   // the white inside the sheet

float tearHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float tearValue(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tearHash(i), tearHash(i + vec2(1.0, 0.0)), u.x),
             mix(tearHash(i + vec2(0.0, 1.0)), tearHash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// The tear curve: one coarse wander plus fine serration, shared by both halves so the edges stay
// complementary. aN in [0,1] along the tear; returns a perpendicular offset in frame-height units.
float tearCurve(float aN, float jag) {
  float coarse = tearValue(vec2(aN * 4.2, 7.7)) - 0.5;
  float fine = tearValue(vec2(aN * 41.0, 23.3)) - 0.5;
  return coarse * 0.085 * jag + fine * 0.022 * jag;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = kinoUv(fragCoord);
  vec4 under = kinoTo(uv);
  if (uP <= 0.0) { fragColor = kinoFrom(uv); return; }
  if (uP >= 1.0) { fragColor = under; return; }

  float jag    = u_jag    > 0.0 ? clamp(u_jag, 0.0, 2.0) : 1.0;
  float fibreK = u_fibre  > 0.0 ? clamp(u_fibre, 0.0, 2.0) : 1.0;
  float shadK  = u_shadow > 0.0 ? clamp(u_shadow, 0.0, 2.0) : 1.0;
  float ang = radians(u_angle > 0.0 ? u_angle : 8.0);

  vec3 paperCore = kinoPick(u_paper, uBrandFg);

  // Square metric; tear axis and its normal.
  float ar = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * ar, uv.y);
  vec2 m = vec2(0.5 * ar, 0.5);
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 nrm = vec2(-dir.y, dir.x);
  float amax = 0.5 * (ar * abs(dir.x) + abs(dir.y)) + 0.02;

  float a = dot(p - m, dir);
  float w = dot(p - m, nrm);

  // The rip front travels the tear over the first ~60% of the handoff; displacement builds over
  // the whole of it. gap opens a hairline crack early, D is the fling.
  float front = -KINO_RAMP + (1.0 + 2.0 * KINO_RAMP) * clamp(uP / 0.62, 0.0, 1.0);
  float gap = 0.020 * smoothstep(0.0, 0.40, uP);
  float D = KINO_D_MAX * pow(clamp((uP - 0.08) / 0.92, 0.0, 1.0), 2.4);
  float slide = D * 0.14;

  float aaW = 1.5 / uRes.y;    // one screen pixel, square units
  float fringeW = 0.016 * (0.5 + jag);
  float curlW = 0.075;
  float shadowW = 0.055 + 0.065 * min(shadK, 1.5);

  // Both halves, resolved by inverse mapping: where did the point under this pixel come from, and
  // is that source still on its own side of the tear and inside the sheet?
  float cov[2]; vec3 col3[2]; float alph[2];
  for (int i = 0; i < 2; i++) {
    float sg = i == 0 ? 1.0 : -1.0;   // +1 = the half above the curve
    float sa = a - sg * slide;
    float aNs = clamp(sa / amax * 0.5 + 0.5, 0.0, 1.0);
    float open = clamp((front - aNs) / KINO_RAMP, 0.0, 1.0);
    float off = (gap + D) * open;
    float sw = w - sg * off;

    float eDist = sg * (sw - tearCurve(aNs, jag));   // >=0 inside this half
    // Sheet bounds, grown a couple of pixels so a whole sheet never shaves the frame border.
    vec2 sp = m + dir * sa + nrm * sw;
    float fc = smoothstep(-3.0 * aaW, -aaW, sp.x) * smoothstep(-3.0 * aaW, -aaW, ar - sp.x)
             * smoothstep(-3.0 * aaW, -aaW, sp.y) * smoothstep(-3.0 * aaW, -aaW, 1.0 - sp.y);

    cov[i] = smoothstep(-aaW, aaW, eDist) * fc;
    vec4 s = kinoFrom(clamp(vec2(sp.x / ar, sp.y), 0.0, 1.0));
    alph[i] = s.a;

    // Fibre fringe and curl, both gated by the rip's own openness so the closed seam stays
    // invisible and the cues are born exactly where the tear passes.
    float strand = tearValue(vec2(aNs * 150.0, sg * 3.1 + 11.0));
    float fw = fringeW * (0.45 + 1.1 * strand);
    float fringe = (1.0 - smoothstep(0.0, fw, eDist)) * open * fibreK;
    float lift = clamp(off / 0.05, 0.0, 1.0);
    float curl = (1.0 - smoothstep(0.0, curlW, eDist)) * lift;

    vec3 c = s.rgb * (1.0 - 0.38 * curl);
    c = mix(c, paperCore * (0.75 + 0.35 * strand), clamp(fringe, 0.0, 1.0));
    col3[i] = c;
  }

  // The upper half's displaced edge casts down into the gap. Its support leaves the frame with the
  // half itself, so it cannot touch the uP=1 endpoint.
  float aNq = clamp(a / amax * 0.5 + 0.5, 0.0, 1.0);
  float openQ = clamp((front - aNq) / KINO_RAMP, 0.0, 1.0);
  float offQ = (gap + D) * openQ;
  float sd = (tearCurve(aNq, jag) + offQ) - w;
  float sh = (1.0 - smoothstep(0.0, shadowW, max(sd, 0.0))) * step(0.0001, sd)
           * clamp(offQ / 0.03, 0.0, 1.0) * 0.5 * shadK;

  vec3 col = under.rgb * (1.0 - sh);

  // Renormalised union of the two halves: while the seam is closed the coverages sum to one and
  // the underlayer cannot leak through the AA of the cut.
  float sum = cov[0] + cov[1];
  float sheet = min(sum, 1.0);
  vec3 sheetCol = (col3[0] * cov[0] + col3[1] * cov[1]) / max(sum, 1e-5);
  col = mix(col, sheetCol, sheet);

  fragColor = vec4(col, mix(under.a, (alph[0] * cov[0] + alph[1] * cov[1]) / max(sum, 1e-5), sheet));
}
