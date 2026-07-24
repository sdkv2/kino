// Per-object region body for mask entry 0. Cool duotone footage + a thin cyan inner rim.
// uMaskSelf/uChannelSelf are #defined by the assembler to THIS entry's mask+channel, so the
// rim tracks object 0 without hardcoding uMask0.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 src = texture(uTex0, uv).rgb;
  float l = dot(src, vec3(0.2126, 0.7152, 0.0722));

  // cool duotone: deep navy -> pale cyan
  vec3 body = mix(vec3(0.04, 0.09, 0.20), vec3(0.62, 0.94, 1.00), l);

  // signed distance to THIS object's edge: negative inside, positive outside, ±radius clamped.
  float d = kinoMaskDist(uMaskSelf, uChannelSelf, fragCoord, 14.0);
  // one band sitting just inside the silhouette
  float rim = 1.0 - smoothstep(1.5, 4.0, abs(d + 3.0));

  fragColor = vec4(mix(body, vec3(0.35, 1.0, 1.0), rim), 1.0);
}
