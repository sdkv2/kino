// Tracked liquid glass: bend the lookup along the mask's own surface normal, then sample the
// SHADED BACKGROUND at the bent coordinate. kinoBackground(c, fragCoord + offset) re-evaluates the
// background body at that point — an exact, full-resolution sample with no framebuffer.
//
// Sampling uTex0 at an offset instead would refract the beat's raw PLATE. That is correct only when
// the background region is a passthrough; under a treatment like region-tint.frag it shows the
// untreated footage through the glass. See docs/segmentation.md § Cross-region sampling.
//
// Both kinoMaskDist and kinoBackground are called from UNIFORM control flow. Neither may sit inside
// an `if` that differs across a fragment quad: both read screen-space derivatives, which are
// undefined there and fail silently rather than loudly.
//
// Params: u_bend (px of displacement at the rim), u_radius (bevel depth in px).

// Unit-ish normal scaled by a bevel profile: 0 deep inside the subject, 1 at the silhouette, so the
// glass is flat in the middle and bends hardest at the edge.
vec2 glassBend(vec2 f, float r) {
  float d = kinoMaskDist(uMask0, uChannel0, f, r);
  float t = clamp(1.0 + d / r, 0.0, 1.0);
  float e = 4.0;
  // Surface normal from central differences of the distance field.
  vec2 n = vec2(
    kinoMaskDist(uMask0, uChannel0, f + vec2(e, 0.0), r) - kinoMaskDist(uMask0, uChannel0, f - vec2(e, 0.0), r),
    kinoMaskDist(uMask0, uChannel0, f + vec2(0.0, e), r) - kinoMaskDist(uMask0, uChannel0, f - vec2(0.0, e), r));
  return normalize(n + vec2(1e-5, 1e-5)) * t * t;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  float r = max(u_radius, 1.0);
  vec2 bent = glassBend(fragCoord, r);
  vec4 refracted;
  kinoBackground(refracted, fragCoord + bent * u_bend);
  float rim = pow(length(bent), 6.0) * 0.35;
  fragColor = vec4(refracted.rgb * 1.06 + rim, 1.0);
}
