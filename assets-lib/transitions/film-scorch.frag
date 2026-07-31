// film-scorch — celluloid burning through in the projector gate.
//
// THE IDEA
//   The outgoing beat is a frame of film stuck in front of the lamp. Three blisters open at
//   different moments, merge like melting acetate (smooth-min), and eat outward until the frame is
//   gone and the next one — the incoming beat — is what the lamp shows. Four physical cues sell it
//   as heat rather than a mask:
//     · the gelatin TOASTS ahead of the front — a wide amber warming, then a deep umber collar the
//       moment before it burns, both mottled by the emulsion;
//     · the air above the burn SHIMMERS — the outgoing beat is sampled through a refracting wobble
//       that strengthens toward the front (and the front itself boils: a slow noise term keeps the
//       edge alive instead of advancing a frozen contour);
//     · the front is INCANDESCENT — a white-hot core inside an orange bloom, broken along its
//       length by the emulsion grit so it reads as fire, not as an outline;
//     · behind the front the hole is rimmed with CHAR — a crumbling near-black band flecked with
//       live embers that cool as the edge moves on, and the incoming beat wavers in the rising
//       heat before it settles.
//
// PARAMS  (transitionParams — all optional, all NUMERIC)
//   heat      0.2..1.6  shimmer strength and toast width ahead of the front (default 1.0)
//   char      0.2..1.6  width of the charred rim left behind the front (default 1.0)
//   ember     0.0..1.5  incandescent rim + ember fleck brightness (default 1.0)
//   softness  0.006..0.06 feather of the burn edge itself, in field units (default 0.016)
//   fire      hex       colour of the burn. Default: the brand's accent2. ("#FF7319" = the original amber)
//
// ENDPOINTS
//   Same construction organic-inkbleed proves out: the field is normalised and CLAMPED to [0,1],
//   the threshold sweeps -pad → 1+pad with pad = softness + the widest cue + margin, and every cue
//   is compactly supported (smoothstep widths, no gaussians), so at uP=0 every pixel is past every
//   cue's support on the dry side and at uP=1 past them all on the burned side. The boil term is
//   folded into the field BEFORE the clamp, so it can wobble the front but never widen the range.
//   Shimmer displacement is scaled by cues that are themselves compactly supported. Early-outs at
//   uP<=0 / uP>=1 make both boundary frames bit-exact regardless.
//   Verified: the first- and last-overlap-frame stills are RMSE 0 against a straight fade.
//
// spec: { "transition": "custom", "transitionSource": "film-scorch",
//         "transitionParams": { "heat": 1.0, "char": 1.0, "ember": 1.0, "softness": 0.016 } }

float schHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float schValue(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(schHash(i), schHash(i + vec2(1.0, 0.0)), u.x),
             mix(schHash(i + vec2(0.0, 1.0)), schHash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// 4 octaves, bounded inside [0, 0.9375] — the endpoint padding depends on every noise term having
// a known ceiling.
float schFbm(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    s += a * schValue(p);
    p = rot * p * 2.07;
    a *= 0.5;
  }
  return s;
}

float schSmin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = kinoUv(fragCoord);
  if (uP <= 0.0) { fragColor = kinoFrom(uv); return; }
  if (uP >= 1.0) { fragColor = kinoTo(uv); return; }

  float heat  = u_heat  > 0.0 ? clamp(u_heat, 0.2, 1.6) : 1.0;
  float charK = u_char  > 0.0 ? clamp(u_char, 0.2, 1.6) : 1.0;
  float ember = u_ember > 0.0 ? clamp(u_ember, 0.0, 1.5) : 1.0;
  float soft  = u_softness > 0.0 ? clamp(u_softness, 0.006, 0.06) : 0.016;

  // Square metric so blisters are round in pixels on any frame shape.
  float ar = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * ar, uv.y);

  // Acetate warps as it softens: an isotropic low-frequency wobble, unlike paper's fibrous grain.
  vec2 warp = vec2(schFbm(p * 3.1 + 7.3), schFbm(p * 3.1 + 29.1)) - 0.5;
  vec2 pw = p + warp * 0.16;

  // Everything below is expressed relative to the frame diagonal in p-space, so the burn crosses a
  // 16:9 frame in the same share of the handoff as a 9:16 one — a fixed norm tuned on one aspect
  // leaves the far corners of a wider frame saturated at 1.0, and they all pop at once at the end.
  float norm = 0.40 * length(vec2(ar, 1.0));

  // Three blisters: the lamp's hot spot first, then two the melt spreads to. Later seeds start
  // further back in field units, exactly like inkbleed's drops.
  float d0 = length(pw - vec2(0.54 * ar, 0.58)) * 0.95;
  float d1 = length(pw - vec2(0.26 * ar, 0.22)) * 1.06 + 0.185 * norm;
  float d2 = length(pw - vec2(0.80 * ar, 0.88)) * 1.12 + 0.348 * norm;
  float f = schSmin(d0, schSmin(d1, d2, 0.24 * norm), 0.24 * norm);

  // Melt detail: a mid octave lobes the front, and the BOIL — a slow uP-driven drift through the
  // noise — keeps the edge alive. Amplitudes ride `norm` too, so the raggedness stays a constant
  // share of the field and the clamp still absorbs it.
  f += (schFbm(pw * 6.5 + 13.0) - 0.48) * 0.120 * norm;
  f += (schFbm(pw * 11.0 + vec2(uP * 1.3, -uP * 0.9) + 47.0) - 0.5) * 0.087 * norm;

  float field = clamp(f / norm, 0.0, 1.0);

  // Cue widths, in field units. Every cue below is zero outside its width.
  float toastW = 0.055 + 0.130 * heat;     // wide amber warming ahead of the front
  float charW  = 0.030 + 0.055 * charK;    // charred rim behind it
  float rimW   = 0.030 + 0.016 * ember;    // incandescent filament on it

  float pad = soft + max(toastW, max(charW, rimW)) + 0.02;
  float t = mix(-pad, 1.0 + pad, uP);
  float e = field - t;                     // >0 unburned film, <0 the hole

  float mask = 1.0 - smoothstep(-soft, soft, e);

  float ahead = max(e, 0.0);
  float behind = max(-e, 0.0);

  // Two-stage toast: wide mild amber, then a deep umber collar right before ignition. The collar
  // must stay wider than the mask feather or it burns before it is ever seen.
  float toast  = (1.0 - smoothstep(0.0, toastW, ahead)) * (1.0 - mask);
  float collar = (1.0 - smoothstep(0.0, max(toastW * 0.34, soft * 3.0), ahead)) * (1.0 - mask);
  float charB  = (1.0 - smoothstep(0.0, charW, behind)) * mask;

  // Emulsion mottle: breaks the toast, the char and the filament so nothing outlines the hole
  // like a sticker.
  float mottle = schFbm(pw * 8.0 + 71.0);
  float grit = clamp(1.8 * mottle * mottle + 0.15, 0.0, 1.5);

  // Heat shimmer: the film side wavers toward the front, the hole side wavers as the heat rises
  // off the fresh char. Both displacements are scaled by compactly supported cues.
  vec2 shim = (vec2(schFbm(p * 14.0 + 3.7), schFbm(p * 14.0 + 91.2)) - 0.5) * 0.030 * heat;
  vec4 from = kinoFrom(clamp(uv + shim * toast * toast, 0.0, 1.0));
  vec4 to   = kinoTo(clamp(uv + shim * charB * vec2(0.4, 1.0), 0.0, 1.0));

  // ---- fire colour ------------------------------------------------------------------------------
  // THE COLOUR RULE (see `kino transitions`): pigment from the brand, let the spec override.
  // `"fire": "#ff7722"` sets the burn explicitly; omitted, it takes the brand's SECOND accent — the
  // "secondary/bright" role, which is what a brand reserves for emphasis and the only palette slot
  // that reads as heat. One hue then runs through a temperature ramp, so a brand recolours the fire
  // without any of the four physical cues losing its meaning. (Original amber: "fire": "#FF7319".)
  //
  // NORMALISED first: fire is defined by hue, not by how light the brand happens to have set that
  // swatch. A dark accent2 would otherwise burn dimmer than the unburnt film, which reads as a stain
  // rather than a flame.
  vec3 fireSrc = kinoPick(u_fire, uBrandAccent2);
  vec3 fire = fireSrc / max(max(fireSrc.r, max(fireSrc.g, fireSrc.b)), 1e-4);

  // Film side: amber warming into a deep pre-ignition umber.
  float soak = clamp((toast * 0.6 + collar * 1.2) * (0.5 + 0.8 * mottle), 0.0, 1.0);
  vec3 toasted = from.rgb * mix(vec3(1.0), fire * 0.88, soak * 0.7);
  toasted = mix(toasted, fire * 0.26, soak * soak * 0.55);

  // Hole side: char crumbles over the incoming beat, cooling as the front moves away. Char stays
  // near-black whatever the brand — burnt acetate is burnt acetate — but keeps a trace of the hue
  // so the rim belongs to the same fire.
  vec3 charCol = mix(to.rgb, fire * 0.05, charB * (0.55 + 0.45 * grit));
  // Live embers in the fresh char: sparse flecks that flicker as the burn advances and die as it
  // cools. uP only modulates the flicker; the charB factor keeps the support compact.
  float fleck = schHash(floor(pw * 90.0) + floor(uP * 24.0) * 0.37);
  float embers = step(0.965, fleck) * charB * charB;
  charCol += fire * embers * 1.4 * ember;

  vec3 col = mix(toasted, charCol, mask);

  // The incandescent front: white-hot core in an orange bloom, broken by the grit.
  float core  = 1.0 - smoothstep(0.0, rimW * 0.30, abs(e));
  float bloom = 1.0 - smoothstep(0.0, rimW, abs(e));
  // The core stays close to white on any brand: incandescence goes white as it gets hotter, so a
  // fully hue-tinted core would read as a coloured outline instead of something burning.
  col += mix(fire, vec3(1.0), 0.72) * core * 1.1 * grit * ember;
  col += fire * bloom * bloom * 0.65 * grit * ember;

  fragColor = vec4(col, mix(from.a, to.a, mask));
}
