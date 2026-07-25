// Erode the cutout by ~2px: hand the outermost band of the mask back to the backdrop instead of to
// the beat's plate. Real footage bleeds its ORIGINAL background into the silhouette (here: green
// grass), and the composite's fixed smoothstep(0.4, 0.6, m) has no way to know that. This is the
// author-side remedy — kinoMaskDist gives the signed distance, kinoBackground gives the shaded
// background at this pixel, and mix() between them moves the seam inward without touching the
// compositing default every other spec shares.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec4 s = texture(uTex0, fragCoord / iResolution.xy);
  vec4 b;
  kinoBackground(b, fragCoord);
  // Negative inside. radius 6 is the smallest that covers a 2px bite (see the kinoMaskDist docs:
  // pass the smallest radius your effect needs).
  float d = kinoMaskDist(uMaskSelf, uChannelSelf, fragCoord, 6.0);
  fragColor = mix(s, b, smoothstep(-3.0, -1.0, d));
}
