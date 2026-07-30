// organic-inkbleed — ink wicking through paper.
//
// THE IDEA
//   Not a wipe with a noisy edge. Four drops of ink land on the page at different moments, each one
//   spreading as its own blot; the blots swell, grow capillary fingers along the paper grain, and
//   coalesce (smooth-min, so they merge like liquid rather than overlap like circles) until the page
//   is flooded. Four physical cues sell it as MATTER rather than a mask:
//     · a damp halo runs AHEAD of the ink — the paper darkens and cools where the wet front is about
//       to arrive, blotchier than the front itself because wicking follows the fibre;
//     · the wet sheet COCKLES — the outgoing beat is sampled through the same warp inside the damp
//       zone, so ruled lines and grids visibly bow and swell toward the ink;
//     · a pigment line SITS ON the front — in real chromatography the dye piles up at the leading
//       edge, so the boundary is a bright uneven mint filament, not a step;
//     · the fresh ink BEHIND the front is still pooling — darker, and dragged sideways along the
//       local flow (the incoming beat is sampled with a flow-warped uv that relaxes as it dries).
//   Everything is driven by one bounded field, so the front is a single coherent shape and the cues
//   are just slices through it.
//
// PARAMS  (all four must be present in transitionParams — an omitted key has no u_ alias)
//   bleed      0.2 … 1.6   width of the damp pre-wet halo running ahead of the ink. 0 = hard edge.
//   fingering  0.0 … 1.6   capillary raggedness: domain-warp + detail octaves + spatter specks that
//                          jump ahead of the front. 0 = smooth round blots.
//   glow       0.0 … 1.5   brightness of the pigment filament sitting on the front.
//   softness   0.01 … 0.06 feather of the front itself, in field units (1 unit = whole frame).
//
// ENDPOINTS — how both ends are reached exactly
//   The field F is normalised and CLAMPED to [0,1], so every pixel's arrival time is inside that
//   range no matter what the noise does. The threshold T sweeps from -pad to 1+pad where
//   pad = softness + max(all three cue widths) + margin. At uP=0 every pixel therefore has
//   e = F-T >= pad, which is past the support of the mask AND of all three cues (each is compactly
//   supported via smoothstep, never a gaussian) — so the result is bit-exactly kinoFrom. At uP=1
//   every pixel has e <= -pad, likewise past every cue's support, so it is bit-exactly kinoTo.
//   The flow-drag on kinoTo is scaled by the "wet" cue, so it too is gone at uP=1.
//
// spec: { "transition": "custom", "transitionSource": "organic-inkbleed",
//         "transitionParams": { "bleed": 0.8, "fingering": 1.0, "glow": 0.9, "softness": 0.022 } }

// ---- deterministic noise (uP is the only clock; these are pure functions of position) ----

float inkHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float inkValue(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(inkHash(i), inkHash(i + vec2(1.0, 0.0)), u.x),
             mix(inkHash(i + vec2(0.0, 1.0)), inkHash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// 5 octaves, amplitudes 1/2..1/32 — strictly inside [0, 0.96875]. Bounded on purpose: the endpoint
// padding below is only safe because every noise term here has a known ceiling.
float inkFbm(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 5; i++) {
    s += a * inkValue(p);
    p = rot * p * 2.03;
    a *= 0.5;
  }
  return s;
}

// Ridged octaves — creases instead of blobs. Subtracting this from the distance field pulls ink
// forward along the creases, which is what makes tendrils rather than lobes. Bounded [0, 0.9375].
float inkRidge(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    float n = 1.0 - abs(2.0 * inkValue(p) - 1.0);
    s += a * n * n;
    p = rot * p * 2.11;
    a *= 0.5;
  }
  return s;
}

// Liquid merge: two blots meeting bulge into each other instead of crossing.
float inkSmin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = kinoUv(fragCoord);

  // `> 0.0 ? : <default>` rather than a bare read: an omitted key is zero-filled by the engine, and
  // zero is a legal-but-degenerate value for each of these (hard edge / round blots / no filament).
  // This way omitting a key gives the shader's intended look, and an explicit 1e-4 still switches
  // the cue off for anyone who wants that.
  float soft  = u_softness  > 0.0 ? clamp(u_softness, 0.006, 0.08) : 0.022;
  float fing  = u_fingering > 0.0 ? u_fingering : 1.0;
  float bleed = u_bleed     > 0.0 ? u_bleed     : 0.8;
  float glow  = u_glow      > 0.0 ? u_glow      : 0.9;

  // Square metric, so blots are round in pixels rather than stretched by the 9:16 frame.
  float ar = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * ar, uv.y);

  // Paper grain: a low-frequency warp, squashed in y so the fibre runs across the page. This is what
  // turns concentric blots into lobed, dendritic ones.
  vec2 grain = vec2(inkFbm(p * vec2(3.4, 5.1) + 11.7), inkFbm(p * vec2(3.4, 5.1) + 41.3)) - 0.5;
  vec2 pw = p + grain * (0.30 * fing);

  // Every field-space constant below rides the frame diagonal in p-space, the way film-scorch's
  // do: a fixed norm tuned on one aspect leaves the far corners of a wider frame saturated at 1.0,
  // and they all flip together in the last frames instead of being reached by the front. The 0.327
  // is chosen so a 9:16 frame lands on the original hand-tuned norm (0.375) exactly.
  float norm = 0.327 * length(vec2(ar, 1.0));

  // Four drops. x is pre-scaled by ar to live in the same metric as p. The trailing constant is the
  // drop's delay — a later drop starts its blot further "back" in field units.
  vec2 c0 = vec2(0.34 * ar, 0.27);
  vec2 c1 = vec2(0.73 * ar, 0.63);
  vec2 c2 = vec2(0.47 * ar, 0.94);
  vec2 c3 = vec2(0.11 * ar, 0.76);

  float d0 = length(pw - c0) * 0.92;
  float d1 = length(pw - c1) * 1.02 + 0.200 * norm;
  float d2 = length(pw - c2) * 1.10 + 0.400 * norm;
  float d3 = length(pw - c3) * 1.16 + 0.520 * norm;

  float f = inkSmin(inkSmin(d0, d1, 0.227 * norm), inkSmin(d2, d3, 0.227 * norm), 0.227 * norm);

  // Capillary detail, three scales:
  //   · ridged creases pull tendrils ahead of the bulk front (Saffman–Taylor fingering);
  //   · a mid octave roughens the outline;
  //   · rare high-frequency spikes throw isolated specks of ink out ahead of the front — paper
  //     fibres that wick early and seed a satellite blot.
  float veins = inkRidge(pw * 7.2 + 17.0);
  f -= veins * 0.267 * norm * fing;
  f += (inkFbm(pw * 13.0 + 3.0) - 0.48) * 0.120 * norm * fing;
  f += (inkFbm(pw * 34.0 + 61.0) - 0.48) * 0.053 * norm * fing;   // fibre-scale lace on the outline
  float spatter = inkFbm(pw * 27.0 + 7.5);
  f -= spatter * spatter * spatter * 0.200 * norm * fing;

  // Normalise so the last dry corner of the frame arrives at ~1, then clamp: the clamp is what makes
  // the endpoint padding below airtight, and the divisor is what keeps the tail of the sweep from
  // being dead time (tuned against the 9:16 montage, carried to other aspects by the diagonal). The
  // detail amplitudes above ride `norm` too, so the raggedness stays a constant share of the field
  // and the clamp still absorbs every bounded noise term.
  float field = clamp(f / norm, 0.0, 1.0);

  // Cue widths, in field units.
  float rimW  = 0.026 + 0.018 * min(glow, 1.5);
  float haloW = 0.020 + 0.110 * bleed;
  float wetW  = 0.060;

  float pad = soft + max(rimW, max(haloW, wetW)) + 0.02;
  float t = mix(-pad, 1.0 + pad, uP);
  float e = field - t;           // >0 dry paper (outgoing), <0 ink (incoming)

  float mask = 1.0 - smoothstep(-soft, soft, e);

  // Every cue is compactly supported — zero outside its width, so `pad` really does clear them.
  // Two-stage soak: a wide faint dampness the fibre carries far ahead, plus a saturated collar the
  // ink is about to reach. Both compactly supported inside haloW.
  // The collar must be comfortably WIDER than the mask feather, or the mix to ink swallows it before
  // it is ever visible and the front reads as a glow instead of a soak.
  float ahead = max(e, 0.0);
  float halo = (1.0 - smoothstep(0.0, haloW, ahead)) * (1.0 - mask);
  // (clamped to haloW — `pad` is sized from haloW, so a wider collar would break the endpoints)
  float collarW = min(haloW, max(haloW * 0.62, soft * 3.5));
  float collar = (1.0 - smoothstep(0.0, collarW, ahead)) * (1.0 - mask);
  float wet  = (1.0 - smoothstep(0.0, wetW, max(-e, 0.0))) * mask;
  float core = 1.0 - smoothstep(0.0, rimW * 0.26, abs(e));
  float bloom = 1.0 - smoothstep(0.0, rimW * 0.62, abs(e));

  // Pigment does not pile up evenly — break the filament hard along its length, so it thins to
  // nothing in places instead of outlining the blot like a sticker.
  float g = inkFbm(pw * 19.0 + 55.0);
  float grit = clamp(1.70 * g * g + 0.10, 0.0, 1.6);

  // Wet paper cockles. Buckling the outgoing beat inside the damp zone is what sells the page as a
  // physical sheet — on a ruled or gridded layout the straight lines visibly bow toward the ink.
  vec4 from = kinoFrom(clamp(uv + grain * vec2(0.030, 0.030) * halo, 0.0, 1.0));

  // Fresh ink is still moving: drag the incoming beat along the local flow, relaxing as it dries.
  vec4 to = kinoTo(clamp(uv + grain * vec2(0.045, 0.045) * wet * wet, 0.0, 1.0));

  // Damp paper ahead of the front: cooled, darkened, blotchy (the halo carries its own noise so the
  // wet zone looks soaked-through rather than airbrushed).
  float mottle = 0.40 + 0.85 * inkFbm(pw * 6.5 + 91.0);
  float soak = clamp((halo * 0.55 + collar * 1.35) * mottle * min(bleed, 1.4), 0.0, 1.0);
  vec3 dampen = mix(vec3(1.0), vec3(0.13, 0.34, 0.28), soak);
  vec3 col = from.rgb * dampen;

  // Ink side: pooled and deep right behind the front, drying into the incoming beat.
  vec3 pooled = to.rgb * 0.42 + vec3(0.004, 0.024, 0.019);
  col = mix(col, mix(to.rgb, pooled, wet * 0.9), mask);

  // Pigment: the filament on the front, plus feathering — the ridge lines the ink ran along stay
  // visible in the fresh pool for a moment, like dye caught in the fibre.
  vec3 pigment = vec3(0.30, 1.00, 0.68);
  col += pigment * (core * 0.70 + bloom * 0.14) * grit * glow;
  col += pigment * veins * veins * wet * 0.16 * glow;

  fragColor = vec4(col, mix(from.a, to.a, mask));
}
